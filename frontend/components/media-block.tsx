import type { MediaEvidence } from '@/contracts/projection'
import { APPROVED_MEDIA_CATALOG } from '@/page/media-catalog'
import type { ComponentPropsWithoutRef } from 'react'

type PreviewMedia = Pick<MediaEvidence,
  'remote_url' | 'thumbnail_url' | 'media_type' | 'width' | 'height' | 'visibility' |
  'delivery_target' | 'preview_noindex' | 'rights_state' | 'attribution_url'
>

export type ApprovedMediaReference = Readonly<{
  approved_media_id: keyof typeof APPROVED_MEDIA_CATALOG
}>

export type RenderableMedia = PreviewMedia | ApprovedMediaReference

const resolveApprovedMedia = (media: RenderableMedia) => 'approved_media_id' in media &&
  Object.prototype.hasOwnProperty.call(APPROVED_MEDIA_CATALOG, media.approved_media_id)
  ? APPROVED_MEDIA_CATALOG[media.approved_media_id]
  : undefined

const isPreviewMedia = (media: RenderableMedia): media is PreviewMedia => 'remote_url' in media

const UnavailableMedia = () => <div className="media-block media-block--unavailable" data-media-state="unavailable" role="status">
  Media unavailable
</div>

export const MediaBlock = ({ media, mode }: Readonly<{ media: RenderableMedia | null; mode: 'preview' | 'public' }>) => {
  if (media === null) return <UnavailableMedia />

  const approvedMedia = resolveApprovedMedia(media)
  if (mode === 'public') {
    if (approvedMedia === undefined) return <UnavailableMedia />
    return <figure className="media-block" data-media-mode="public">
      {approvedMedia.media_type === 'image'
        // This allowlisted catalog URL intentionally bypasses Next's optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={approvedMedia.url} alt="Evidence media" loading="lazy" />
        : <video controls preload="none" src={approvedMedia.url} />}
    </figure>
  }

  if (!isPreviewMedia(media)) return <UnavailableMedia />

  const source = media.remote_url
  const mediaType = media.media_type
  const dimensions = { width: media.width ?? undefined, height: media.height ?? undefined }
  const previewNoindex = media.preview_noindex
  // React's video attributes omit referrerPolicy, but browsers honour it on the
  // media element. Keep it on every preview fetch just as for preview images.
  const videoProperties = {
    controls: true,
    preload: 'none',
    src: source,
    ...(media.thumbnail_url === null ? {} : { poster: media.thumbnail_url }),
    ...dimensions,
    ...(previewNoindex ? { referrerPolicy: 'no-referrer' } : {}),
  } as unknown as ComponentPropsWithoutRef<'video'>

  return <figure className="media-block" data-media-mode={mode} data-preview-noindex={previewNoindex ? 'true' : undefined}>
    {mediaType === 'image'
      // Preview URLs are immutable renderer evidence and must not be proxied/cached by Next.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={source} alt="Evidence media" loading="lazy" referrerPolicy={previewNoindex ? 'no-referrer' : undefined} {...dimensions} />
      : <video {...videoProperties} />}
    {media.attribution_url !== null ? <figcaption><a href={media.attribution_url} rel="noreferrer">Source attribution</a></figcaption> : null}
  </figure>
}
