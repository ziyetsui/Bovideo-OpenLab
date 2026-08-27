import { createHash } from 'node:crypto'

import type { GraphRelation } from '@/contracts/graph'

import { GRAPH_CANDIDATE_REVIEW_STATE, compareGraphBytes, type CandidateEdge, type CandidateNode, type GraphCandidateReviewState, type GraphRightsState } from './elevation'
import { evidenceRevisionHash } from './provenance'

export { compareGraphBytes }
export const HIGGSFIELD_GRAPH_RULE_VERSION = 'higgsfield-graph-v1' as const

type ArtifactStatus = 'draft' | 'review' | 'approved' | 'published' | 'blocked' | 'withdrawn'
type ExtractableNodeType = 'output' | 'model' | 'use_case' | 'style' | 'technique' | 'subject' | 'creator'
type CandidateSafetyState = 'pending' | 'approved' | 'blocked'
type SourceEvidenceRef = Readonly<{ type: 'source'; id: string; source_version_hash: string }>

/**
 * The extractor input is deliberately smaller than Payload's populated document.
 * A caller must resolve the source relationship and retain its immutable hash first.
 */
export type ImportedPromptArtifact = Readonly<{
  id: string
  status: ArtifactStatus
  source: Readonly<{
    id: string
    source_version_hash: string
    creator?: string | null
    rights_state: GraphRightsState
    safety_state: CandidateSafetyState
  }>
  canonical_label: string
  prompt: Readonly<{ original_text: string }>
  outcome?: Readonly<{
    media_type?: 'image' | 'video' | 'unresolved' | null
    capability?: string | null
  }> | null
  model_refs?: readonly ImportedTaxonomyReference[] | null
  taxonomy_refs?: readonly ImportedTaxonomyReference[] | null
  variation_refs?: readonly ImportedVariationReference[] | null
}>

export type ImportedTaxonomyReference = Readonly<{
  id: string
  node_type: ExtractableNodeType
  label: string
  stable_key?: string | null
}>

export type ImportedVariationReference = Readonly<{
  id: string
  label?: string | null
  source_evidence?: Readonly<{ id: string; source_version_hash: string }> | null
}>

export type GraphCandidateNode = Readonly<{
  id: string
  node_type: ExtractableNodeType
  stable_key: string
  label: string
  description: string
  promotion_state: 'candidate'
  review_state: GraphCandidateReviewState
  evidence_refs: readonly SourceEvidenceRef[]
  source_version_hash: string
  confidence: number
}>

export type GraphCandidateEdge = Readonly<{
  id: string
  from: Readonly<{ type: 'artifact' | 'taxonomy_node'; id: string }>
  relation: GraphRelation
  to: Readonly<{ type: 'artifact' | 'taxonomy_node'; id: string }>
  evidence_refs: readonly SourceEvidenceRef[]
  source_version_hash: string
  evidence_revision: string
  confidence: number
  review_state: GraphCandidateReviewState
}>

/** Candidate discoveries may be rendered only as no-route UI state. */
export type CandidateNavigation = Readonly<{
  node_id: string
  label: string
  link_policy: 'filter_state' | 'dead_text'
  href: null
  render_target: 'filter' | 'tag'
  target_indexability: 'noindex' | 'none'
}>

export type GraphCandidateBatch = Readonly<{
  nodes: readonly GraphCandidateNode[]
  edges: readonly GraphCandidateEdge[]
  navigationCandidates: readonly CandidateNavigation[]
  reviewContext: Readonly<{
    proposerId: 'higgsfield-extractor'
    rightsState: GraphRightsState
    safetyState: CandidateSafetyState
  }>
  ruleVersion: typeof HIGGSFIELD_GRAPH_RULE_VERSION
}>

export type GraphCandidateAudit = Readonly<{
  event: 'graph_candidate_extraction_rejected'
  code: 'stable_key_collision' | 'invalid_stable_key'
  artifact_id: string
  stable_key: string
  labels: readonly string[]
}>
export type GraphCandidateExtractionOptions = Readonly<{ auditSink?: Readonly<{ append: (event: GraphCandidateAudit) => void }> }>

export class GraphCandidateExtractionError extends Error {
  readonly code: GraphCandidateAudit['code']
  readonly audit: GraphCandidateAudit
  constructor(audit: GraphCandidateAudit) {
    super(audit.code)
    this.name = 'GraphCandidateExtractionError'
    this.code = audit.code
    this.audit = audit
  }
}

