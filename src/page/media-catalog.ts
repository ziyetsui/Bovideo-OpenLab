export type ApprovedMediaEvidence = Readonly<{
  url: string
  media_type: 'image' | 'video'
  rights_state: 'first_party' | 'redistribution_licensed'
  status: 'approved'
}>

/** Only media admitted by the same local allow-list may appear in JSON-LD. */
export const APPROVED_MEDIA_CATALOG: Readonly<Record<string, ApprovedMediaEvidence>> = Object.freeze({
  'media-p2l-example-001': Object.freeze({
    url: 'https://preview.local/media/media-p2l-example-001',
    media_type: 'image',
    rights_state: 'first_party',
    status: 'approved',
  }),
})
