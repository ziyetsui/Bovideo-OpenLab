import type { CollectionConfig } from 'payload'

import { auditAfterChange, auditAfterDelete, collectionAccess } from '@/access/payload-access'
import { objectRefSchema } from '@/storage/object-ref'
import { requireTrustedObjectRef } from '@/storage/payload-object-authority'

export const Media: CollectionConfig = {
  slug: 'media',
  access: collectionAccess('media'),
  hooks: {
    beforeChange: [requireTrustedObjectRef('object_ref')],
    afterChange: [auditAfterChange('media')],
    afterDelete: [auditAfterDelete('media')],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'object_ref',
      type: 'json',
      required: true,
      access: { read: () => false },
      validate: (value) => {
        const parsed = objectRefSchema.safeParse(value)
        return parsed.success && parsed.data.namespace === 'public-media' &&
          (parsed.data.rights_state === 'first_party' || parsed.data.rights_state === 'redistribution_licensed') &&
          parsed.data.deletion_state === 'active'
          ? true
          : 'object_ref must be a canonical ObjectRef for eligible public-media'
      },
    },
  ],
  upload: {
    // Keep uploads lossless; derivative media policy belongs to the storage phase.
    crop: false,
    focalPoint: false,
    disableLocalStorage: true,
  },
}
