import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."_locales" AS ENUM('en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN');
  CREATE TYPE "public"."enum_users_roles" AS ENUM('admin', 'editor', 'translator', 'reviewer', 'publisher', 'legal');
  CREATE TYPE "public"."enum_users_service_scopes" AS ENUM('ingest', 'translate', 'publish', 'withdraw');
  CREATE TYPE "public"."enum_users_identity_kind" AS ENUM('human', 'service');
  CREATE TYPE "public"."enum_sources_status" AS ENUM('active', 'superseded', 'removed');
  CREATE TYPE "public"."enum_sources_provider" AS ENUM('twitter241', 'first_party', 'submission', 'official_doc');
  CREATE TYPE "public"."enum_sources_rights_state" AS ENUM('unknown', 'metadata_only', 'display_licensed', 'redistribution_licensed', 'first_party', 'blocked', 'revoked');
  CREATE TYPE "public"."enum_sources_deletion_state" AS ENUM('active', 'requested', 'removed');
  CREATE TYPE "public"."enum_prompt_artifacts_status" AS ENUM('draft', 'review', 'approved', 'published', 'blocked', 'withdrawn');
  CREATE TYPE "public"."enum_prompt_artifacts_kind" AS ENUM('prompt', 'workflow', 'comparison');
  CREATE TYPE "public"."enum_prompt_artifacts_outcome_media_type" AS ENUM('image', 'video', 'unresolved');
  CREATE TYPE "public"."enum_prompt_artifacts_rights_state" AS ENUM('unknown', 'metadata_only', 'display_licensed', 'redistribution_licensed', 'first_party', 'blocked', 'revoked');
  CREATE TYPE "public"."enum_prompt_artifacts_safety_state" AS ENUM('pending', 'approved', 'blocked');
  CREATE TYPE "public"."enum_prompt_artifacts_evidence_state" AS ENUM('pending', 'verified', 'insufficient');
  CREATE TYPE "public"."enum_taxonomy_nodes_status" AS ENUM('active', 'retired');
  CREATE TYPE "public"."enum_taxonomy_nodes_node_type" AS ENUM('output', 'model', 'use_case', 'style', 'technique', 'creator', 'subject');
  CREATE TYPE "public"."enum_taxonomy_nodes_promotion_state" AS ENUM('candidate', 'reviewed', 'qualified', 'retired');
  CREATE TYPE "public"."enum_page_records_primary_keyword_by_locale_locale" AS ENUM('en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN');
  CREATE TYPE "public"."enum_page_records_status" AS ENUM('active', 'retired');
  CREATE TYPE "public"."enum_page_records_page_type" AS ENUM('hub', 'gallery', 'entity', 'detail');
  CREATE TYPE "public"."enum_page_records_locale" AS ENUM('en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN');
  CREATE TYPE "public"."enum_page_records_index_state" AS ENUM('not_generated', 'discoverable_noindex', 'index_candidate', 'indexable', 'retired');
  CREATE TYPE "public"."enum_locale_variants_status" AS ENUM('active', 'withdrawn');
  CREATE TYPE "public"."enum_locale_variants_locale" AS ENUM('en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN');
  CREATE TYPE "public"."enum_locale_variants_source_locale" AS ENUM('en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN');
  CREATE TYPE "public"."enum_locale_variants_quality_placeholder_integrity" AS ENUM('pass', 'fail');
  CREATE TYPE "public"."enum_locale_variants_quality_factual_consistency" AS ENUM('pass', 'fail');
  CREATE TYPE "public"."enum_locale_variants_quality_language_detection" AS ENUM('pass', 'fail');
  CREATE TYPE "public"."enum_locale_variants_workflow_state" AS ENUM('missing', 'machine_draft', 'review', 'approved', 'published', 'blocked', 'stale', 'withdrawn');
  CREATE TYPE "public"."enum_edges_status" AS ENUM('active', 'retired');
  CREATE TYPE "public"."enum_edges_relation" AS ENUM('generated_with', 'produces', 'belongs_to', 'variation_of', 'supports', 'authored_by', 'sourced_from');
  CREATE TYPE "public"."enum_edges_review_state" AS ENUM('candidate', 'approved', 'rejected');
  CREATE TYPE "public"."enum_audit_events_status" AS ENUM('recorded');
  CREATE TYPE "public"."enum_audit_events_actor_type" AS ENUM('user', 'service', 'anonymous');
  CREATE TYPE "public"."enum_audit_events_outcome" AS ENUM('allowed', 'denied', 'failed');
  CREATE TYPE "public"."enum_module_envelopes_status" AS ENUM('active', 'blocked', 'stale');
  CREATE TYPE "public"."enum_module_envelopes_locale" AS ENUM('en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN');
  CREATE TYPE "public"."enum_module_envelopes_module_type" AS ENUM('case', 'tutorial', 'prompt', 'comparison', 'faq', 'examples', 'provenance', 'action');
  CREATE TYPE "public"."enum_module_envelopes_rights_state" AS ENUM('unknown', 'metadata_only', 'display_licensed', 'redistribution_licensed', 'first_party', 'blocked', 'revoked');
  CREATE TYPE "public"."enum_module_envelopes_generated_by" AS ENUM('human', 'rule', 'rpa', 'llm');
  CREATE TYPE "public"."enum_module_envelopes_review_state" AS ENUM('candidate', 'approved', 'blocked', 'stale');
  CREATE TYPE "public"."enum_publication_snapshots_status" AS ENUM('recorded');
  CREATE TYPE "public"."enum_publication_states_status" AS ENUM('draft', 'preparing', 'validated', 'active', 'superseded', 'rolled_back', 'failed');
  CREATE TYPE "public"."enum_redirects_status" AS ENUM('301', '308', '410');
  CREATE TYPE "public"."enum_redirects_locale" AS ENUM('en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'hi-IN', 'th-TH', 'tr-TR', 'vi-VN');
  CREATE TYPE "public"."enum_workflow_runs_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'stale_ignored');
  CREATE TYPE "public"."enum_workflow_runs_job_type" AS ENUM('ingest', 'translate', 'browser', 'publish', 'export', 'withdraw');
  CREATE TYPE "public"."enum_deletion_requests_status" AS ENUM('received', 'validated', 'withdrawing', 'surfaces_pending', 'completed', 'rejected', 'cancelled');
  CREATE TYPE "public"."enum_deletion_requests_scope" AS ENUM('source', 'artifact', 'locale', 'page', 'export');
  CREATE TABLE "users_roles" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_users_roles",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "users_service_scopes" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_users_service_scopes",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"identity_kind" "enum_users_identity_kind" DEFAULT 'human' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"object_ref" jsonb NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric
  );
  
  CREATE TABLE "sources" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_sources_status" DEFAULT 'active' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"provider" "enum_sources_provider" NOT NULL,
  	"provider_record_id" varchar NOT NULL,
  	"canonical_url" varchar NOT NULL,
  	"raw_ref" jsonb NOT NULL,
  	"captured_at" timestamp(3) with time zone NOT NULL,
  	"content_hash" varchar NOT NULL,
  	"author_ref_id" integer,
  	"rights_state" "enum_sources_rights_state" NOT NULL,
  	"rights_basis" varchar,
  	"deletion_state" "enum_sources_deletion_state" DEFAULT 'active' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "prompt_artifacts_prompt_variables" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"token" varchar NOT NULL,
  	"description" varchar,
  	"allowed_values" jsonb,
  	"occurrences" numeric
  );
  
  CREATE TABLE "prompt_artifacts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_prompt_artifacts_status" DEFAULT 'draft' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"kind" "enum_prompt_artifacts_kind" NOT NULL,
  	"canonical_label" varchar NOT NULL,
  	"prompt_original_text" varchar NOT NULL,
  	"original_language" varchar DEFAULT 'en' NOT NULL,
  	"outcome_media_type" "enum_prompt_artifacts_outcome_media_type",
  	"outcome_summary" varchar,
  	"outcome_capability" varchar,
  	"inputs_required" jsonb,
  	"inputs_optional" jsonb,
  	"parameters" jsonb,
  	"examples" jsonb,
  	"workflow_steps" jsonb,
  	"signals" jsonb,
  	"source_id" integer NOT NULL,
  	"rights_state" "enum_prompt_artifacts_rights_state" NOT NULL,
  	"safety_state" "enum_prompt_artifacts_safety_state" NOT NULL,
  	"evidence_state" "enum_prompt_artifacts_evidence_state" NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "prompt_artifacts_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"taxonomy_nodes_id" integer,
  	"prompt_artifacts_id" integer
  );
  
  CREATE TABLE "taxonomy_nodes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_taxonomy_nodes_status" DEFAULT 'active' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"node_type" "enum_taxonomy_nodes_node_type" NOT NULL,
  	"stable_key" varchar NOT NULL,
  	"label" varchar NOT NULL,
  	"description" varchar,
  	"promotion_state" "enum_taxonomy_nodes_promotion_state" DEFAULT 'candidate' NOT NULL,
  	"inventory_count" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "taxonomy_nodes_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"sources_id" integer
  );
  
  CREATE TABLE "page_records_primary_keyword_by_locale" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"locale" "enum_page_records_primary_keyword_by_locale_locale" NOT NULL,
  	"keyword" varchar NOT NULL
  );
  
  CREATE TABLE "page_records" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_page_records_status" DEFAULT 'active' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"page_type" "enum_page_records_page_type" NOT NULL,
  	"locale" "enum_page_records_locale" NOT NULL,
  	"root_object_key" varchar NOT NULL,
  	"intent" varchar NOT NULL,
  	"inventory" jsonb NOT NULL,
  	"demand_evidence" jsonb,
  	"information_gain" jsonb,
  	"qualification_score" jsonb NOT NULL,
  	"qualification_input_hash" varchar NOT NULL,
  	"qualification_rule_version" varchar NOT NULL,
  	"approval_edge_id" integer,
  	"index_state" "enum_page_records_index_state" DEFAULT 'not_generated' NOT NULL,
  	"reason_codes" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "page_records_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"prompt_artifacts_id" integer,
  	"taxonomy_nodes_id" integer,
  	"sources_id" integer
  );
  
  CREATE TABLE "locale_variants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_locale_variants_status" DEFAULT 'active' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"entity_key" varchar NOT NULL,
  	"locale" "enum_locale_variants_locale" NOT NULL,
  	"source_locale" "enum_locale_variants_source_locale" NOT NULL,
  	"translation_model" varchar NOT NULL,
  	"translation_prompt_version" varchar NOT NULL,
  	"localized_fields" jsonb NOT NULL,
  	"content_revision" numeric NOT NULL,
  	"quality_terminology_score" numeric,
  	"quality_placeholder_integrity" "enum_locale_variants_quality_placeholder_integrity",
  	"quality_factual_consistency" "enum_locale_variants_quality_factual_consistency",
  	"quality_language_detection" "enum_locale_variants_quality_language_detection",
  	"quality_human_score" numeric,
  	"workflow_state" "enum_locale_variants_workflow_state" DEFAULT 'missing' NOT NULL,
  	"reviewed_by_id" integer,
  	"reviewed_by_stable_id" varchar,
  	"reviewed_revision" numeric,
  	"last_content_editor_id" integer,
  	"last_content_editor_stable_id" varchar,
  	"is_money_page" boolean DEFAULT false NOT NULL,
  	"reviewed_at" timestamp(3) with time zone,
  	"published_version" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "locale_variants_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"prompt_artifacts_id" integer,
  	"taxonomy_nodes_id" integer,
  	"page_records_id" integer
  );
  
  CREATE TABLE "edges" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_edges_status" DEFAULT 'active' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"from_key" varchar NOT NULL,
  	"relation" "enum_edges_relation" NOT NULL,
  	"to_key" varchar NOT NULL,
  	"confidence" numeric NOT NULL,
  	"review_state" "enum_edges_review_state" DEFAULT 'candidate' NOT NULL,
  	"valid_from" timestamp(3) with time zone,
  	"valid_to" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "edges_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"sources_id" integer,
  	"prompt_artifacts_id" integer,
  	"taxonomy_nodes_id" integer
  );
  
  CREATE TABLE "audit_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_audit_events_status" DEFAULT 'recorded' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"event_id" varchar NOT NULL,
  	"actor_user_id" integer,
  	"actor_type" "enum_audit_events_actor_type" NOT NULL,
  	"actor_stable_id" varchar NOT NULL,
  	"actor_service" varchar,
  	"correlation_id" varchar NOT NULL,
  	"causation_id" varchar,
  	"event_type" varchar NOT NULL,
  	"entity_type" varchar NOT NULL,
  	"entity_stable_id" varchar NOT NULL,
  	"outcome" "enum_audit_events_outcome" NOT NULL,
  	"prior_state" jsonb,
  	"new_state" jsonb,
  	"reason_code" varchar,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "module_envelopes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_module_envelopes_status" DEFAULT 'active' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"module_id" varchar NOT NULL,
  	"page_id" varchar NOT NULL,
  	"locale" "enum_module_envelopes_locale" NOT NULL,
  	"module_type" "enum_module_envelopes_module_type" NOT NULL,
  	"module_version" numeric NOT NULL,
  	"rights_state" "enum_module_envelopes_rights_state" NOT NULL,
  	"content_hash" varchar NOT NULL,
  	"generated_by" "enum_module_envelopes_generated_by" NOT NULL,
  	"generator_version" varchar,
  	"observed_at" timestamp(3) with time zone NOT NULL,
  	"expires_at" timestamp(3) with time zone,
  	"review_state" "enum_module_envelopes_review_state" NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "module_envelopes_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"sources_id" integer
  );
  
  CREATE TABLE "publication_snapshots" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_publication_snapshots_status" DEFAULT 'recorded' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"publish_version" numeric NOT NULL,
  	"route_manifest_ref" varchar NOT NULL,
  	"sitemap_manifest_ref" varchar NOT NULL,
  	"github_manifest_ref" varchar NOT NULL,
  	"content_tree_hash" varchar NOT NULL,
  	"previous_verified_version" numeric,
  	"validation_report_ref" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "publication_states" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_publication_states_status" DEFAULT 'draft' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"publish_version" numeric NOT NULL,
  	"reason_code" varchar,
  	"activated_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "active_publication_pointers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 0 NOT NULL,
  	"singleton_key" varchar DEFAULT 'active-publication' NOT NULL,
  	"publish_version" numeric,
  	"previous_verified_version" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "redirects" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_redirects_status" DEFAULT '301' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"locale" "enum_redirects_locale" NOT NULL,
  	"old_path" varchar NOT NULL,
  	"target_path" varchar,
  	"reason_code" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "workflow_runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_workflow_runs_status" DEFAULT 'queued' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"job_type" "enum_workflow_runs_job_type" NOT NULL,
  	"idempotency_key" varchar NOT NULL,
  	"attempt" numeric DEFAULT 0 NOT NULL,
  	"input_ref" varchar NOT NULL,
  	"output_ref" varchar,
  	"error_class" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "deletion_requests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stable_id" varchar NOT NULL,
  	"revision" numeric DEFAULT 1 NOT NULL,
  	"schema_version" numeric DEFAULT 1 NOT NULL,
  	"source_version" varchar NOT NULL,
  	"status" "enum_deletion_requests_status" DEFAULT 'received' NOT NULL,
  	"audit_created_by_id" integer,
  	"audit_updated_by_id" integer,
  	"audit_correlation_id" varchar,
  	"external_request_key" varchar NOT NULL,
  	"scope" "enum_deletion_requests_scope" NOT NULL,
  	"requested_by_id" integer NOT NULL,
  	"legal_basis" varchar NOT NULL,
  	"object_refs" jsonb NOT NULL,
  	"deadline" timestamp(3) with time zone,
  	"reason_code" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"media_id" integer,
  	"sources_id" integer,
  	"prompt_artifacts_id" integer,
  	"taxonomy_nodes_id" integer,
  	"page_records_id" integer,
  	"locale_variants_id" integer,
  	"edges_id" integer,
  	"audit_events_id" integer,
  	"module_envelopes_id" integer,
  	"publication_snapshots_id" integer,
  	"publication_states_id" integer,
  	"active_publication_pointers_id" integer,
  	"redirects_id" integer,
  	"workflow_runs_id" integer,
  	"deletion_requests_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_service_scopes" ADD CONSTRAINT "users_service_scopes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sources" ADD CONSTRAINT "sources_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sources" ADD CONSTRAINT "sources_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sources" ADD CONSTRAINT "sources_author_ref_id_taxonomy_nodes_id_fk" FOREIGN KEY ("author_ref_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "prompt_artifacts_prompt_variables" ADD CONSTRAINT "prompt_artifacts_prompt_variables_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."prompt_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "prompt_artifacts" ADD CONSTRAINT "prompt_artifacts_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "prompt_artifacts" ADD CONSTRAINT "prompt_artifacts_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "prompt_artifacts" ADD CONSTRAINT "prompt_artifacts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "prompt_artifacts_rels" ADD CONSTRAINT "prompt_artifacts_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."prompt_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "prompt_artifacts_rels" ADD CONSTRAINT "prompt_artifacts_rels_taxonomy_nodes_fk" FOREIGN KEY ("taxonomy_nodes_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "prompt_artifacts_rels" ADD CONSTRAINT "prompt_artifacts_rels_prompt_artifacts_fk" FOREIGN KEY ("prompt_artifacts_id") REFERENCES "public"."prompt_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "taxonomy_nodes_rels" ADD CONSTRAINT "taxonomy_nodes_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "taxonomy_nodes_rels" ADD CONSTRAINT "taxonomy_nodes_rels_sources_fk" FOREIGN KEY ("sources_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "page_records_primary_keyword_by_locale" ADD CONSTRAINT "page_records_primary_keyword_by_locale_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."page_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "page_records" ADD CONSTRAINT "page_records_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "page_records" ADD CONSTRAINT "page_records_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "page_records" ADD CONSTRAINT "page_records_approval_edge_id_edges_id_fk" FOREIGN KEY ("approval_edge_id") REFERENCES "public"."edges"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "page_records_rels" ADD CONSTRAINT "page_records_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "page_records_rels" ADD CONSTRAINT "page_records_rels_prompt_artifacts_fk" FOREIGN KEY ("prompt_artifacts_id") REFERENCES "public"."prompt_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "page_records_rels" ADD CONSTRAINT "page_records_rels_taxonomy_nodes_fk" FOREIGN KEY ("taxonomy_nodes_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "page_records_rels" ADD CONSTRAINT "page_records_rels_sources_fk" FOREIGN KEY ("sources_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "locale_variants" ADD CONSTRAINT "locale_variants_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "locale_variants" ADD CONSTRAINT "locale_variants_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "locale_variants" ADD CONSTRAINT "locale_variants_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "locale_variants" ADD CONSTRAINT "locale_variants_last_content_editor_id_users_id_fk" FOREIGN KEY ("last_content_editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "locale_variants_rels" ADD CONSTRAINT "locale_variants_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locale_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "locale_variants_rels" ADD CONSTRAINT "locale_variants_rels_prompt_artifacts_fk" FOREIGN KEY ("prompt_artifacts_id") REFERENCES "public"."prompt_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "locale_variants_rels" ADD CONSTRAINT "locale_variants_rels_taxonomy_nodes_fk" FOREIGN KEY ("taxonomy_nodes_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "locale_variants_rels" ADD CONSTRAINT "locale_variants_rels_page_records_fk" FOREIGN KEY ("page_records_id") REFERENCES "public"."page_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edges" ADD CONSTRAINT "edges_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edges" ADD CONSTRAINT "edges_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edges_rels" ADD CONSTRAINT "edges_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."edges"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edges_rels" ADD CONSTRAINT "edges_rels_sources_fk" FOREIGN KEY ("sources_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edges_rels" ADD CONSTRAINT "edges_rels_prompt_artifacts_fk" FOREIGN KEY ("prompt_artifacts_id") REFERENCES "public"."prompt_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edges_rels" ADD CONSTRAINT "edges_rels_taxonomy_nodes_fk" FOREIGN KEY ("taxonomy_nodes_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "module_envelopes" ADD CONSTRAINT "module_envelopes_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "module_envelopes" ADD CONSTRAINT "module_envelopes_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "module_envelopes_rels" ADD CONSTRAINT "module_envelopes_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."module_envelopes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "module_envelopes_rels" ADD CONSTRAINT "module_envelopes_rels_sources_fk" FOREIGN KEY ("sources_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "publication_snapshots" ADD CONSTRAINT "publication_snapshots_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publication_snapshots" ADD CONSTRAINT "publication_snapshots_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publication_states" ADD CONSTRAINT "publication_states_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publication_states" ADD CONSTRAINT "publication_states_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "redirects" ADD CONSTRAINT "redirects_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "redirects" ADD CONSTRAINT "redirects_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_audit_created_by_id_users_id_fk" FOREIGN KEY ("audit_created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_audit_updated_by_id_users_id_fk" FOREIGN KEY ("audit_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sources_fk" FOREIGN KEY ("sources_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_prompt_artifacts_fk" FOREIGN KEY ("prompt_artifacts_id") REFERENCES "public"."prompt_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_taxonomy_nodes_fk" FOREIGN KEY ("taxonomy_nodes_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_page_records_fk" FOREIGN KEY ("page_records_id") REFERENCES "public"."page_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_locale_variants_fk" FOREIGN KEY ("locale_variants_id") REFERENCES "public"."locale_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_edges_fk" FOREIGN KEY ("edges_id") REFERENCES "public"."edges"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audit_events_fk" FOREIGN KEY ("audit_events_id") REFERENCES "public"."audit_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_module_envelopes_fk" FOREIGN KEY ("module_envelopes_id") REFERENCES "public"."module_envelopes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publication_snapshots_fk" FOREIGN KEY ("publication_snapshots_id") REFERENCES "public"."publication_snapshots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publication_states_fk" FOREIGN KEY ("publication_states_id") REFERENCES "public"."publication_states"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_active_publication_pointers_fk" FOREIGN KEY ("active_publication_pointers_id") REFERENCES "public"."active_publication_pointers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_redirects_fk" FOREIGN KEY ("redirects_id") REFERENCES "public"."redirects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_workflow_runs_fk" FOREIGN KEY ("workflow_runs_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_deletion_requests_fk" FOREIGN KEY ("deletion_requests_id") REFERENCES "public"."deletion_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_roles_order_idx" ON "users_roles" USING btree ("order");
  CREATE INDEX "users_roles_parent_idx" ON "users_roles" USING btree ("parent_id");
  CREATE INDEX "users_service_scopes_order_idx" ON "users_service_scopes" USING btree ("order");
  CREATE INDEX "users_service_scopes_parent_idx" ON "users_service_scopes" USING btree ("parent_id");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "users_stable_id_idx" ON "users" USING btree ("stable_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE UNIQUE INDEX "sources_stable_id_idx" ON "sources" USING btree ("stable_id");
  CREATE INDEX "sources_revision_idx" ON "sources" USING btree ("revision");
  CREATE INDEX "sources_source_version_idx" ON "sources" USING btree ("source_version");
  CREATE INDEX "sources_status_idx" ON "sources" USING btree ("status");
  CREATE INDEX "sources_audit_audit_created_by_idx" ON "sources" USING btree ("audit_created_by_id");
  CREATE INDEX "sources_audit_audit_updated_by_idx" ON "sources" USING btree ("audit_updated_by_id");
  CREATE INDEX "sources_audit_audit_correlation_id_idx" ON "sources" USING btree ("audit_correlation_id");
  CREATE INDEX "sources_provider_idx" ON "sources" USING btree ("provider");
  CREATE INDEX "sources_provider_record_id_idx" ON "sources" USING btree ("provider_record_id");
  CREATE INDEX "sources_captured_at_idx" ON "sources" USING btree ("captured_at");
  CREATE INDEX "sources_content_hash_idx" ON "sources" USING btree ("content_hash");
  CREATE INDEX "sources_author_ref_idx" ON "sources" USING btree ("author_ref_id");
  CREATE INDEX "sources_rights_state_idx" ON "sources" USING btree ("rights_state");
  CREATE INDEX "sources_deletion_state_idx" ON "sources" USING btree ("deletion_state");
  CREATE INDEX "sources_updated_at_idx" ON "sources" USING btree ("updated_at");
  CREATE INDEX "sources_created_at_idx" ON "sources" USING btree ("created_at");
  CREATE UNIQUE INDEX "provider_provider_record_id_content_hash_idx" ON "sources" USING btree ("provider","provider_record_id","content_hash");
  CREATE INDEX "rights_state_deletion_state_idx" ON "sources" USING btree ("rights_state","deletion_state");
  CREATE INDEX "prompt_artifacts_prompt_variables_order_idx" ON "prompt_artifacts_prompt_variables" USING btree ("_order");
  CREATE INDEX "prompt_artifacts_prompt_variables_parent_id_idx" ON "prompt_artifacts_prompt_variables" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "prompt_artifacts_stable_id_idx" ON "prompt_artifacts" USING btree ("stable_id");
  CREATE INDEX "prompt_artifacts_revision_idx" ON "prompt_artifacts" USING btree ("revision");
  CREATE INDEX "prompt_artifacts_source_version_idx" ON "prompt_artifacts" USING btree ("source_version");
  CREATE INDEX "prompt_artifacts_status_idx" ON "prompt_artifacts" USING btree ("status");
  CREATE INDEX "prompt_artifacts_audit_audit_created_by_idx" ON "prompt_artifacts" USING btree ("audit_created_by_id");
  CREATE INDEX "prompt_artifacts_audit_audit_updated_by_idx" ON "prompt_artifacts" USING btree ("audit_updated_by_id");
  CREATE INDEX "prompt_artifacts_audit_audit_correlation_id_idx" ON "prompt_artifacts" USING btree ("audit_correlation_id");
  CREATE INDEX "prompt_artifacts_canonical_label_idx" ON "prompt_artifacts" USING btree ("canonical_label");
  CREATE INDEX "prompt_artifacts_source_idx" ON "prompt_artifacts" USING btree ("source_id");
  CREATE INDEX "prompt_artifacts_rights_state_idx" ON "prompt_artifacts" USING btree ("rights_state");
  CREATE INDEX "prompt_artifacts_updated_at_idx" ON "prompt_artifacts" USING btree ("updated_at");
  CREATE INDEX "prompt_artifacts_created_at_idx" ON "prompt_artifacts" USING btree ("created_at");
  CREATE UNIQUE INDEX "source_kind_source_version_idx" ON "prompt_artifacts" USING btree ("source_id","kind","source_version");
  CREATE INDEX "prompt_artifacts_rels_order_idx" ON "prompt_artifacts_rels" USING btree ("order");
  CREATE INDEX "prompt_artifacts_rels_parent_idx" ON "prompt_artifacts_rels" USING btree ("parent_id");
  CREATE INDEX "prompt_artifacts_rels_path_idx" ON "prompt_artifacts_rels" USING btree ("path");
  CREATE INDEX "prompt_artifacts_rels_taxonomy_nodes_id_idx" ON "prompt_artifacts_rels" USING btree ("taxonomy_nodes_id");
  CREATE INDEX "prompt_artifacts_rels_prompt_artifacts_id_idx" ON "prompt_artifacts_rels" USING btree ("prompt_artifacts_id");
  CREATE UNIQUE INDEX "taxonomy_nodes_stable_id_idx" ON "taxonomy_nodes" USING btree ("stable_id");
  CREATE INDEX "taxonomy_nodes_revision_idx" ON "taxonomy_nodes" USING btree ("revision");
  CREATE INDEX "taxonomy_nodes_source_version_idx" ON "taxonomy_nodes" USING btree ("source_version");
  CREATE INDEX "taxonomy_nodes_status_idx" ON "taxonomy_nodes" USING btree ("status");
  CREATE INDEX "taxonomy_nodes_audit_audit_created_by_idx" ON "taxonomy_nodes" USING btree ("audit_created_by_id");
  CREATE INDEX "taxonomy_nodes_audit_audit_updated_by_idx" ON "taxonomy_nodes" USING btree ("audit_updated_by_id");
  CREATE INDEX "taxonomy_nodes_audit_audit_correlation_id_idx" ON "taxonomy_nodes" USING btree ("audit_correlation_id");
  CREATE INDEX "taxonomy_nodes_node_type_idx" ON "taxonomy_nodes" USING btree ("node_type");
  CREATE UNIQUE INDEX "taxonomy_nodes_stable_key_idx" ON "taxonomy_nodes" USING btree ("stable_key");
  CREATE INDEX "taxonomy_nodes_promotion_state_idx" ON "taxonomy_nodes" USING btree ("promotion_state");
  CREATE INDEX "taxonomy_nodes_updated_at_idx" ON "taxonomy_nodes" USING btree ("updated_at");
  CREATE INDEX "taxonomy_nodes_created_at_idx" ON "taxonomy_nodes" USING btree ("created_at");
  CREATE INDEX "node_type_promotion_state_idx" ON "taxonomy_nodes" USING btree ("node_type","promotion_state");
  CREATE UNIQUE INDEX "node_type_stable_key_idx" ON "taxonomy_nodes" USING btree ("node_type","stable_key");
  CREATE INDEX "taxonomy_nodes_rels_order_idx" ON "taxonomy_nodes_rels" USING btree ("order");
  CREATE INDEX "taxonomy_nodes_rels_parent_idx" ON "taxonomy_nodes_rels" USING btree ("parent_id");
  CREATE INDEX "taxonomy_nodes_rels_path_idx" ON "taxonomy_nodes_rels" USING btree ("path");
  CREATE INDEX "taxonomy_nodes_rels_sources_id_idx" ON "taxonomy_nodes_rels" USING btree ("sources_id");
  CREATE INDEX "page_records_primary_keyword_by_locale_order_idx" ON "page_records_primary_keyword_by_locale" USING btree ("_order");
  CREATE INDEX "page_records_primary_keyword_by_locale_parent_id_idx" ON "page_records_primary_keyword_by_locale" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "page_records_stable_id_idx" ON "page_records" USING btree ("stable_id");
  CREATE INDEX "page_records_revision_idx" ON "page_records" USING btree ("revision");
  CREATE INDEX "page_records_source_version_idx" ON "page_records" USING btree ("source_version");
  CREATE INDEX "page_records_status_idx" ON "page_records" USING btree ("status");
  CREATE INDEX "page_records_audit_audit_created_by_idx" ON "page_records" USING btree ("audit_created_by_id");
  CREATE INDEX "page_records_audit_audit_updated_by_idx" ON "page_records" USING btree ("audit_updated_by_id");
  CREATE INDEX "page_records_audit_audit_correlation_id_idx" ON "page_records" USING btree ("audit_correlation_id");
  CREATE INDEX "page_records_page_type_idx" ON "page_records" USING btree ("page_type");
  CREATE INDEX "page_records_locale_idx" ON "page_records" USING btree ("locale");
  CREATE INDEX "page_records_root_object_key_idx" ON "page_records" USING btree ("root_object_key");
  CREATE INDEX "page_records_qualification_input_hash_idx" ON "page_records" USING btree ("qualification_input_hash");
  CREATE INDEX "page_records_approval_edge_idx" ON "page_records" USING btree ("approval_edge_id");
  CREATE INDEX "page_records_index_state_idx" ON "page_records" USING btree ("index_state");
  CREATE INDEX "page_records_updated_at_idx" ON "page_records" USING btree ("updated_at");
  CREATE INDEX "page_records_created_at_idx" ON "page_records" USING btree ("created_at");
  CREATE INDEX "page_type_index_state_idx" ON "page_records" USING btree ("page_type","index_state");
  CREATE UNIQUE INDEX "page_type_root_object_key_locale_idx" ON "page_records" USING btree ("page_type","root_object_key","locale");
  CREATE INDEX "page_records_rels_order_idx" ON "page_records_rels" USING btree ("order");
  CREATE INDEX "page_records_rels_parent_idx" ON "page_records_rels" USING btree ("parent_id");
  CREATE INDEX "page_records_rels_path_idx" ON "page_records_rels" USING btree ("path");
  CREATE INDEX "page_records_rels_prompt_artifacts_id_idx" ON "page_records_rels" USING btree ("prompt_artifacts_id");
  CREATE INDEX "page_records_rels_taxonomy_nodes_id_idx" ON "page_records_rels" USING btree ("taxonomy_nodes_id");
  CREATE INDEX "page_records_rels_sources_id_idx" ON "page_records_rels" USING btree ("sources_id");
  CREATE UNIQUE INDEX "locale_variants_stable_id_idx" ON "locale_variants" USING btree ("stable_id");
  CREATE INDEX "locale_variants_revision_idx" ON "locale_variants" USING btree ("revision");
  CREATE INDEX "locale_variants_source_version_idx" ON "locale_variants" USING btree ("source_version");
  CREATE INDEX "locale_variants_status_idx" ON "locale_variants" USING btree ("status");
  CREATE INDEX "locale_variants_audit_audit_created_by_idx" ON "locale_variants" USING btree ("audit_created_by_id");
  CREATE INDEX "locale_variants_audit_audit_updated_by_idx" ON "locale_variants" USING btree ("audit_updated_by_id");
  CREATE INDEX "locale_variants_audit_audit_correlation_id_idx" ON "locale_variants" USING btree ("audit_correlation_id");
  CREATE INDEX "locale_variants_entity_key_idx" ON "locale_variants" USING btree ("entity_key");
  CREATE INDEX "locale_variants_locale_idx" ON "locale_variants" USING btree ("locale");
  CREATE INDEX "locale_variants_content_revision_idx" ON "locale_variants" USING btree ("content_revision");
  CREATE INDEX "locale_variants_workflow_state_idx" ON "locale_variants" USING btree ("workflow_state");
  CREATE INDEX "locale_variants_reviewed_by_idx" ON "locale_variants" USING btree ("reviewed_by_id");
  CREATE INDEX "locale_variants_reviewed_by_stable_id_idx" ON "locale_variants" USING btree ("reviewed_by_stable_id");
  CREATE INDEX "locale_variants_last_content_editor_idx" ON "locale_variants" USING btree ("last_content_editor_id");
  CREATE INDEX "locale_variants_last_content_editor_stable_id_idx" ON "locale_variants" USING btree ("last_content_editor_stable_id");
  CREATE INDEX "locale_variants_is_money_page_idx" ON "locale_variants" USING btree ("is_money_page");
  CREATE INDEX "locale_variants_updated_at_idx" ON "locale_variants" USING btree ("updated_at");
  CREATE INDEX "locale_variants_created_at_idx" ON "locale_variants" USING btree ("created_at");
  CREATE INDEX "locale_workflow_state_idx" ON "locale_variants" USING btree ("locale","workflow_state");
  CREATE UNIQUE INDEX "entity_key_locale_source_version_idx" ON "locale_variants" USING btree ("entity_key","locale","source_version");
  CREATE INDEX "locale_variants_rels_order_idx" ON "locale_variants_rels" USING btree ("order");
  CREATE INDEX "locale_variants_rels_parent_idx" ON "locale_variants_rels" USING btree ("parent_id");
  CREATE INDEX "locale_variants_rels_path_idx" ON "locale_variants_rels" USING btree ("path");
  CREATE INDEX "locale_variants_rels_prompt_artifacts_id_idx" ON "locale_variants_rels" USING btree ("prompt_artifacts_id");
  CREATE INDEX "locale_variants_rels_taxonomy_nodes_id_idx" ON "locale_variants_rels" USING btree ("taxonomy_nodes_id");
  CREATE INDEX "locale_variants_rels_page_records_id_idx" ON "locale_variants_rels" USING btree ("page_records_id");
  CREATE UNIQUE INDEX "edges_stable_id_idx" ON "edges" USING btree ("stable_id");
  CREATE INDEX "edges_revision_idx" ON "edges" USING btree ("revision");
  CREATE INDEX "edges_source_version_idx" ON "edges" USING btree ("source_version");
  CREATE INDEX "edges_status_idx" ON "edges" USING btree ("status");
  CREATE INDEX "edges_audit_audit_created_by_idx" ON "edges" USING btree ("audit_created_by_id");
  CREATE INDEX "edges_audit_audit_updated_by_idx" ON "edges" USING btree ("audit_updated_by_id");
  CREATE INDEX "edges_audit_audit_correlation_id_idx" ON "edges" USING btree ("audit_correlation_id");
  CREATE INDEX "edges_from_key_idx" ON "edges" USING btree ("from_key");
  CREATE INDEX "edges_relation_idx" ON "edges" USING btree ("relation");
  CREATE INDEX "edges_to_key_idx" ON "edges" USING btree ("to_key");
  CREATE INDEX "edges_review_state_idx" ON "edges" USING btree ("review_state");
  CREATE INDEX "edges_updated_at_idx" ON "edges" USING btree ("updated_at");
  CREATE INDEX "edges_created_at_idx" ON "edges" USING btree ("created_at");
  CREATE INDEX "relation_review_state_idx" ON "edges" USING btree ("relation","review_state");
  CREATE UNIQUE INDEX "from_key_relation_to_key_source_version_idx" ON "edges" USING btree ("from_key","relation","to_key","source_version");
  CREATE INDEX "edges_rels_order_idx" ON "edges_rels" USING btree ("order");
  CREATE INDEX "edges_rels_parent_idx" ON "edges_rels" USING btree ("parent_id");
  CREATE INDEX "edges_rels_path_idx" ON "edges_rels" USING btree ("path");
  CREATE INDEX "edges_rels_sources_id_idx" ON "edges_rels" USING btree ("sources_id");
  CREATE INDEX "edges_rels_prompt_artifacts_id_idx" ON "edges_rels" USING btree ("prompt_artifacts_id");
  CREATE INDEX "edges_rels_taxonomy_nodes_id_idx" ON "edges_rels" USING btree ("taxonomy_nodes_id");
  CREATE UNIQUE INDEX "audit_events_stable_id_idx" ON "audit_events" USING btree ("stable_id");
  CREATE INDEX "audit_events_revision_idx" ON "audit_events" USING btree ("revision");
  CREATE INDEX "audit_events_source_version_idx" ON "audit_events" USING btree ("source_version");
  CREATE INDEX "audit_events_status_idx" ON "audit_events" USING btree ("status");
  CREATE INDEX "audit_events_audit_audit_created_by_idx" ON "audit_events" USING btree ("audit_created_by_id");
  CREATE INDEX "audit_events_audit_audit_updated_by_idx" ON "audit_events" USING btree ("audit_updated_by_id");
  CREATE INDEX "audit_events_audit_audit_correlation_id_idx" ON "audit_events" USING btree ("audit_correlation_id");
  CREATE UNIQUE INDEX "audit_events_event_id_idx" ON "audit_events" USING btree ("event_id");
  CREATE INDEX "audit_events_actor_user_idx" ON "audit_events" USING btree ("actor_user_id");
  CREATE INDEX "audit_events_actor_stable_id_idx" ON "audit_events" USING btree ("actor_stable_id");
  CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events" USING btree ("correlation_id");
  CREATE INDEX "audit_events_event_type_idx" ON "audit_events" USING btree ("event_type");
  CREATE INDEX "audit_events_entity_type_idx" ON "audit_events" USING btree ("entity_type");
  CREATE INDEX "audit_events_entity_stable_id_idx" ON "audit_events" USING btree ("entity_stable_id");
  CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");
  CREATE INDEX "audit_events_updated_at_idx" ON "audit_events" USING btree ("updated_at");
  CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");
  CREATE INDEX "correlation_id_occurred_at_idx" ON "audit_events" USING btree ("correlation_id","occurred_at");
  CREATE INDEX "occurred_at_actor_user_idx" ON "audit_events" USING btree ("occurred_at","actor_user_id");
  CREATE INDEX "entity_type_entity_stable_id_idx" ON "audit_events" USING btree ("entity_type","entity_stable_id");
  CREATE UNIQUE INDEX "module_envelopes_stable_id_idx" ON "module_envelopes" USING btree ("stable_id");
  CREATE INDEX "module_envelopes_revision_idx" ON "module_envelopes" USING btree ("revision");
  CREATE INDEX "module_envelopes_source_version_idx" ON "module_envelopes" USING btree ("source_version");
  CREATE INDEX "module_envelopes_status_idx" ON "module_envelopes" USING btree ("status");
  CREATE INDEX "module_envelopes_audit_audit_created_by_idx" ON "module_envelopes" USING btree ("audit_created_by_id");
  CREATE INDEX "module_envelopes_audit_audit_updated_by_idx" ON "module_envelopes" USING btree ("audit_updated_by_id");
  CREATE INDEX "module_envelopes_audit_audit_correlation_id_idx" ON "module_envelopes" USING btree ("audit_correlation_id");
  CREATE UNIQUE INDEX "module_envelopes_module_id_idx" ON "module_envelopes" USING btree ("module_id");
  CREATE INDEX "module_envelopes_page_id_idx" ON "module_envelopes" USING btree ("page_id");
  CREATE INDEX "module_envelopes_locale_idx" ON "module_envelopes" USING btree ("locale");
  CREATE INDEX "module_envelopes_content_hash_idx" ON "module_envelopes" USING btree ("content_hash");
  CREATE INDEX "module_envelopes_updated_at_idx" ON "module_envelopes" USING btree ("updated_at");
  CREATE INDEX "module_envelopes_created_at_idx" ON "module_envelopes" USING btree ("created_at");
  CREATE UNIQUE INDEX "page_id_locale_module_type_module_version_idx" ON "module_envelopes" USING btree ("page_id","locale","module_type","module_version");
  CREATE INDEX "module_envelopes_rels_order_idx" ON "module_envelopes_rels" USING btree ("order");
  CREATE INDEX "module_envelopes_rels_parent_idx" ON "module_envelopes_rels" USING btree ("parent_id");
  CREATE INDEX "module_envelopes_rels_path_idx" ON "module_envelopes_rels" USING btree ("path");
  CREATE INDEX "module_envelopes_rels_sources_id_idx" ON "module_envelopes_rels" USING btree ("sources_id");
  CREATE UNIQUE INDEX "publication_snapshots_stable_id_idx" ON "publication_snapshots" USING btree ("stable_id");
  CREATE INDEX "publication_snapshots_revision_idx" ON "publication_snapshots" USING btree ("revision");
  CREATE INDEX "publication_snapshots_source_version_idx" ON "publication_snapshots" USING btree ("source_version");
  CREATE INDEX "publication_snapshots_status_idx" ON "publication_snapshots" USING btree ("status");
  CREATE INDEX "publication_snapshots_audit_audit_created_by_idx" ON "publication_snapshots" USING btree ("audit_created_by_id");
  CREATE INDEX "publication_snapshots_audit_audit_updated_by_idx" ON "publication_snapshots" USING btree ("audit_updated_by_id");
  CREATE INDEX "publication_snapshots_audit_audit_correlation_id_idx" ON "publication_snapshots" USING btree ("audit_correlation_id");
  CREATE UNIQUE INDEX "publication_snapshots_publish_version_idx" ON "publication_snapshots" USING btree ("publish_version");
  CREATE INDEX "publication_snapshots_content_tree_hash_idx" ON "publication_snapshots" USING btree ("content_tree_hash");
  CREATE INDEX "publication_snapshots_updated_at_idx" ON "publication_snapshots" USING btree ("updated_at");
  CREATE INDEX "publication_snapshots_created_at_idx" ON "publication_snapshots" USING btree ("created_at");
  CREATE UNIQUE INDEX "publish_version_idx" ON "publication_snapshots" USING btree ("publish_version");
  CREATE UNIQUE INDEX "publication_states_stable_id_idx" ON "publication_states" USING btree ("stable_id");
  CREATE INDEX "publication_states_revision_idx" ON "publication_states" USING btree ("revision");
  CREATE INDEX "publication_states_source_version_idx" ON "publication_states" USING btree ("source_version");
  CREATE INDEX "publication_states_status_idx" ON "publication_states" USING btree ("status");
  CREATE INDEX "publication_states_audit_audit_created_by_idx" ON "publication_states" USING btree ("audit_created_by_id");
  CREATE INDEX "publication_states_audit_audit_updated_by_idx" ON "publication_states" USING btree ("audit_updated_by_id");
  CREATE INDEX "publication_states_audit_audit_correlation_id_idx" ON "publication_states" USING btree ("audit_correlation_id");
  CREATE UNIQUE INDEX "publication_states_publish_version_idx" ON "publication_states" USING btree ("publish_version");
  CREATE INDEX "publication_states_updated_at_idx" ON "publication_states" USING btree ("updated_at");
  CREATE INDEX "publication_states_created_at_idx" ON "publication_states" USING btree ("created_at");
  CREATE UNIQUE INDEX "publish_version_1_idx" ON "publication_states" USING btree ("publish_version");
  CREATE UNIQUE INDEX "active_publication_pointers_stable_id_idx" ON "active_publication_pointers" USING btree ("stable_id");
  CREATE INDEX "active_publication_pointers_revision_idx" ON "active_publication_pointers" USING btree ("revision");
  CREATE UNIQUE INDEX "active_publication_pointers_singleton_key_idx" ON "active_publication_pointers" USING btree ("singleton_key");
  CREATE INDEX "active_publication_pointers_updated_at_idx" ON "active_publication_pointers" USING btree ("updated_at");
  CREATE INDEX "active_publication_pointers_created_at_idx" ON "active_publication_pointers" USING btree ("created_at");
  CREATE UNIQUE INDEX "singleton_key_idx" ON "active_publication_pointers" USING btree ("singleton_key");
  CREATE UNIQUE INDEX "redirects_stable_id_idx" ON "redirects" USING btree ("stable_id");
  CREATE INDEX "redirects_revision_idx" ON "redirects" USING btree ("revision");
  CREATE INDEX "redirects_source_version_idx" ON "redirects" USING btree ("source_version");
  CREATE INDEX "redirects_status_idx" ON "redirects" USING btree ("status");
  CREATE INDEX "redirects_audit_audit_created_by_idx" ON "redirects" USING btree ("audit_created_by_id");
  CREATE INDEX "redirects_audit_audit_updated_by_idx" ON "redirects" USING btree ("audit_updated_by_id");
  CREATE INDEX "redirects_audit_audit_correlation_id_idx" ON "redirects" USING btree ("audit_correlation_id");
  CREATE INDEX "redirects_locale_idx" ON "redirects" USING btree ("locale");
  CREATE INDEX "redirects_old_path_idx" ON "redirects" USING btree ("old_path");
  CREATE INDEX "redirects_updated_at_idx" ON "redirects" USING btree ("updated_at");
  CREATE INDEX "redirects_created_at_idx" ON "redirects" USING btree ("created_at");
  CREATE UNIQUE INDEX "locale_old_path_idx" ON "redirects" USING btree ("locale","old_path");
  CREATE UNIQUE INDEX "workflow_runs_stable_id_idx" ON "workflow_runs" USING btree ("stable_id");
  CREATE INDEX "workflow_runs_revision_idx" ON "workflow_runs" USING btree ("revision");
  CREATE INDEX "workflow_runs_source_version_idx" ON "workflow_runs" USING btree ("source_version");
  CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status");
  CREATE INDEX "workflow_runs_audit_audit_created_by_idx" ON "workflow_runs" USING btree ("audit_created_by_id");
  CREATE INDEX "workflow_runs_audit_audit_updated_by_idx" ON "workflow_runs" USING btree ("audit_updated_by_id");
  CREATE INDEX "workflow_runs_audit_audit_correlation_id_idx" ON "workflow_runs" USING btree ("audit_correlation_id");
  CREATE INDEX "workflow_runs_job_type_idx" ON "workflow_runs" USING btree ("job_type");
  CREATE INDEX "workflow_runs_idempotency_key_idx" ON "workflow_runs" USING btree ("idempotency_key");
  CREATE INDEX "workflow_runs_updated_at_idx" ON "workflow_runs" USING btree ("updated_at");
  CREATE INDEX "workflow_runs_created_at_idx" ON "workflow_runs" USING btree ("created_at");
  CREATE UNIQUE INDEX "job_type_idempotency_key_idx" ON "workflow_runs" USING btree ("job_type","idempotency_key");
  CREATE UNIQUE INDEX "deletion_requests_stable_id_idx" ON "deletion_requests" USING btree ("stable_id");
  CREATE INDEX "deletion_requests_revision_idx" ON "deletion_requests" USING btree ("revision");
  CREATE INDEX "deletion_requests_source_version_idx" ON "deletion_requests" USING btree ("source_version");
  CREATE INDEX "deletion_requests_status_idx" ON "deletion_requests" USING btree ("status");
  CREATE INDEX "deletion_requests_audit_audit_created_by_idx" ON "deletion_requests" USING btree ("audit_created_by_id");
  CREATE INDEX "deletion_requests_audit_audit_updated_by_idx" ON "deletion_requests" USING btree ("audit_updated_by_id");
  CREATE INDEX "deletion_requests_audit_audit_correlation_id_idx" ON "deletion_requests" USING btree ("audit_correlation_id");
  CREATE UNIQUE INDEX "deletion_requests_external_request_key_idx" ON "deletion_requests" USING btree ("external_request_key");
  CREATE INDEX "deletion_requests_requested_by_idx" ON "deletion_requests" USING btree ("requested_by_id");
  CREATE INDEX "deletion_requests_updated_at_idx" ON "deletion_requests" USING btree ("updated_at");
  CREATE INDEX "deletion_requests_created_at_idx" ON "deletion_requests" USING btree ("created_at");
  CREATE UNIQUE INDEX "external_request_key_idx" ON "deletion_requests" USING btree ("external_request_key");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_sources_id_idx" ON "payload_locked_documents_rels" USING btree ("sources_id");
  CREATE INDEX "payload_locked_documents_rels_prompt_artifacts_id_idx" ON "payload_locked_documents_rels" USING btree ("prompt_artifacts_id");
  CREATE INDEX "payload_locked_documents_rels_taxonomy_nodes_id_idx" ON "payload_locked_documents_rels" USING btree ("taxonomy_nodes_id");
  CREATE INDEX "payload_locked_documents_rels_page_records_id_idx" ON "payload_locked_documents_rels" USING btree ("page_records_id");
  CREATE INDEX "payload_locked_documents_rels_locale_variants_id_idx" ON "payload_locked_documents_rels" USING btree ("locale_variants_id");
  CREATE INDEX "payload_locked_documents_rels_edges_id_idx" ON "payload_locked_documents_rels" USING btree ("edges_id");
  CREATE INDEX "payload_locked_documents_rels_audit_events_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_events_id");
  CREATE INDEX "payload_locked_documents_rels_module_envelopes_id_idx" ON "payload_locked_documents_rels" USING btree ("module_envelopes_id");
  CREATE INDEX "payload_locked_documents_rels_publication_snapshots_id_idx" ON "payload_locked_documents_rels" USING btree ("publication_snapshots_id");
  CREATE INDEX "payload_locked_documents_rels_publication_states_id_idx" ON "payload_locked_documents_rels" USING btree ("publication_states_id");
  CREATE INDEX "payload_locked_documents_rels_active_publication_pointer_idx" ON "payload_locked_documents_rels" USING btree ("active_publication_pointers_id");
  CREATE INDEX "payload_locked_documents_rels_redirects_id_idx" ON "payload_locked_documents_rels" USING btree ("redirects_id");
  CREATE INDEX "payload_locked_documents_rels_workflow_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("workflow_runs_id");
  CREATE INDEX "payload_locked_documents_rels_deletion_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("deletion_requests_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");
  -- Compatibility metadata is intentionally additive. It lets recovery tooling
  -- reject an unknown write-plane schema without changing existing records.
  CREATE TABLE "phase1_schema_metadata" (
    "schema_version" integer PRIMARY KEY NOT NULL,
    "compatibility" varchar NOT NULL,
    "migration_name" varchar NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "phase1_fixture_checkpoints" (
    "run_id" varchar PRIMARY KEY NOT NULL,
    "database_identity" varchar NOT NULL,
    "schema_version" integer NOT NULL,
    "query_hash" varchar NOT NULL,
    "input_hash" varchar NOT NULL,
    "cursor" integer NOT NULL,
    "attempt" integer NOT NULL,
    "created_at" timestamp(3) with time zone NOT NULL,
    "updated_at" timestamp(3) with time zone NOT NULL
  );
  INSERT INTO "phase1_schema_metadata" ("schema_version", "compatibility", "migration_name")
    VALUES (1, 'phase1-payload-postgres:additive:restore-required-for-rollback', '20260824_022230_phase1_payload_schema');`)
}

/**
 * This migration has no destructive down path.  A compatible rollback is a
 * restore of an authenticated logical backup taken before the forward change.
 * Payload requires a down export, so attempts fail before issuing SQL.
 */
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("phase1 schema is additive; use verified backup restore instead of migrate:down")
}
