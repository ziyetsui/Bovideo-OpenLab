/**
 * The collection-level declaration of the canonical contracts in `src/contracts`.
 * This is a schema mapping manifest, not a second source of enum or validation truth.
 */
export const CANONICAL_COLLECTION_MAPPING = {
  sources: { contract: 'source', unique: ['provider', 'provider_record_id', 'content_hash'], fields: ['raw_ref'] },
  'prompt-artifacts': {
    contract: 'artifact',
    unique: ['source', 'kind', 'source_version'],
    fields: ['original_language', 'prompt.original_text'],
  },
  'taxonomy-nodes': { contract: 'taxonomyNode', unique: ['node_type', 'stable_key'] },
  edges: { contract: 'edge', unique: ['from_key', 'relation', 'to_key', 'source_version'] },
  'locale-variants': {
    contract: 'localeVariant',
    unique: ['entity_key', 'locale', 'source_version'],
    fields: ['entity', 'locale', 'source_locale', 'localized_fields', 'content_revision', 'workflow_state', 'last_content_editor', 'reviewed_by', 'reviewed_revision', 'is_money_page', 'published_version'],
  },
  'page-records': {
    contract: 'pageCandidate',
    unique: ['page_type', 'root_object_key', 'locale'],
    fields: ['page_type', 'root_object', 'locale', 'intent', 'index_state', 'qualification_input_hash', 'qualification_rule_version', 'approval_edge', 'approval_evidence', 'reason_codes'],
  },
  'module-envelopes': {
    contract: 'moduleEnvelope',
    unique: ['page_id', 'locale', 'module_type', 'module_version'],
    fields: ['module_id', 'page_id', 'locale', 'module_type', 'module_version', 'payload', 'slot_key', 'position', 'source_refs', 'dependency_refs', 'dependency_hash', 'rights_state', 'generated_by', 'generator_version', 'content_hash', 'quality_result', 'risk_classes', 'visibility', 'renderer_version', 'stale_reason', 'observed_at', 'expires_at', 'review_state'],
  },
  'media-evidence': { contract: 'mediaEvidence', unique: ['provider', 'provider_media_id'] },
  'page-projections': { contract: 'pageProjection', unique: ['projection_id'] },
  'publication-snapshots': { contract: 'publicationSnapshot', unique: ['publish_version'] },
  'publication-states': { contract: 'publicationStateRecord', unique: ['publish_version'] },
  'active-publication-pointers': {
    contract: 'activePublicationPointer',
    unique: ['singleton_key'],
  },
  redirects: { contract: 'redirect', unique: ['locale', 'old_path'], fields: ['id', 'schema_version', 'revision', 'source_version', 'locale', 'old_path', 'target_path', 'status', 'reason_code', 'created_at', 'audit'] },
  'workflow-runs': { contract: 'workflowRun', unique: ['job_type', 'idempotency_key'], fields: ['id', 'schema_version', 'revision', 'source_version', 'job_type', 'idempotency_key', 'attempt', 'input_ref', 'output_ref', 'status', 'error_class', 'created_at', 'updated_at', 'audit'] },
  'deletion-requests': { contract: 'deletionRequest', unique: ['external_request_key'], fields: ['external_request_key', 'scope', 'requested_by', 'legal_basis', 'object_refs', 'deadline', 'status', 'reason_code', 'revision'] },
  'audit-events': { contract: 'auditEvent', unique: ['event_id'] },
  'golden-replacement-approvals': {
    contract: 'goldenReplacementApproval',
    unique: ['baseline_manifest_hash', 'candidate_manifest_hash', 'evaluator_version'],
    fields: ['baseline_manifest_hash', 'candidate_manifest_hash', 'evaluator_version', 'reviewer_user', 'reviewer_actor_id', 'reviewer_role', 'correlation_id', 'approved_at', 'audit_ref', 'audit_outcome', 'audit'],
  },
} as const