type TokenRule = Readonly<{ stable_key: string; label: string; pattern: RegExp }>

const freezeRules = <T extends Record<string, readonly TokenRule[]>>(rules: T): Readonly<T> => {
  for (const values of Object.values(rules)) {
    for (const value of values) {
      Object.freeze(value.pattern)
      Object.freeze(value)
    }
    Object.freeze(values)
  }
  return Object.freeze(rules)
}

/**
 * These maps are the entire lexical vocabulary. There is intentionally no model
 * call, fuzzy matching, or inference fallback behind an unmatched source string.
 */
export const HIGGSFIELD_GRAPH_RULES = freezeRules({
  model: [
    { stable_key: 'model:seedance', label: 'Seedance', pattern: /\bseedance(?:\s+\d+(?:\.\d+)?)?\b/i },
    { stable_key: 'model:kling', label: 'Kling', pattern: /\bkling(?:\s+ai)?\b/i },
    { stable_key: 'model:veo', label: 'Veo', pattern: /\bveo(?:\s+\d+(?:\.\d+)?)?\b/i },
  ],
  style: [
    { stable_key: 'style:cinematic', label: 'Cinematic', pattern: /\bcinematic\b/i },
    { stable_key: 'style:anime', label: 'Anime', pattern: /\banime\b/i },
    { stable_key: 'style:cyberpunk', label: 'Cyberpunk', pattern: /\bcyberpunk\b/i },
    { stable_key: 'style:noir', label: 'Noir', pattern: /\bnoir\b/i },
    { stable_key: 'style:photorealistic', label: 'Photorealistic', pattern: /\bphotorealistic\b/i },
  ],
  technique: [
    { stable_key: 'technique:dolly-zoom', label: 'Dolly zoom', pattern: /\bdolly\s+zoom\b/i },
    { stable_key: 'technique:slow-motion', label: 'Slow motion', pattern: /\bslow\s+motion\b/i },
    { stable_key: 'technique:timelapse', label: 'Timelapse', pattern: /\btime\s*-?\s*lapse\b/i },
  ],
  subject: [
    { stable_key: 'subject:city', label: 'City', pattern: /\bcity\b/i },
    { stable_key: 'subject:portrait', label: 'Portrait', pattern: /\bportrait\b/i },
    { stable_key: 'subject:landscape', label: 'Landscape', pattern: /\blandscape\b/i },
  ],
  use_case: [
    { stable_key: 'use_case:music-video', label: 'Music video', pattern: /\bmusic\s+video\b/i },
    { stable_key: 'use_case:product-showcase', label: 'Product showcase', pattern: /\bproduct\s+showcase\b/i },
    { stable_key: 'use_case:social-media', label: 'Social media', pattern: /\bsocial\s+media\b/i },
  ],
})

const freezePatternMap = <T extends Record<string, RegExp>>(patterns: T): Readonly<T> => {
  for (const pattern of Object.values(patterns)) Object.freeze(pattern)
  return Object.freeze(patterns)
}

const DIRECT_FIELD_PATTERNS = freezePatternMap({
  style: /\bstyle\s*:\s*([^\n,.]+)/i,
  technique: /\btechnique\s*:\s*([^\n,.]+)/i,
  subject: /\bsubject\s*:\s*([^\n,.]+)/i,
  use_case: /\buse\s*case\s*:\s*([^\n,.]+)/i,
})

const candidateID = (value: string): string => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16]!, 16) % 4]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

const slug = (value: string): string => value
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const sourceEvidence = (artifact: ImportedPromptArtifact, target?: ImportedVariationReference): readonly SourceEvidenceRef[] => {
  const refs = [
    { type: 'source' as const, id: artifact.source.id, source_version_hash: artifact.source.source_version_hash },
    ...(target?.source_evidence === undefined || target.source_evidence === null ? [] : [{ type: 'source' as const, id: target.source_evidence.id, source_version_hash: target.source_evidence.source_version_hash }]),
  ]
  const unique = new Map<string, SourceEvidenceRef>()
  for (const ref of refs) unique.set(`${ref.id}\u0000${ref.source_version_hash}`, Object.freeze(ref))
  return Object.freeze([...unique.values()].sort((left, right) => compareGraphBytes(`${left.id}\u0000${left.source_version_hash}`, `${right.id}\u0000${right.source_version_hash}`)))
}

const artifactRef = (artifact: ImportedPromptArtifact): Readonly<{ type: 'artifact'; id: string }> =>
  Object.freeze({ type: 'artifact', id: artifact.id })

