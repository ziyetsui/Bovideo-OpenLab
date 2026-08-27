#!/usr/bin/env python3
"""Collect Higgsfield prompt posts through Twitter241 search-v2.

Raw API pages are appended before parsing. The normalized corpus and analytical
views are deterministic products of those archived pages.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import email.utils
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable


API_BASE = "https://twitter241.p.rapidapi.com"
API_HOST = "twitter241.p.rapidapi.com"
RULE_VERSION = "higgsfield-x-prompt-v1"
OFFICIAL_HANDLES = {"higgsfield", "higgsfield_ai"}
QUERY_MATRIX = [
    ("Q01", "Higgsfield prompt", None),
    ("Q02", '"Higgsfield AI" prompt', "Higgsfield AI prompt"),
    ("Q03", "@higgsfield prompt", "higgsfield prompt"),
    ("Q04", "@higgsfield_ai prompt", "higgsfield_ai prompt"),
    ("Q05", "#Higgsfield prompt", "Higgsfield prompt"),
    ("Q06", 'Higgsfield "Prompt:"', "Higgsfield Prompt"),
    ("Q07", 'Higgsfield "Image prompt:"', "Higgsfield Image prompt"),
    ("Q08", 'Higgsfield "Video prompt:"', "Higgsfield Video prompt"),
    ("Q09", 'Higgsfield "Negative Prompt:"', "Higgsfield Negative Prompt"),
    ("Q10", "Higgsfield prompt has:media", "Higgsfield prompt filter:media"),
]
MODES = ("Latest", "Top")
STOP_CLOSED = {"natural_end", "no_new_ids"}
CSV_FIELDS = [
    "run_id", "tweet_id", "conversation_id", "created_at", "author_id",
    "author_name", "author_handle", "author_followers", "url", "language",
    "text", "prompt_text", "prompt_location", "likes", "comments",
    "bookmarks", "reposts", "quotes", "views", "metrics_observed_at",
    "query_hits", "raw_ref", "missing_reasons", "is_higgsfield_relevant",
    "has_prompt_payload", "topic_like_percentile",
    "topic_bookmark_percentile", "topic_comment_percentile",
    "creator_like_median", "creator_lift", "creator_lift_percentile",
    "save_like_ratio", "save_rate", "value_score", "high_like_status",
    "high_value_status", "absolute_scale_tag", "rejection_reason",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file",
        default="/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/.env/twitter241.env",
    )
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--sleep", type=float, default=2.0)
    parser.add_argument("--max-pages", type=int, default=0, help="0 means no configured cap")
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--rebuild-only", action="store_true", help="Regenerate derived files from archived pages without API calls")
    return parser.parse_args()


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def load_api_key(path: Path) -> str:
    if not path.exists() or not path.is_file():
        raise RuntimeError(f"blocked_input: env file not found: {path}")
    if path.stat().st_mode & 0o077:
        raise RuntimeError("blocked_input: env file permissions must not be wider than 0600")
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    key = values.get("TWITTER241_RAPIDAPI_KEY") or values.get("RAPIDAPI_KEY")
    if not key:
        raise RuntimeError("blocked_input: no supported RapidAPI key variable")
    return key


def iter_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_dicts(child)


def is_tweet_node(node: dict[str, Any]) -> bool:
    legacy = node.get("legacy")
    return bool(
        isinstance(legacy, dict)
        and (legacy.get("id_str") or node.get("rest_id"))
        and (legacy.get("full_text") or legacy.get("text"))
    )


def extract_tweet_nodes(page: Any) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    entries = [
        node for node in iter_dicts(page)
        if str(node.get("entryId") or node.get("entry_id") or "").startswith("tweet-")
    ]
    for entry in entries:
        entry_id = str(entry.get("entryId") or entry.get("entry_id")).split("tweet-", 1)[-1]
        candidates = [node for node in iter_dicts(entry) if is_tweet_node(node)]
        chosen = next(
            (
                node for node in candidates
                if str((node.get("legacy") or {}).get("id_str") or node.get("rest_id")) == entry_id
            ),
            candidates[0] if candidates else None,
        )
        if chosen is not None:
            found[entry_id] = chosen
    if not found:
        for node in iter_dicts(page):
            if not is_tweet_node(node):
                continue
            legacy = node.get("legacy") or {}
            tweet_id = str(legacy.get("id_str") or node.get("rest_id") or "")
            if tweet_id.isdigit():
                found[tweet_id] = node
    return list(found.values())


def extract_cursor(page: Any) -> str:
    if isinstance(page, dict):
        root_cursor = page.get("cursor")
        if isinstance(root_cursor, dict) and root_cursor.get("bottom"):
            return str(root_cursor["bottom"])
    for node in iter_dicts(page):
        cursor_type = str(node.get("cursorType") or node.get("cursor_type") or "").lower()
        value = node.get("value") or node.get("next_cursor") or node.get("bottomCursor")
        if value and "bottom" in cursor_type:
            return str(value)
    return ""


def note_text(tweet: dict[str, Any]) -> str:
    for node in iter_dicts(tweet.get("note_tweet")):
        text = node.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    return ""


def author_data(tweet: dict[str, Any]) -> dict[str, Any]:
    core = tweet.get("core")
    if isinstance(core, dict):
        user_results = core.get("user_results")
        if isinstance(user_results, dict):
            result = user_results.get("result")
            if isinstance(result, dict):
                legacy = result.get("legacy") if isinstance(result.get("legacy"), dict) else {}
                current_core = result.get("core") if isinstance(result.get("core"), dict) else {}
                return {
                    "id": str(result.get("rest_id") or legacy.get("id_str") or ""),
                    "name": str(current_core.get("name") or legacy.get("name") or ""),
                    "handle": str(current_core.get("screen_name") or legacy.get("screen_name") or ""),
                    "followers": legacy.get("followers_count"),
                }
    for node in iter_dicts(tweet):
        legacy = node.get("legacy")
        if not isinstance(legacy, dict) or not legacy.get("screen_name"):
            continue
        return {
            "id": str(node.get("rest_id") or legacy.get("id_str") or ""),
            "name": str(legacy.get("name") or ""),
            "handle": str(legacy.get("screen_name") or ""),
            "followers": legacy.get("followers_count"),
        }
    return {"id": "", "name": "", "handle": "", "followers": None}


def parse_created_at(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    try:
        parsed = email.utils.parsedate_to_datetime(text)
        return parsed.astimezone(dt.timezone.utc).isoformat()
    except (TypeError, ValueError):
        return text


def metric(legacy: dict[str, Any], key: str) -> int | None:
    value = legacy.get(key)
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def extract_views(tweet: dict[str, Any]) -> int | None:
    views = tweet.get("views")
    if isinstance(views, dict):
        value = views.get("count")
        if isinstance(value, int) and value >= 0:
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


def extract_prompt(text: str) -> tuple[str | None, str | None]:
    markers = list(
        re.finditer(
            r"(?i)\b(?:(?:image|video|negative)\s+)?prompt\s*[:：]\s*",
            text,
        )
    )
    if not markers:
        return None, None
    payload = text[markers[0].end():].strip()
    payload = re.sub(r"\n{3,}", "\n\n", payload)
    if len(payload) < 40:
        return None, None
    return payload, "post"


def normalize_tweet(
    tweet: dict[str, Any], run_id: str, observed_at: str, query_hit: str, raw_ref: str
) -> dict[str, Any]:
    legacy = tweet.get("legacy") if isinstance(tweet.get("legacy"), dict) else tweet
    tweet_id = str(legacy.get("id_str") or tweet.get("rest_id") or "")
    note = note_text(tweet)
    text = note or str(legacy.get("full_text") or legacy.get("text") or "")
    author = author_data(tweet)
    handle = author["handle"]
    prompt_text, prompt_location = extract_prompt(text)
    if prompt_text is not None and note:
        prompt_location = "note_tweet"
    relevant = "higgsfield" in text.casefold() or handle.casefold() in OFFICIAL_HANDLES
    fields = {
        "likes": metric(legacy, "favorite_count"),
        "comments": metric(legacy, "reply_count"),
        "bookmarks": metric(legacy, "bookmark_count"),
        "reposts": metric(legacy, "retweet_count"),
        "quotes": metric(legacy, "quote_count"),
        "views": extract_views(tweet),
    }
    missing = {name: "provider_field_missing" for name, value in fields.items() if value is None}
    if not legacy.get("conversation_id_str"):
        missing["conversation_id"] = "provider_field_missing"
    if author["followers"] is None:
        missing["author_followers"] = "provider_field_missing"
    rejection = ""
    if not relevant:
        rejection = "not_higgsfield_relevant"
    elif prompt_text is None:
        rejection = "no_reusable_prompt_payload"
    return {
        "run_id": run_id,
        "tweet_id": tweet_id,
        "conversation_id": str(legacy.get("conversation_id_str") or "") or None,
        "created_at": parse_created_at(legacy.get("created_at")),
        "author_id": author["id"],
        "author_name": author["name"],
        "author_handle": handle,
        "author_followers": author["followers"],
        "url": f"https://x.com/{handle}/status/{tweet_id}" if handle else f"https://x.com/i/status/{tweet_id}",
        "language": legacy.get("lang"),
        "text": text,
        "prompt_text": prompt_text,
        "prompt_location": prompt_location,
        **fields,
        "metrics_observed_at": observed_at,
        "query_hits": [query_hit],
        "raw_ref": [raw_ref],
        "missing_reasons": missing,
        "is_higgsfield_relevant": relevant,
        "has_prompt_payload": prompt_text is not None,
        "topic_like_percentile": None,
        "topic_bookmark_percentile": None,
        "topic_comment_percentile": None,
        "creator_like_median": None,
        "creator_lift": None,
        "creator_lift_percentile": None,
        "save_like_ratio": None,
        "save_rate": None,
        "value_score": None,
        "high_like_status": "not_high_like",
        "high_value_status": "not_high_value",
        "absolute_scale_tag": absolute_scale(fields["likes"]),
        "rejection_reason": rejection,
    }


def absolute_scale(likes: int | None) -> str:
    if likes is None:
        return "unknown"
    if likes < 20:
        return "baseline"
    if likes < 50:
        return "engaged"
    if likes < 100:
        return "niche_strong"
    if likes < 300:
        return "topic_strong"
    if likes < 1000:
        return "broad_reach"
    return "breakout_candidate"


def linear_percentile(values: list[float], q: float) -> float | None:
    clean = sorted(float(value) for value in values if value is not None and math.isfinite(float(value)))
    if not clean:
        return None
    if len(clean) == 1:
        return clean[0]
    position = (len(clean) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return clean[lower]
    return clean[lower] + (clean[upper] - clean[lower]) * (position - lower)


def percentile_ranks(rows: list[dict[str, Any]], source: str, target: str) -> None:
    values = sorted(float(row[source]) for row in rows if row.get(source) is not None)
    if not values:
        return
    for row in rows:
        value = row.get(source)
        if value is None:
            row[target] = None
            continue
        less = sum(candidate < float(value) for candidate in values)
        equal = sum(candidate == float(value) for candidate in values)
        denominator = max(len(values) - 1, 1)
        row[target] = min(100.0, 100.0 * (less + max(equal - 1, 0) / 2) / denominator)


def classify(rows: list[dict[str, Any]]) -> tuple[float | None, float | None]:
    prompts = [
        row for row in rows
        if row["is_higgsfield_relevant"] and row["has_prompt_payload"]
    ]
    percentile_ranks(prompts, "likes", "topic_like_percentile")
    percentile_ranks(prompts, "bookmarks", "topic_bookmark_percentile")
    percentile_ranks(prompts, "comments", "topic_comment_percentile")
    for row in prompts:
        likes = row.get("likes")
        bookmarks = row.get("bookmarks")
        views = row.get("views")
        if bookmarks is not None and likes is not None:
            row["save_like_ratio"] = bookmarks / max(likes, 1)
        if bookmarks is not None and views is not None:
            row["save_rate"] = bookmarks / max(views, 1)
        weighted = [
            (0.40, row.get("topic_like_percentile")),
            (0.30, row.get("topic_bookmark_percentile")),
            (0.20, row.get("creator_lift_percentile")),
            (0.10, row.get("topic_comment_percentile")),
        ]
        available = [(weight, value) for weight, value in weighted if value is not None]
        weight_sum = sum(weight for weight, _ in available)
        if weight_sum >= 0.70:
            row["value_score"] = sum(weight * float(value) for weight, value in available) / weight_sum

    like_rows = [row for row in prompts if row.get("likes") is not None]
    like_cutoff = linear_percentile([row["likes"] for row in like_rows], 0.90)
    if like_cutoff is not None:
        like_cutoff = max(20.0, like_cutoff)
    if len(like_rows) < 10:
        for row in like_rows:
            row["high_like_status"] = "insufficient_sample"
    else:
        selected_status = "certified" if len(like_rows) >= 30 else "preliminary"
        for row in like_rows:
            row["high_like_status"] = selected_status if row["likes"] >= like_cutoff else "not_high_like"

    value_rows = [row for row in prompts if row.get("value_score") is not None]
    value_cutoff = linear_percentile([row["value_score"] for row in value_rows], 0.90)
    if len(value_rows) < 10:
        for row in value_rows:
            row["high_value_status"] = "insufficient_sample"
    else:
        selected_status = "certified" if len(value_rows) >= 30 else "preliminary"
        for row in value_rows:
            row["high_value_status"] = selected_status if row["value_score"] >= value_cutoff else "not_high_value"
    return like_cutoff, value_cutoff


def merge_record(existing: dict[str, Any], incoming: dict[str, Any]) -> None:
    existing["query_hits"] = sorted(set(existing["query_hits"] + incoming["query_hits"]))
    existing["raw_ref"] = sorted(set(existing["raw_ref"] + incoming["raw_ref"]))
    if incoming["metrics_observed_at"] >= existing["metrics_observed_at"]:
        preserved_hits = existing["query_hits"]
        preserved_refs = existing["raw_ref"]
        existing.update(incoming)
        existing["query_hits"] = preserved_hits
        existing["raw_ref"] = preserved_refs


class ApiError(RuntimeError):
    def __init__(self, status: int, body: str, retry_after: str = "") -> None:
        super().__init__(f"HTTP {status}: {body[:500]}")
        self.status = status
        self.retry_after = retry_after


def api_get(query: str, mode: str, count: int, cursor: str, key: str, timeout: float) -> Any:
    params = {"query": query, "type": mode, "count": count}
    if cursor:
        params["cursor"] = cursor
    url = f"{API_BASE}/search-v2?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={
            "x-rapidapi-host": API_HOST,
            "x-rapidapi-key": key,
            "User-Agent": "bo-higgsfield-scraper/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise ApiError(exc.code, body, exc.headers.get("Retry-After", "")) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"network_error: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("parse_error: response is not JSON") from exc


def request_with_retry(
    query: str, mode: str, count: int, cursor: str, key: str, timeout: float
) -> tuple[Any, int]:
    retries = 0
    while True:
        try:
            return api_get(query, mode, count, cursor, key, timeout), retries
        except ApiError as exc:
            retryable = exc.status == 429 or 500 <= exc.status < 600
            if not retryable or retries >= 5:
                raise
            delay = float(exc.retry_after) if exc.retry_after.replace(".", "", 1).isdigit() else float(2 ** (retries + 1))
            time.sleep(delay)
            retries += 1
        except RuntimeError as exc:
            retryable = str(exc).startswith(("network_error:", "parse_error:"))
            if not retryable or retries >= 5:
                raise
            time.sleep(float(2 ** (retries + 1)))
            retries += 1


def append_jsonl(path: Path, value: Any) -> int:
    with path.open("a", encoding="utf-8") as handle:
        offset = handle.tell()
        handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return offset


def atomic_json(path: Path, value: Any) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def write_jsonl(path: Path, rows: Iterable[Any]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    temp.replace(path)


def csv_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: csv_value(row.get(field)) for field in CSV_FIELDS})
    temp.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_raw_pages(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    pages = []
    # Iterate physical JSONL records. str.splitlines() also splits U+2028/U+2029,
    # which can legally occur inside X post text and would corrupt a JSON record.
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                pages.append(json.loads(line))
    return pages


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.count < 1 or args.count > 100:
        raise RuntimeError("count must be between 1 and 100")
    out_dir = Path(args.out_dir).expanduser().resolve()
    if out_dir.exists() and any(out_dir.iterdir()) and not (args.resume or args.rebuild_only):
        raise RuntimeError(f"output directory is not empty; use --resume: {out_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)
    key = "" if args.rebuild_only else load_api_key(Path(args.env_file).expanduser())
    started_at = utc_now()
    run_id = re.sub(r"[^0-9]", "", started_at)[:14] + "Z"
    raw_pages_path = out_dir / "raw_pages.jsonl"
    existing_pages = load_raw_pages(raw_pages_path) if (args.resume or args.rebuild_only) else []
    if existing_pages:
        run_id = str(existing_pages[0].get("run_id") or run_id)
        started_at = min(str(page.get("fetched_at")) for page in existing_pages if page.get("fetched_at"))

    prior_ledgers: dict[str, dict[str, Any]] = {}
    ledger_path = out_dir / "request_ledger.jsonl"
    if args.rebuild_only:
        if not ledger_path.exists():
            raise RuntimeError("rebuild-only requires request_ledger.jsonl")
        with ledger_path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    item = json.loads(line)
                    prior_ledgers[str(item["unit_id"])] = item

    records: dict[str, dict[str, Any]] = {}
    raw_posts: dict[str, dict[str, Any]] = {}
    ledgers: list[dict[str, Any]] = []
    existing_units: dict[str, list[dict[str, Any]]] = {}
    for page in existing_pages:
        existing_units.setdefault(str(page.get("unit_id")), []).append(page)

    for qid, original_query, fallback_query in QUERY_MATRIX:
        for mode in MODES:
            unit_id = f"{qid}:{mode}"
            unit_started = utc_now()
            prior = existing_units.get(unit_id, [])
            cursor = str(prior[-1].get("next_cursor") or "") if prior else ""
            used_cursors = {str(page.get("input_cursor") or "") for page in prior}
            page_number = len(prior)
            request_count = len(prior)
            retry_count = 0
            consecutive_no_new = 0
            stop_reason = ""
            status = "running"
            query = original_query
            errors: list[str] = []
            for archived in prior:
                payload = archived.get("payload")
                for node in extract_tweet_nodes(payload):
                    observed_at = str(archived.get("fetched_at"))
                    ref = f"raw_pages.jsonl:{archived.get('page_number')}:{unit_id}"
                    normalized = normalize_tweet(node, run_id, observed_at, unit_id, ref)
                    if normalized["tweet_id"]:
                        raw_posts.setdefault(normalized["tweet_id"], {"tweet_id": normalized["tweet_id"], "raw": node})
                        if normalized["tweet_id"] in records:
                            merge_record(records[normalized["tweet_id"]], normalized)
                        else:
                            records[normalized["tweet_id"]] = normalized
            if prior and not cursor:
                stop_reason = "natural_end"
                status = "complete"

            if args.rebuild_only:
                prior_ledger = prior_ledgers.get(unit_id)
                if prior_ledger is None:
                    raise RuntimeError(f"rebuild-only missing ledger unit: {unit_id}")
                ledgers.append(prior_ledger)
                continue

            while not stop_reason:
                if args.max_pages and page_number >= args.max_pages:
                    stop_reason = "configured_cap"
                    status = "partial"
                    break
                try:
                    payload, retries = request_with_retry(query, mode, args.count, cursor, key, args.timeout)
                    request_count += 1 + retries
                    retry_count += retries
                except ApiError as exc:
                    if exc.status in {400, 404} and fallback_query and query == original_query:
                        errors.append(f"primary_query_http_{exc.status}: fallback query used")
                        query = fallback_query
                        cursor = ""
                        used_cursors = set()
                        consecutive_no_new = 0
                        continue
                    errors.append(str(exc))
                    stop_reason = "rate_limited" if exc.status == 429 else "payment_or_permission" if exc.status in {401, 402, 403} else "parse_error"
                    status = "partial"
                    break
                except RuntimeError as exc:
                    errors.append(str(exc))
                    stop_reason = "parse_error"
                    status = "partial"
                    break

                page_number += 1
                fetched_at = utc_now()
                next_cursor = extract_cursor(payload)
                page_record = {
                    "run_id": run_id,
                    "unit_id": unit_id,
                    "query_id": qid,
                    "query_text": query,
                    "original_query_text": original_query,
                    "mode": mode,
                    "page_number": page_number,
                    "input_cursor": cursor,
                    "next_cursor": next_cursor,
                    "fetched_at": fetched_at,
                    "payload_sha256": hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
                    "payload": payload,
                }
                append_jsonl(raw_pages_path, page_record)
                page_new = 0
                for node in extract_tweet_nodes(payload):
                    legacy = node.get("legacy") if isinstance(node.get("legacy"), dict) else node
                    tweet_id = str(legacy.get("id_str") or node.get("rest_id") or "")
                    if not tweet_id.isdigit():
                        continue
                    ref = f"raw_pages.jsonl:{page_number}:{unit_id}"
                    normalized = normalize_tweet(node, run_id, fetched_at, unit_id, ref)
                    if tweet_id not in records:
                        page_new += 1
                        records[tweet_id] = normalized
                    else:
                        merge_record(records[tweet_id], normalized)
                    raw_posts.setdefault(tweet_id, {"tweet_id": tweet_id, "raw": node})
                consecutive_no_new = consecutive_no_new + 1 if page_new == 0 else 0
                if not next_cursor or next_cursor in {"0", "-1"}:
                    stop_reason = "natural_end"
                    status = "complete"
                elif next_cursor == cursor or next_cursor in used_cursors:
                    stop_reason = "repeated_cursor"
                    status = "partial"
                elif consecutive_no_new >= 2:
                    stop_reason = "no_new_ids"
                    status = "complete"
                else:
                    used_cursors.add(cursor)
                    cursor = next_cursor
                    if args.sleep:
                        time.sleep(args.sleep)

            ledger = {
                "run_id": run_id,
                "unit_id": unit_id,
                "query_id": qid,
                "query_text": query,
                "original_query_text": original_query,
                "mode": mode,
                "started_at": unit_started,
                "finished_at": utc_now(),
                "page_count": page_number,
                "request_count": request_count,
                "retry_count": retry_count,
                "unique_tweet_count": sum(unit_id in row["query_hits"] for row in records.values()),
                "stop_reason": stop_reason,
                "last_cursor": cursor,
                "status": status,
                "errors": errors,
            }
            ledgers.append(ledger)
            print(json.dumps({k: ledger[k] for k in ("unit_id", "page_count", "unique_tweet_count", "stop_reason", "status")}), flush=True)

    ordered = sorted(records.values(), key=lambda row: row["tweet_id"])
    like_cutoff, value_cutoff = classify(ordered)
    ordered.sort(
        key=lambda row: (
            row["value_score"] is None,
            -(row["value_score"] or 0),
            row["likes"] is None,
            -(row["likes"] or 0),
            row["tweet_id"],
        )
    )
    prompt_rows = [row for row in ordered if row["is_higgsfield_relevant"] and row["has_prompt_payload"]]
    high_like = [row for row in prompt_rows if row["high_like_status"] in {"certified", "preliminary"}]
    high_value = [row for row in prompt_rows if row["high_value_status"] in {"certified", "preliminary"}]
    rejected = [row for row in ordered if row["rejection_reason"]]

    write_jsonl(out_dir / "raw_posts.jsonl", raw_posts.values())
    write_jsonl(out_dir / "normalized_posts.jsonl", ordered)
    write_jsonl(out_dir / "request_ledger.jsonl", ledgers)
    write_csv(out_dir / "all_candidates.csv", ordered)
    write_csv(out_dir / "all_prompt_posts.csv", prompt_rows)
    write_csv(out_dir / "high_like_posts.csv", high_like)
    write_csv(out_dir / "high_value_posts.csv", high_value)
    write_csv(out_dir / "rejected_posts.csv", rejected)

    closed_units = sum(ledger["stop_reason"] in STOP_CLOSED for ledger in ledgers)
    run_status = "complete" if closed_units == len(QUERY_MATRIX) * len(MODES) else "partial"
    dates = [row["created_at"] for row in ordered if row["created_at"]]
    finished_at = utc_now()
    manifest = {
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "run_status": run_status,
        "provider": "Twitter241 / RapidAPI",
        "endpoint": "/search-v2",
        "query_matrix_version": RULE_VERSION,
        "normalization_version": RULE_VERSION,
        "classification_version": RULE_VERSION,
        "required_unit_count": 20,
        "closed_unit_count": closed_units,
        "request_count": sum(item["request_count"] for item in ledgers),
        "page_count": sum(item["page_count"] for item in ledgers),
        "raw_post_count": len(raw_posts),
        "unique_candidate_count": len(ordered),
        "prompt_post_count": len(prompt_rows),
        "high_like_count": len(high_like),
        "high_value_count": len(high_value),
        "high_like_cutoff": like_cutoff,
        "high_value_cutoff": value_cutoff,
        "percentile_method": "linear",
        "coverage_earliest_created_at": min(dates) if dates else None,
        "coverage_latest_created_at": max(dates) if dates else None,
        "stop_reasons": {ledger["unit_id"]: ledger["stop_reason"] for ledger in ledgers},
        "errors": [error for ledger in ledgers for error in ledger["errors"]],
        "missing_field_summary": {
            field: sum(row.get(field) is None for row in ordered)
            for field in ("likes", "comments", "bookmarks", "reposts", "quotes", "views")
        },
        "secret_scan_result": "pending",
        "limitations": [
            "API-complete is bounded by Twitter241 search visibility.",
            "Image OCR, self-thread expansion, and author timeline baselines are not part of this search run.",
        ],
    }
    atomic_json(out_dir / "manifest.json", manifest)
    readme = f"""# Higgsfield X Prompt API snapshot

- Run ID: `{run_id}`
- Provider: Twitter241 `/search-v2`
- Status: `{run_status}`
- Required units closed: `{closed_units}/20`
- Unique candidates: `{len(ordered)}`
- Reusable Prompt posts: `{len(prompt_rows)}`
- High-like posts: `{len(high_like)}`
- High-value posts: `{len(high_value)}`
- High-like cutoff: `{like_cutoff}`
- High-value cutoff: `{value_cutoff}`

`complete` means all 20 required query units ended naturally within the Provider's
visible search range. It does not mean every public post ever published on X.
Raw JSONL is authoritative; CSV files are deterministic analysis views.
"""
    (out_dir / "README.md").write_text(readme, encoding="utf-8")
    checksums = {
        path.name: sha256_file(path)
        for path in out_dir.iterdir()
        if path.is_file() and not path.name.endswith(".tmp") and path.name != "manifest.json"
    }
    manifest["output_sha256"] = dict(sorted(checksums.items()))
    atomic_json(out_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    try:
        manifest = run(parse_args())
    except (OSError, RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

