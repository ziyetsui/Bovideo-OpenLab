import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload: _payload, req: _req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`sources\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stable_id\` text NOT NULL,
  	\`schema_version\` numeric DEFAULT 1 NOT NULL,
  	\`source_version\` text NOT NULL,
  	\`status\` text DEFAULT 'active' NOT NULL,
  	\`audit_created_by_id\` integer,
  	\`audit_updated_by_id\` integer,
  	\`audit_correlation_id\` text,
  	\`provider\` text NOT NULL,
  	\`provider_record_id\` text NOT NULL,
  	\`canonical_url\` text NOT NULL,
  	\`raw_ref\` text NOT NULL,
  	\`captured_at\` text NOT NULL,
  	\`content_hash\` text NOT NULL,
  	\`author_ref_id\` integer,
  	\`rights_state\` text NOT NULL,
  	\`rights_basis\` text,
  	\`deletion_state\` text DEFAULT 'active' NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`audit_created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`audit_updated_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`author_ref_id\`) REFERENCES \`taxonomy_nodes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`sources_stable_id_idx\` ON \`sources\` (\`stable_id\`);`)
  await db.run(sql`CREATE INDEX \`sources_source_version_idx\` ON \`sources\` (\`source_version\`);`)
  await db.run(sql`CREATE INDEX \`sources_status_idx\` ON \`sources\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`sources_audit_audit_created_by_idx\` ON \`sources\` (\`audit_created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`sources_audit_audit_updated_by_idx\` ON \`sources\` (\`audit_updated_by_id\`);`)
  await db.run(sql`CREATE INDEX \`sources_audit_audit_correlation_id_idx\` ON \`sources\` (\`audit_correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`sources_provider_idx\` ON \`sources\` (\`provider\`);`)
  await db.run(sql`CREATE INDEX \`sources_provider_record_id_idx\` ON \`sources\` (\`provider_record_id\`);`)
  await db.run(sql`CREATE INDEX \`sources_captured_at_idx\` ON \`sources\` (\`captured_at\`);`)
  await db.run(sql`CREATE INDEX \`sources_content_hash_idx\` ON \`sources\` (\`content_hash\`);`)
  await db.run(sql`CREATE INDEX \`sources_author_ref_idx\` ON \`sources\` (\`author_ref_id\`);`)
  await db.run(sql`CREATE INDEX \`sources_rights_state_idx\` ON \`sources\` (\`rights_state\`);`)
  await db.run(sql`CREATE INDEX \`sources_deletion_state_idx\` ON \`sources\` (\`deletion_state\`);`)
  await db.run(sql`CREATE INDEX \`sources_updated_at_idx\` ON \`sources\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`sources_created_at_idx\` ON \`sources\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`provider_provider_record_id_content_hash_idx\` ON \`sources\` (\`provider\`,\`provider_record_id\`,\`content_hash\`);`)
  await db.run(sql`CREATE INDEX \`rights_state_deletion_state_idx\` ON \`sources\` (\`rights_state\`,\`deletion_state\`);`)
  await db.run(sql`CREATE TABLE \`prompt_artifacts_prompt_variables\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`token\` text NOT NULL,
  	\`description\` text,
  	\`allowed_values\` text,
  	\`occurrences\` numeric,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`prompt_artifacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_prompt_variables_order_idx\` ON \`prompt_artifacts_prompt_variables\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_prompt_variables_parent_id_idx\` ON \`prompt_artifacts_prompt_variables\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`prompt_artifacts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stable_id\` text NOT NULL,
  	\`schema_version\` numeric DEFAULT 1 NOT NULL,
  	\`source_version\` text NOT NULL,
  	\`status\` text DEFAULT 'draft' NOT NULL,
  	\`audit_created_by_id\` integer,
  	\`audit_updated_by_id\` integer,
  	\`audit_correlation_id\` text,
  	\`kind\` text NOT NULL,
  	\`canonical_label\` text NOT NULL,
  	\`prompt_original_text\` text NOT NULL,
  	\`outcome_media_type\` text,
  	\`outcome_summary\` text,
  	\`outcome_capability\` text,
  	\`inputs_required\` text,
  	\`inputs_optional\` text,
  	\`parameters\` text,
  	\`examples\` text,
  	\`workflow_steps\` text,
  	\`signals\` text,
  	\`source_id\` integer NOT NULL,
  	\`rights_state\` text NOT NULL,
  	\`safety_state\` text NOT NULL,
  	\`evidence_state\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`audit_created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`audit_updated_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`source_id\`) REFERENCES \`sources\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`prompt_artifacts_stable_id_idx\` ON \`prompt_artifacts\` (\`stable_id\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_source_version_idx\` ON \`prompt_artifacts\` (\`source_version\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_status_idx\` ON \`prompt_artifacts\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_audit_audit_created_by_idx\` ON \`prompt_artifacts\` (\`audit_created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_audit_audit_updated_by_idx\` ON \`prompt_artifacts\` (\`audit_updated_by_id\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_audit_audit_correlation_id_idx\` ON \`prompt_artifacts\` (\`audit_correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_canonical_label_idx\` ON \`prompt_artifacts\` (\`canonical_label\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_source_idx\` ON \`prompt_artifacts\` (\`source_id\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_rights_state_idx\` ON \`prompt_artifacts\` (\`rights_state\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_updated_at_idx\` ON \`prompt_artifacts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_created_at_idx\` ON \`prompt_artifacts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`prompt_artifacts_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`taxonomy_nodes_id\` integer,
  	\`prompt_artifacts_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`prompt_artifacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`taxonomy_nodes_id\`) REFERENCES \`taxonomy_nodes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`prompt_artifacts_id\`) REFERENCES \`prompt_artifacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_rels_order_idx\` ON \`prompt_artifacts_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_rels_parent_idx\` ON \`prompt_artifacts_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_rels_path_idx\` ON \`prompt_artifacts_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_rels_taxonomy_nodes_id_idx\` ON \`prompt_artifacts_rels\` (\`taxonomy_nodes_id\`);`)
  await db.run(sql`CREATE INDEX \`prompt_artifacts_rels_prompt_artifacts_id_idx\` ON \`prompt_artifacts_rels\` (\`prompt_artifacts_id\`);`)
  await db.run(sql`CREATE TABLE \`taxonomy_nodes\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stable_id\` text NOT NULL,
  	\`schema_version\` numeric DEFAULT 1 NOT NULL,
  	\`source_version\` text NOT NULL,
  	\`status\` text DEFAULT 'active' NOT NULL,
  	\`audit_created_by_id\` integer,
  	\`audit_updated_by_id\` integer,
  	\`audit_correlation_id\` text,
  	\`node_type\` text NOT NULL,
  	\`stable_key\` text NOT NULL,
  	\`label\` text NOT NULL,
  	\`description\` text,
  	\`promotion_state\` text DEFAULT 'candidate' NOT NULL,
  	\`inventory_count\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`audit_created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`audit_updated_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`taxonomy_nodes_stable_id_idx\` ON \`taxonomy_nodes\` (\`stable_id\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_source_version_idx\` ON \`taxonomy_nodes\` (\`source_version\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_status_idx\` ON \`taxonomy_nodes\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_audit_audit_created_by_idx\` ON \`taxonomy_nodes\` (\`audit_created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_audit_audit_updated_by_idx\` ON \`taxonomy_nodes\` (\`audit_updated_by_id\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_audit_audit_correlation_id_idx\` ON \`taxonomy_nodes\` (\`audit_correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_node_type_idx\` ON \`taxonomy_nodes\` (\`node_type\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`taxonomy_nodes_stable_key_idx\` ON \`taxonomy_nodes\` (\`stable_key\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_promotion_state_idx\` ON \`taxonomy_nodes\` (\`promotion_state\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_updated_at_idx\` ON \`taxonomy_nodes\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_created_at_idx\` ON \`taxonomy_nodes\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`node_type_promotion_state_idx\` ON \`taxonomy_nodes\` (\`node_type\`,\`promotion_state\`);`)
  await db.run(sql`CREATE TABLE \`taxonomy_nodes_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`sources_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`taxonomy_nodes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`sources_id\`) REFERENCES \`sources\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_rels_order_idx\` ON \`taxonomy_nodes_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_rels_parent_idx\` ON \`taxonomy_nodes_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_rels_path_idx\` ON \`taxonomy_nodes_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`taxonomy_nodes_rels_sources_id_idx\` ON \`taxonomy_nodes_rels\` (\`sources_id\`);`)
  await db.run(sql`CREATE TABLE \`page_records_primary_keyword_by_locale\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`locale\` text NOT NULL,
  	\`keyword\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`page_records\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`page_records_primary_keyword_by_locale_order_idx\` ON \`page_records_primary_keyword_by_locale\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`page_records_primary_keyword_by_locale_parent_id_idx\` ON \`page_records_primary_keyword_by_locale\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`page_records\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stable_id\` text NOT NULL,
  	\`schema_version\` numeric DEFAULT 1 NOT NULL,
  	\`source_version\` text NOT NULL,
  	\`status\` text DEFAULT 'active' NOT NULL,
  	\`audit_created_by_id\` integer,
  	\`audit_updated_by_id\` integer,
  	\`audit_correlation_id\` text,
  	\`page_type\` text NOT NULL,
  	\`intent\` text NOT NULL,
  	\`inventory\` text NOT NULL,
  	\`demand_evidence\` text,
  	\`information_gain\` text,
  	\`qualification_score\` text NOT NULL,
  	\`index_state\` text DEFAULT 'not_generated' NOT NULL,
  	\`reason_codes\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`audit_created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`audit_updated_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`page_records_stable_id_idx\` ON \`page_records\` (\`stable_id\`);`)
  await db.run(sql`CREATE INDEX \`page_records_source_version_idx\` ON \`page_records\` (\`source_version\`);`)
  await db.run(sql`CREATE INDEX \`page_records_status_idx\` ON \`page_records\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`page_records_audit_audit_created_by_idx\` ON \`page_records\` (\`audit_created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`page_records_audit_audit_updated_by_idx\` ON \`page_records\` (\`audit_updated_by_id\`);`)
  await db.run(sql`CREATE INDEX \`page_records_audit_audit_correlation_id_idx\` ON \`page_records\` (\`audit_correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`page_records_page_type_idx\` ON \`page_records\` (\`page_type\`);`)
  await db.run(sql`CREATE INDEX \`page_records_index_state_idx\` ON \`page_records\` (\`index_state\`);`)
  await db.run(sql`CREATE INDEX \`page_records_updated_at_idx\` ON \`page_records\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`page_records_created_at_idx\` ON \`page_records\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`page_type_index_state_idx\` ON \`page_records\` (\`page_type\`,\`index_state\`);`)
  await db.run(sql`CREATE TABLE \`page_records_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`prompt_artifacts_id\` integer,
  	\`taxonomy_nodes_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`page_records\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`prompt_artifacts_id\`) REFERENCES \`prompt_artifacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`taxonomy_nodes_id\`) REFERENCES \`taxonomy_nodes\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`page_records_rels_order_idx\` ON \`page_records_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`page_records_rels_parent_idx\` ON \`page_records_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`page_records_rels_path_idx\` ON \`page_records_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`page_records_rels_prompt_artifacts_id_idx\` ON \`page_records_rels\` (\`prompt_artifacts_id\`);`)
  await db.run(sql`CREATE INDEX \`page_records_rels_taxonomy_nodes_id_idx\` ON \`page_records_rels\` (\`taxonomy_nodes_id\`);`)
  await db.run(sql`CREATE TABLE \`locale_variants\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stable_id\` text NOT NULL,
  	\`schema_version\` numeric DEFAULT 1 NOT NULL,
  	\`source_version\` text NOT NULL,
  	\`status\` text DEFAULT 'active' NOT NULL,
  	\`audit_created_by_id\` integer,
  	\`audit_updated_by_id\` integer,
  	\`audit_correlation_id\` text,
  	\`locale\` text NOT NULL,
  	\`source_locale\` text NOT NULL,
  	\`translation_model\` text NOT NULL,
  	\`translation_prompt_version\` text NOT NULL,
  	\`localized_fields\` text NOT NULL,
  	\`quality_terminology_score\` numeric,
  	\`quality_placeholder_integrity\` text,
  	\`quality_factual_consistency\` text,
  	\`quality_language_detection\` text,
  	\`quality_human_score\` numeric,
  	\`workflow_state\` text DEFAULT 'missing' NOT NULL,
  	\`reviewed_by_id\` integer,
  	\`reviewed_at\` text,
  	\`published_version\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`audit_created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`audit_updated_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`reviewed_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`locale_variants_stable_id_idx\` ON \`locale_variants\` (\`stable_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_source_version_idx\` ON \`locale_variants\` (\`source_version\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_status_idx\` ON \`locale_variants\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_audit_audit_created_by_idx\` ON \`locale_variants\` (\`audit_created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_audit_audit_updated_by_idx\` ON \`locale_variants\` (\`audit_updated_by_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_audit_audit_correlation_id_idx\` ON \`locale_variants\` (\`audit_correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_locale_idx\` ON \`locale_variants\` (\`locale\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_workflow_state_idx\` ON \`locale_variants\` (\`workflow_state\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_reviewed_by_idx\` ON \`locale_variants\` (\`reviewed_by_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_updated_at_idx\` ON \`locale_variants\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_created_at_idx\` ON \`locale_variants\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`locale_workflow_state_idx\` ON \`locale_variants\` (\`locale\`,\`workflow_state\`);`)
  await db.run(sql`CREATE TABLE \`locale_variants_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`prompt_artifacts_id\` integer,
  	\`taxonomy_nodes_id\` integer,
  	\`page_records_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`locale_variants\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`prompt_artifacts_id\`) REFERENCES \`prompt_artifacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`taxonomy_nodes_id\`) REFERENCES \`taxonomy_nodes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`page_records_id\`) REFERENCES \`page_records\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`locale_variants_rels_order_idx\` ON \`locale_variants_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_rels_parent_idx\` ON \`locale_variants_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_rels_path_idx\` ON \`locale_variants_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_rels_prompt_artifacts_id_idx\` ON \`locale_variants_rels\` (\`prompt_artifacts_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_rels_taxonomy_nodes_id_idx\` ON \`locale_variants_rels\` (\`taxonomy_nodes_id\`);`)
  await db.run(sql`CREATE INDEX \`locale_variants_rels_page_records_id_idx\` ON \`locale_variants_rels\` (\`page_records_id\`);`)
  await db.run(sql`CREATE TABLE \`edges\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stable_id\` text NOT NULL,
  	\`schema_version\` numeric DEFAULT 1 NOT NULL,
  	\`source_version\` text NOT NULL,
  	\`status\` text DEFAULT 'active' NOT NULL,
  	\`audit_created_by_id\` integer,
  	\`audit_updated_by_id\` integer,
  	\`audit_correlation_id\` text,
  	\`relation\` text NOT NULL,
  	\`confidence\` numeric NOT NULL,
  	\`review_state\` text DEFAULT 'candidate' NOT NULL,
  	\`valid_from\` text,
  	\`valid_to\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`audit_created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`audit_updated_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`edges_stable_id_idx\` ON \`edges\` (\`stable_id\`);`)
  await db.run(sql`CREATE INDEX \`edges_source_version_idx\` ON \`edges\` (\`source_version\`);`)
  await db.run(sql`CREATE INDEX \`edges_status_idx\` ON \`edges\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`edges_audit_audit_created_by_idx\` ON \`edges\` (\`audit_created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`edges_audit_audit_updated_by_idx\` ON \`edges\` (\`audit_updated_by_id\`);`)
  await db.run(sql`CREATE INDEX \`edges_audit_audit_correlation_id_idx\` ON \`edges\` (\`audit_correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`edges_relation_idx\` ON \`edges\` (\`relation\`);`)
  await db.run(sql`CREATE INDEX \`edges_review_state_idx\` ON \`edges\` (\`review_state\`);`)
  await db.run(sql`CREATE INDEX \`edges_updated_at_idx\` ON \`edges\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`edges_created_at_idx\` ON \`edges\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`relation_review_state_idx\` ON \`edges\` (\`relation\`,\`review_state\`);`)
  await db.run(sql`CREATE TABLE \`edges_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`sources_id\` integer,
  	\`prompt_artifacts_id\` integer,
  	\`taxonomy_nodes_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`edges\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`sources_id\`) REFERENCES \`sources\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`prompt_artifacts_id\`) REFERENCES \`prompt_artifacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`taxonomy_nodes_id\`) REFERENCES \`taxonomy_nodes\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`edges_rels_order_idx\` ON \`edges_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`edges_rels_parent_idx\` ON \`edges_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`edges_rels_path_idx\` ON \`edges_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`edges_rels_sources_id_idx\` ON \`edges_rels\` (\`sources_id\`);`)
  await db.run(sql`CREATE INDEX \`edges_rels_prompt_artifacts_id_idx\` ON \`edges_rels\` (\`prompt_artifacts_id\`);`)
  await db.run(sql`CREATE INDEX \`edges_rels_taxonomy_nodes_id_idx\` ON \`edges_rels\` (\`taxonomy_nodes_id\`);`)
  await db.run(sql`CREATE TABLE \`audit_events\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stable_id\` text NOT NULL,
  	\`schema_version\` numeric DEFAULT 1 NOT NULL,
  	\`source_version\` text NOT NULL,
  	\`status\` text DEFAULT 'recorded' NOT NULL,
  	\`audit_created_by_id\` integer,
  	\`audit_updated_by_id\` integer,
  	\`audit_correlation_id\` text,
  	\`actor_id\` integer,
  	\`actor_service\` text,
  	\`correlation_id\` text NOT NULL,
  	\`event_type\` text NOT NULL,
  	\`prior_state\` text,
  	\`new_state\` text,
  	\`reason_code\` text,
  	\`occurred_at\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`audit_created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`audit_updated_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`actor_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`audit_events_stable_id_idx\` ON \`audit_events\` (\`stable_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_source_version_idx\` ON \`audit_events\` (\`source_version\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_status_idx\` ON \`audit_events\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_audit_audit_created_by_idx\` ON \`audit_events\` (\`audit_created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_audit_audit_updated_by_idx\` ON \`audit_events\` (\`audit_updated_by_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_audit_audit_correlation_id_idx\` ON \`audit_events\` (\`audit_correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_actor_idx\` ON \`audit_events\` (\`actor_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_correlation_id_idx\` ON \`audit_events\` (\`correlation_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_event_type_idx\` ON \`audit_events\` (\`event_type\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_occurred_at_idx\` ON \`audit_events\` (\`occurred_at\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_updated_at_idx\` ON \`audit_events\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_created_at_idx\` ON \`audit_events\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`correlation_id_occurred_at_idx\` ON \`audit_events\` (\`correlation_id\`,\`occurred_at\`);`)
  await db.run(sql`CREATE TABLE \`audit_events_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`sources_id\` integer,
  	\`prompt_artifacts_id\` integer,
  	\`taxonomy_nodes_id\` integer,
  	\`page_records_id\` integer,
  	\`locale_variants_id\` integer,
  	\`edges_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`audit_events\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`sources_id\`) REFERENCES \`sources\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`prompt_artifacts_id\`) REFERENCES \`prompt_artifacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`taxonomy_nodes_id\`) REFERENCES \`taxonomy_nodes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`page_records_id\`) REFERENCES \`page_records\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`locale_variants_id\`) REFERENCES \`locale_variants\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`edges_id\`) REFERENCES \`edges\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`audit_events_rels_order_idx\` ON \`audit_events_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_parent_idx\` ON \`audit_events_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_path_idx\` ON \`audit_events_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_sources_id_idx\` ON \`audit_events_rels\` (\`sources_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_prompt_artifacts_id_idx\` ON \`audit_events_rels\` (\`prompt_artifacts_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_taxonomy_nodes_id_idx\` ON \`audit_events_rels\` (\`taxonomy_nodes_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_page_records_id_idx\` ON \`audit_events_rels\` (\`page_records_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_locale_variants_id_idx\` ON \`audit_events_rels\` (\`locale_variants_id\`);`)
  await db.run(sql`CREATE INDEX \`audit_events_rels_edges_id_idx\` ON \`audit_events_rels\` (\`edges_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`sources_id\` integer REFERENCES sources(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`prompt_artifacts_id\` integer REFERENCES prompt_artifacts(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`taxonomy_nodes_id\` integer REFERENCES taxonomy_nodes(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`page_records_id\` integer REFERENCES page_records(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`locale_variants_id\` integer REFERENCES locale_variants(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`edges_id\` integer REFERENCES edges(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`audit_events_id\` integer REFERENCES audit_events(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_sources_id_idx\` ON \`payload_locked_documents_rels\` (\`sources_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_prompt_artifacts_id_idx\` ON \`payload_locked_documents_rels\` (\`prompt_artifacts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_taxonomy_nodes_id_idx\` ON \`payload_locked_documents_rels\` (\`taxonomy_nodes_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_page_records_id_idx\` ON \`payload_locked_documents_rels\` (\`page_records_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_locale_variants_id_idx\` ON \`payload_locked_documents_rels\` (\`locale_variants_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_edges_id_idx\` ON \`payload_locked_documents_rels\` (\`edges_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_audit_events_id_idx\` ON \`payload_locked_documents_rels\` (\`audit_events_id\`);`)
}

