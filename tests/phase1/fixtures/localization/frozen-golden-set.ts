import type { GoldenSetManifestInput } from '@/localization/golden-set'
import type { ApplicationLocale } from '@/contracts/locale'

const FROZEN_LOCALES: ApplicationLocale[] = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
  'it-IT',
  'es-ES',
  'es-419',
  'pt-BR',
  'pt-PT',
  'hi-IN',
  'th-TH',
  'tr-TR',
  'vi-VN',
]

export const makeGoldenManifestInput = (
  overrides: Partial<GoldenSetManifestInput> = {},
): GoldenSetManifestInput => ({
  schema_version: 1,
  version: 'golden-2026-08-20-v1',
  model_snapshot: 'synthetic-model-2026-08-20',
  prompt_version: 'prompt-v7',
  source_hash: 'sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  cost_usd: 0,
  evaluator_version: 'local-evaluator-v1',
  evaluated_at: '2026-08-20T12:00:00.000Z',
  locales: FROZEN_LOCALES.map((locale, index) => ({
    locale,
    source_hash: `sha256:v1:${String(index + 1).repeat(64).slice(0, 64)}`,
    score: 0.95,
    passed: true,
    severe_defects: [],
  })),
  ...overrides,
})

export const FROZEN_GOLDEN_FIXTURE = makeGoldenManifestInput()