const nodeRef = (node: GraphCandidateNode): Readonly<{ type: 'taxonomy_node'; id: string }> =>
  Object.freeze({ type: 'taxonomy_node', id: node.id })

const NODE_RELATIONS = {
  output: 'produces', model: 'generated_with', use_case: 'used_for', style: 'has_style',
  technique: 'uses_technique', subject: 'depicts', creator: 'created_by',
} as const satisfies Record<ExtractableNodeType, GraphRelation>

const relationFor = (nodeType: ExtractableNodeType): GraphRelation => NODE_RELATIONS[nodeType]

const extractionError = (
  artifact: ImportedPromptArtifact,
  options: GraphCandidateExtractionOptions,
  code: GraphCandidateAudit['code'],
  stableKey: string,
  labels: readonly string[],
): never => {
  const audit = Object.freeze({ event: 'graph_candidate_extraction_rejected' as const, code, artifact_id: artifact.id, stable_key: stableKey, labels: Object.freeze([...labels]) })
  options.auditSink?.append(audit)
  throw new GraphCandidateExtractionError(audit)
}

const nodeFrom = (
  artifact: ImportedPromptArtifact,
  nodeType: ExtractableNodeType,
  stableKey: string,
  label: string,
  identity?: string,
): GraphCandidateNode | undefined => {
  const normalizedLabel = label.trim()
  if (!normalizedLabel || !stableKey) return undefined
  if (!stableKey.startsWith(`${nodeType}:`) || stableKey.length === nodeType.length + 1) {
    throw new GraphCandidateExtractionError(Object.freeze({ event: 'graph_candidate_extraction_rejected', code: 'invalid_stable_key', artifact_id: artifact.id, stable_key: stableKey, labels: Object.freeze([normalizedLabel]) }))
  }
  return Object.freeze({
    id: candidateID(`${artifact.id}:${nodeType}:${identity ?? stableKey}:${artifact.source.source_version_hash}`),
    node_type: nodeType,
    stable_key: stableKey,
    label: normalizedLabel,
    description: normalizedLabel,
    promotion_state: GRAPH_CANDIDATE_REVIEW_STATE,
    review_state: GRAPH_CANDIDATE_REVIEW_STATE,
    evidence_refs: sourceEvidence(artifact),
    source_version_hash: artifact.source.source_version_hash,
    confidence: 1,
  })
}

const edgeFrom = (
  artifact: ImportedPromptArtifact,
  from: GraphCandidateEdge['from'],
  relation: GraphRelation,
  to: GraphCandidateEdge['to'],
  target?: ImportedVariationReference,
): GraphCandidateEdge => Object.freeze({
  id: candidateID(`${from.type}:${from.id}:${relation}:${to.type}:${to.id}:${sourceEvidence(artifact, target).map((ref) => `${ref.id}:${ref.source_version_hash}`).join('|')}`),
  from,
  relation,
  to,
  evidence_refs: sourceEvidence(artifact, target),
  source_version_hash: artifact.source.source_version_hash,
  evidence_revision: artifact.source.source_version_hash,
  confidence: 1,
  review_state: GRAPH_CANDIDATE_REVIEW_STATE,
})

const directFieldNodes = (artifact: ImportedPromptArtifact): GraphCandidateNode[] => {
  const text = artifact.prompt.original_text
  const nodes: GraphCandidateNode[] = []
  for (const [nodeType, pattern] of Object.entries(DIRECT_FIELD_PATTERNS) as [ExtractableNodeType, RegExp][]) {
    const match = pattern.exec(text)
    const label = match?.[1]?.trim()
    const key = label === undefined ? '' : slug(label)
    const node = key ? nodeFrom(artifact, nodeType, `${nodeType}:${key}`, label!, `explicit:${key}`) : undefined
    if (node) nodes.push(node)
  }
  return nodes
}

const lexicalNodes = (artifact: ImportedPromptArtifact): GraphCandidateNode[] => {
  const text = `${artifact.canonical_label}\n${artifact.prompt.original_text}`
  const nodes: GraphCandidateNode[] = []
  for (const [nodeType, rules] of Object.entries(HIGGSFIELD_GRAPH_RULES) as [ExtractableNodeType, readonly TokenRule[]][]) {
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        const node = nodeFrom(artifact, nodeType, rule.stable_key, rule.label, `rule:${rule.stable_key}`)
        if (node) nodes.push(node)
      }
    }
  }
  return nodes
}

