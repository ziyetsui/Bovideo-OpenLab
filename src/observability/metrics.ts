const metricNames = [
  'bo_queue_backlog',
  'bo_queue_oldest_age_seconds',
  'bo_queue_attempt_total',
  'bo_queue_retry_total',
  'bo_queue_dlq_total',
  'bo_workflow_failure_total',
  'bo_publication_pointer_conflict_total',
] as const
export type MetricName = (typeof metricNames)[number]
export type MetricLabels = Readonly<{
  environment: 'local'
  version: string
  service: 'ingestion' | 'localization' | 'publishing' | 'security'
  kind: 'ingest' | 'translate' | 'publish' | 'export' | 'withdraw'
  outcome: 'observed' | 'retry_scheduled' | 'dlq' | 'failed' | 'denied' | 'conflict'
  error_class: 'none' | 'auth' | 'transient' | 'validation' | 'redaction'
  locale: 'none' | 'ja-JP' | 'en-US' | 'zh-CN'
}>
export type MetricSample = Readonly<{ name: MetricName; value: number; labels: MetricLabels }>

const validateLabels = (labels: MetricLabels): MetricLabels => {
  const allowed = ['environment', 'version', 'service', 'kind', 'outcome', 'error_class', 'locale']
  if (Object.keys(labels).length !== allowed.length || Object.keys(labels).some((key) => !allowed.includes(key))) throw new Error('metric labels must be bounded')
  if (labels.environment !== 'local' || !/^p1-[a-z0-9-]{1,64}$/.test(labels.version)) throw new Error('invalid metric labels')
  if (!['ingestion', 'localization', 'publishing', 'security'].includes(labels.service)) throw new Error('invalid metric label service')
  if (!['ingest', 'translate', 'publish', 'export', 'withdraw'].includes(labels.kind)) throw new Error('invalid metric label kind')
  if (!['observed', 'retry_scheduled', 'dlq', 'failed', 'denied', 'conflict'].includes(labels.outcome)) throw new Error('invalid metric label outcome')
  if (!['none', 'auth', 'transient', 'validation', 'redaction'].includes(labels.error_class)) throw new Error('invalid metric label error class')
  if (!['none', 'ja-JP', 'en-US', 'zh-CN'].includes(labels.locale)) throw new Error('invalid metric label locale')
  return Object.freeze({ ...labels })
}

/** Deterministic local metric test double; labels deliberately omit IDs, hashes and content. */
export class InMemoryMetricSink {
  readonly #samples: MetricSample[] = []
  increment(name: MetricName, labels: MetricLabels, value = 1): void {
    if (!(metricNames as readonly string[]).includes(name)) throw new Error('unknown metric')
    if (!Number.isFinite(value) || value <= 0) throw new Error('metric increment must be positive')
    this.#samples.push(Object.freeze({ name, value, labels: validateLabels(labels) }))
  }
  record(name: MetricName, labels: MetricLabels, value: number): void {
    if (!(metricNames as readonly string[]).includes(name)) throw new Error('unknown metric')
    if (!Number.isFinite(value) || value < 0) throw new Error('metric value must be non-negative')
    this.#samples.push(Object.freeze({ name, value, labels: validateLabels(labels) }))
  }
  samples(): readonly MetricSample[] { return this.#samples.slice() }
}
