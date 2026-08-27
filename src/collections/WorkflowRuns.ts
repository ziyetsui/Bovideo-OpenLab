import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import {
  DEFAULT_WORKFLOW_RUN_STATUS,
  WORKFLOW_RUN_JOB_TYPES,
  WORKFLOW_RUN_STATUSES,
} from '@/contracts/workflow-run'

import {
  canonicalPayloadAfterChange,
  canonicalPayloadBeforeChange,
  canonicalPayloadBeforeValidate,
  auditCanonicalPayloadStateChange,
  serverManagedProductionFields,
} from './canonical-payload-contract'

export const WorkflowRuns: CollectionConfig = {
  slug: 'workflow-runs',
  admin: { useAsTitle: 'idempotency_key' },
  access: collectionAccess('workflow-runs'),
  hooks: {
    beforeValidate: [canonicalPayloadBeforeValidate('workflowRun')],
    beforeChange: [canonicalPayloadBeforeChange('workflowRun')],
    afterChange: [async (args) => {
      await canonicalPayloadAfterChange('workflowRun')(args)
      if (await auditCanonicalPayloadStateChange('workflowRun', 'workflow-runs', args)) return args.doc
      return auditAfterChange('workflow-runs')(args)
    }],
    afterDelete: [auditAfterDelete('workflow-runs')],
  },
  indexes: [
    { fields: ['job_type', 'idempotency_key'], unique: true },
    { fields: ['status', 'createdAt'] },
    { fields: ['status', 'lease_expires_at'] },
  ],
  fields: [
    ...serverManagedProductionFields(WORKFLOW_RUN_STATUSES, DEFAULT_WORKFLOW_RUN_STATUS),
    { name: 'job_type', type: 'select', required: true, index: true, options: WORKFLOW_RUN_JOB_TYPES.map((value) => ({ label: value, value })) },
    { name: 'idempotency_key', type: 'text', required: true, index: true },
    { name: 'attempt', type: 'number', required: true, min: 0, defaultValue: 0 },
    { name: 'input_ref', type: 'text', required: true },
    { name: 'output_ref', type: 'text' },
    { name: 'error_class', type: 'text' },
    { name: 'lease_owner', type: 'text', index: true },
    { name: 'lease_expires_at', type: 'date', index: true },
  ],
}
