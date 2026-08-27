import importlib.util
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_higgsfield_twitter241.py"
SPEC = importlib.util.spec_from_file_location("higgsfield_scraper", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def tweet(tweet_id: str, text: str, likes: int = 1) -> dict:
    return {
        "rest_id": tweet_id,
        "legacy": {
            "id_str": tweet_id,
            "full_text": text,
            "created_at": "Wed Aug 20 12:00:00 +0000 2026",
            "conversation_id_str": tweet_id,
            "favorite_count": likes,
            "reply_count": 2,
            "bookmark_count": 3,
            "retweet_count": 4,
            "quote_count": 5,
            "lang": "en",
        },
        "core": {
            "user_results": {
                "result": {
                    "rest_id": "123",
                    "core": {"name": "Maker", "screen_name": "maker"},
                    "legacy": {
                        "followers_count": 100,
                    },
                }
            }
        },
        "views": {"count": "99"},
    }


class ScraperTests(unittest.TestCase):
    def test_extract_primary_tweet_from_entry(self):
        primary = tweet("100", "Higgsfield\nPrompt: " + "cinematic camera " * 5)
        quoted = tweet("200", "unrelated quoted post")
        page = {
            "cursor": {"bottom": "next"},
            "result": {"timeline": [{"entryId": "tweet-100", "content": [primary, quoted]}]},
        }
        found = MODULE.extract_tweet_nodes(page)
        self.assertEqual(["100"], [item["rest_id"] for item in found])
        self.assertEqual("next", MODULE.extract_cursor(page))

    def test_prompt_payload_excludes_mentions(self):
        self.assertEqual((None, None), MODULE.extract_prompt("Higgsfield uses a single prompt"))
        payload, location = MODULE.extract_prompt(
            "Higgsfield\nVideo Prompt: " + "slow dolly shot with soft daylight " * 3
        )
        self.assertTrue(payload.startswith("slow dolly"))
        self.assertEqual("post", location)

    def test_current_user_core_fields(self):
        row = MODULE.normalize_tweet(
            tweet("999", "Higgsfield\nPrompt: " + "cinematic scene " * 5),
            "run", "2026-08-20T00:00:00+00:00", "Q01:Latest", "raw:1",
        )
        self.assertEqual("Maker", row["author_name"])
        self.assertEqual("maker", row["author_handle"])
        self.assertEqual("https://x.com/maker/status/999", row["url"])

    def test_absolute_scale_boundaries(self):
        values = [0, 19, 20, 49, 50, 99, 100, 299, 300, 999, 1000]
        expected = [
            "baseline", "baseline", "engaged", "engaged", "niche_strong",
            "niche_strong", "topic_strong", "topic_strong", "broad_reach",
            "broad_reach", "breakout_candidate",
        ]
        self.assertEqual(expected, [MODULE.absolute_scale(value) for value in values])

    def test_linear_percentile_and_high_like(self):
        rows = []
        for index in range(30):
            row = MODULE.normalize_tweet(
                tweet(str(1000 + index), "Higgsfield\nPrompt: " + "a reusable scene description " * 3, index),
                "run", "2026-08-20T00:00:00+00:00", "Q01:Latest", "raw:1",
            )
            rows.append(row)
        like_cutoff, value_cutoff = MODULE.classify(rows)
        self.assertAlmostEqual(26.1, like_cutoff)
        self.assertIsNotNone(value_cutoff)
        self.assertEqual(3, sum(row["high_like_status"] == "certified" for row in rows))

    def test_small_sample_not_certified(self):
        rows = [
            MODULE.normalize_tweet(
                tweet(str(3000 + index), "Higgsfield\nPrompt: " + "a reusable scene description " * 3, index + 100),
                "run", "2026-08-20T00:00:00+00:00", "Q01:Latest", "raw:1",
            )
            for index in range(9)
        ]
        MODULE.classify(rows)
        self.assertTrue(all(row["high_like_status"] == "insufficient_sample" for row in rows))
        self.assertTrue(all(row["high_value_status"] == "insufficient_sample" for row in rows))

    def test_jsonl_loader_preserves_unicode_line_separator(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "raw.jsonl"
            record = {"payload": {"text": "before\u2028after"}}
            path.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
            self.assertEqual([record], MODULE.load_raw_pages(path))

    def test_retry_transient_5xx(self):
        responses = [MODULE.ApiError(503, "temporary"), {"status": "ok"}]
        with mock.patch.object(MODULE, "api_get", side_effect=responses), mock.patch.object(MODULE.time, "sleep") as sleeper:
            payload, retries = MODULE.request_with_retry("q", "Latest", 20, "", "secret", 1)
        self.assertEqual({"status": "ok"}, payload)
        self.assertEqual(1, retries)
        sleeper.assert_called_once_with(2.0)


if __name__ == "__main__":
    unittest.main()

