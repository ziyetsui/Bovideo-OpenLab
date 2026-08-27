import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'

import { preventStableIdMutation, productionFields } from './shared'

export const PublicationSnapshots: CollectionConfig = {
  slug: 'publication-snapshots',
  admin: { useAsTitle: 'publish_version' },
  access: collectionAccess('publication-snapshots'),
  hooks: {
    beforeChange: [preventStableIdMutation],
    afterChange: [auditAfterChange('publication-snapshots')],
    afterDelete: [auditAfterDelete('publication-snapshots')],
  },
  indexes: [{ fields: ['publish_version'], unique: true }],
  fields: [
    ...productionFields(['recorded'], 'recorded'),
    { name: 'publish_version', type: 'number', required: true, unique: true, index: true },
    { name: 'route_manifest_ref', type: 'text', required: true },
    { name: 'sitemap_manifest_ref', type: 'text', required: true },
    { name: 'github_manifest_ref', type: 'text', required: true },
    { name: 'content_tree_hash', type: 'text', required: true, index: true },
    { name: 'previous_verified_version', type: 'number' },
    { name: 'validation_report_ref', type: 'text', required: true },
  ],
}