export async function down({ db, payload: _payload, req: _req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "users_id", "media_id") SELECT "id", "order", "parent_id", "path", "users_id", "media_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`DROP TABLE \`audit_events_rels\`;`)
  await db.run(sql`DROP TABLE \`edges_rels\`;`)
  await db.run(sql`DROP TABLE \`locale_variants_rels\`;`)
  await db.run(sql`DROP TABLE \`page_records_rels\`;`)
  await db.run(sql`DROP TABLE \`page_records_primary_keyword_by_locale\`;`)
  await db.run(sql`DROP TABLE \`taxonomy_nodes_rels\`;`)
  await db.run(sql`DROP TABLE \`prompt_artifacts_rels\`;`)
  await db.run(sql`DROP TABLE \`prompt_artifacts_prompt_variables\`;`)
  await db.run(sql`DROP TABLE \`audit_events\`;`)
  await db.run(sql`DROP TABLE \`edges\`;`)
  await db.run(sql`DROP TABLE \`locale_variants\`;`)
  await db.run(sql`DROP TABLE \`page_records\`;`)
  await db.run(sql`DROP TABLE \`taxonomy_nodes\`;`)
  await db.run(sql`DROP TABLE \`prompt_artifacts\`;`)
  await db.run(sql`DROP TABLE \`sources\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
}