const structuredNodes = (artifact: ImportedPromptArtifact, options: GraphCandidateExtractionOptions): GraphCandidateNode[] => {
  const nodes: GraphCandidateNode[] = []
  const mediaType = artifact.outcome?.media_type
  if (mediaType === 'image' || mediaType === 'video') {
    const node = nodeFrom(artifact, 'output', `output:${mediaType}`, mediaType === 'image' ? 'Image' : 'Video')
    if (node) nodes.push(node)
  }
  const capability = artifact.outcome?.capability?.trim()
  if (capability) {
    const key = slug(capability)
    const node = key ? nodeFrom(artifact, 'use_case', `use_case:${key}`, capability, `capability:${key}`) : undefined
    if (node) nodes.push(node)
  }
  const creator = artifact.source.creator?.trim()
  if (creator) {
    const key = slug(creator.replace(/^@/, ''))
    const node = key ? nodeFrom(artifact, 'creator', `creator:${key}`, creator, `creator:${key}`) : undefined
    if (node) nodes.push(node)
  }
  for (const reference of [...(artifact.model_refs ?? []), ...(artifact.taxonomy_refs ?? [])]) {
    const suppliedStableKey = reference.stable_key ?? undefined
    const prefix = `${reference.node_type}:`
    const suffix = suppliedStableKey?.startsWith(prefix) ? suppliedStableKey.slice(prefix.length) : ''
    const canonicalStableKey = `${reference.node_type}:${slug(suffix)}`
    if (suppliedStableKey !== undefined && (!suffix || suppliedStableKey !== canonicalStableKey)) {
      extractionError(artifact, options, 'invalid_stable_key', suppliedStableKey, [reference.label])
    }
    const key = suppliedStableKey ?? `${reference.node_type}:${slug(reference.label)}`
    const node = nodeFrom(artifact, reference.node_type, key, reference.label, `reference:${reference.id}`)
    if (node) nodes.push(node)
  }
  return nodes
}

const collisionIdentity = (label: string): string => label.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')

const uniqueNodes = (artifact: ImportedPromptArtifact, nodes: readonly GraphCandidateNode[], options: GraphCandidateExtractionOptions): GraphCandidateNode[] => {
  const byStableKey = new Map<string, GraphCandidateNode>()
  for (const node of nodes) {
    const existing = byStableKey.get(node.stable_key)
    if (existing === undefined) byStableKey.set(node.stable_key, node)
    else if (collisionIdentity(existing.label) !== collisionIdentity(node.label)) {
      extractionError(artifact, options, 'stable_key_collision', node.stable_key, [existing.label, node.label])
    }
  }
  return [...byStableKey.values()].sort((left, right) => compareGraphBytes(left.stable_key, right.stable_key))
}

const extractEdges = (artifact: ImportedPromptArtifact, nodes: readonly GraphCandidateNode[]): GraphCandidateEdge[] => {
  const fromArtifact = artifactRef(artifact)
  const edges = nodes.map((node) => edgeFrom(artifact, fromArtifact, relationFor(node.node_type), nodeRef(node)))
  const models = nodes.filter((node) => node.node_type === 'model')
  const styles = nodes.filter((node) => node.node_type === 'style')
  for (const model of models) for (const style of styles) edges.push(edgeFrom(artifact, nodeRef(model), 'has_style', nodeRef(style)))
  for (const variation of artifact.variation_refs ?? []) {
    if (
      variation.id.trim() &&
      variation.source_evidence?.id.trim() &&
      /^sha256:v1:[a-f0-9]{64}$/.test(variation.source_evidence.source_version_hash)
    ) edges.push(edgeFrom(artifact, fromArtifact, 'variation_of', Object.freeze({ type: 'artifact', id: variation.id }), variation))
  }
  const byID = new Map<string, GraphCandidateEdge>()
  for (const edge of edges) if (!byID.has(edge.id)) byID.set(edge.id, edge)
  return [...byID.values()].sort((left, right) => compareGraphBytes(left.id, right.id))
}

const extractNavigationCandidates = (nodes: readonly GraphCandidateNode[]): CandidateNavigation[] =>
  nodes
    .filter((node) => ['model', 'style', 'technique', 'subject', 'use_case'].includes(node.node_type))
    .map((node) => Object.freeze({
      node_id: node.id,
      label: node.label,
      link_policy: 'dead_text' as const,
      href: null,
      render_target: 'tag' as const,
      target_indexability: 'none' as const,
    }))
    .sort((left, right) => compareGraphBytes(left.node_id, right.node_id))

