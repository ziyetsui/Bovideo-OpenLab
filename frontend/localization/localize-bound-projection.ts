import { createHash } from 'node:crypto'

import type { ApplicationLocale } from '@/contracts/locale'
import { pageProjectionSchema, type PageProjection, type ProjectedNodeItem, type ProjectedPromptCard } from '@/contracts/projection'

import { messagesFor } from './messages'

const hash = (value: string): string => `sha256:v1:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const stable = (value: string): string => {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16]!, 16) % 4]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

const localizedRoute = (value: string, source: ApplicationLocale, target: ApplicationLocale): string => {
  if (value === `/${source}`) return `/${target}`
  return value.startsWith(`/${source}/`) ? `/${target}${value.slice(source.length + 1)}` : value
}

const localizedTitle = (projection: PageProjection, locale: ApplicationLocale): Readonly<{ title: string; description: string }> => {
  const messages = messagesFor(locale)
  const page = projection.page
  if (page.page_type === 'hub') return { title: messages.hubTitle, description: messages.hubDescription }
  if (page.page_type === 'gallery') return page.media_type === 'image'
    ? { title: messages.imageGalleryTitle, description: messages.imageGalleryDescription }
    : { title: messages.videoGalleryTitle, description: messages.videoGalleryDescription }
  if (page.page_type === 'entity') {
    const sourceSuffix = /\s+Prompts$/i
    const label = page.h1.replace(sourceSuffix, '')
    return { title: `${label} ${messages.promptsSuffix}`, description: page.description }
  }
  return { title: page.title, description: page.description }
}

const rewriteItem = <Item extends ProjectedNodeItem | ProjectedPromptCard>(item: Item, source: ApplicationLocale, target: ApplicationLocale): Item => ({
  ...item,
  href: item.href === null ? null : localizedRoute(item.href, source, target),
  ...('tags' in item ? { tags: item.tags.map((tag) => rewriteItem(tag, source, target)) } : {}),
}) as Item

/** Derives noindex presentation bytes from an already-bound source projection.
 * It never joins draft CMS state and never rewrites the original prompt body. */
export const localizeBoundProjection = (projection: PageProjection, locale: ApplicationLocale): PageProjection => {
  if (projection.locale === locale) return projection
  const sourceLocale = projection.locale
  const messages = messagesFor(locale)
  const copy = localizedTitle(projection, locale)
  const pageBase = {
    ...projection.page,
    locale,
    translation_state: 'source_fallback' as const,
    route: localizedRoute(projection.page.route, sourceLocale, locale),
    title: copy.title,
    h1: copy.title,
    description: copy.description,
    breadcrumbs: projection.page.breadcrumbs.map((crumb) => ({
      ...crumb,
      label: crumb.href.endsWith('/prompts') ? messages.prompts : crumb.label,
      href: localizedRoute(crumb.href, sourceLocale, locale),
    })),
    links: projection.page.links.map((link) => ({ ...link, href: localizedRoute(link.href, sourceLocale, locale) })),
  }
  const page = projection.page.page_type === 'gallery'
    ? {
        ...pageBase,
        page_type: 'gallery' as const,
        next_page: projection.page.next_page === null ? null : localizedRoute(projection.page.next_page, sourceLocale, locale),
        previous_page: projection.page.previous_page === null ? null : localizedRoute(projection.page.previous_page, sourceLocale, locale),
      }
    : projection.page.page_type === 'detail'
      ? { ...pageBase, page_type: 'detail' as const, detail: { ...projection.page.detail, locale } }
      : pageBase
  const slots = projection.slots.map((slot) => ({ ...slot, items: slot.items.map((item) => rewriteItem(item, sourceLocale, locale)) }))
  const navigation = {
    ...projection.navigation,
    version: `${projection.navigation.version}:locale-overlay-v1:${locale}`,
    items: projection.navigation.items.map((item) => ({
      ...rewriteItem(item, sourceLocale, locale),
      label: item.node_ref === 'hub:prompts'
        ? messages.hubTitle
        : item.node_ref === 'output:image'
          ? messages.imageGalleryTitle
          : item.node_ref === 'output:video'
            ? messages.videoGalleryTitle
            : item.label,
    })),
  }
  const localizedPage = { ...page, content_hash: hash(JSON.stringify(page)) }
  const identity = `${projection.projection_id}:${locale}:locale-overlay-v1`
  return pageProjectionSchema.parse({
    ...projection,
    projection_id: stable(identity),
    locale,
    page: localizedPage,
    navigation,
    slots,
    content_hash: hash(JSON.stringify({ page: localizedPage, navigation, slots })),
    link_hash: hash(JSON.stringify({ links: localizedPage.links, navigation, slots: slots.map((slot) => slot.items.map((item) => item.href)) })),
    renderer_version: `${projection.renderer_version}:locale-overlay-v1`,
  })
}