const freezeNodes = (nodes: readonly GraphCandidateNode[]): readonly GraphCandidateNode[] => Object.freeze([...nodes])
const freezeEdges = (edges: readonly GraphCandidateEdge[]): readonly GraphCandidateEdge[] => Object.freeze([...edges])

export type ReviewableGraphCandidateBatch = Readonly<{
  nodes: readonly CandidateNode[]
  edges: readonly CandidateEdge[]
}>
export type GraphCandidateBatchSink = Readonly<{
  appendNode: (node: CandidateNode) => Promise<void> | void
  appendEdge: (edge: CandidateEdge) => Promise<void> | void
}>

const reviewEvidenceRefs = (candidate: Readonly<{ evidence_refs: readonly SourceEvidenceRef[] }>) =>
  Object.freeze(candidate.evidence_refs.map((ref) => Object.freeze({ sourceId: ref.id, revision: ref.source_version_hash })))

const reviewEvidenceRevision = (candidate: Readonly<{ evidence_refs: readonly SourceEvidenceRef[] }>): string =>
  evidenceRevisionHash(candidate.evidence_refs.map((ref) => ({ sourceId: ref.id, revision: ref.source_version_hash, rightsState: 'metadata_only' as const, available: true })))

export const toReviewableGraphCandidates = (batch: GraphCandidateBatch): ReviewableGraphCandidateBatch => Object.freeze({
  nodes: Object.freeze(batch.nodes.map((node): CandidateNode => Object.freeze({
    id: node.id, revision: 1, nodeType: node.node_type, stableKey: node.stable_key,
    label: node.label, description: node.description, evidenceRefs: reviewEvidenceRefs(node), confidence: node.confidence,
    reviewState: GRAPH_CANDIDATE_REVIEW_STATE, promotionState: GRAPH_CANDIDATE_REVIEW_STATE,
    proposerId: batch.reviewContext.proposerId, evidenceRevision: reviewEvidenceRevision(node),
    safetyState: batch.reviewContext.safetyState, rightsState: batch.reviewContext.rightsState,
  }))),
  edges: Object.freeze(batch.edges.map((edge): CandidateEdge => Object.freeze({
    id: edge.id, revision: 1, fromArtifactId: edge.from.id, toArtifactId: edge.to.id, relation: edge.relation,
    evidenceRefs: reviewEvidenceRefs(edge), confidence: edge.confidence, reviewState: GRAPH_CANDIDATE_REVIEW_STATE,
    proposerId: batch.reviewContext.proposerId, evidenceRevision: reviewEvidenceRevision(edge),
    safetyState: batch.reviewContext.safetyState, rightsState: batch.reviewContext.rightsState,
  }))),
})

export const persistGraphCandidateBatch = async (batch: GraphCandidateBatch, sink: GraphCandidateBatchSink): Promise<void> => {
  const candidates = toReviewableGraphCandidates(batch)
  for (const node of candidates.nodes) await sink.appendNode(node)
  for (const edge of candidates.edges) await sink.appendEdge(edge)
}

const reviewContext = (artifact: ImportedPromptArtifact) => Object.freeze({
  proposerId: 'higgsfield-extractor' as const,
  rightsState: artifact.source.rights_state,
  safetyState: artifact.source.safety_state,
})

export const extractGraphCandidates = (artifact: ImportedPromptArtifact, options: GraphCandidateExtractionOptions = {}): GraphCandidateBatch => {
  if (
    artifact.status !== 'approved' ||
    !artifact.id.trim() ||
    !artifact.source.id.trim() ||
    !/^sha256:v1:[a-f0-9]{64}$/.test(artifact.source.source_version_hash)
  ) return Object.freeze({
    nodes: freezeNodes([]), edges: freezeEdges([]), navigationCandidates: Object.freeze([]), reviewContext: reviewContext(artifact), ruleVersion: HIGGSFIELD_GRAPH_RULE_VERSION,
  })
  const nodes = uniqueNodes(artifact, [...structuredNodes(artifact, options), ...lexicalNodes(artifact), ...directFieldNodes(artifact)], options)
  return Object.freeze({
    nodes: freezeNodes(nodes),
    edges: freezeEdges(extractEdges(artifact, nodes)),
    navigationCandidates: Object.freeze(extractNavigationCandidates(nodes)),
    reviewContext: reviewContext(artifact),
    ruleVersion: HIGGSFIELD_GRAPH_RULE_VERSION,
  })
}
