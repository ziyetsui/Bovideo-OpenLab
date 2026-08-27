import type { ReactNode } from 'react'

import type { PageLink } from './model'

export const BrandMark = () => <span className="brand-mark" data-ui="brand-mark" aria-hidden="true">
  <span className="brand-mark__circle" />
  <span className="brand-mark__square" />
  <span className="brand-mark__triangle" />
</span>

export const SectionHeading = ({ index, title, description, id }: Readonly<{
  index: string
  title: string
  description?: string
  id?: string
}>) => <header className="section-heading">
  <span className="section-heading__index" aria-hidden="true">{index}</span>
  <div>
    <h2 id={id}>{title}</h2>
    {description === undefined ? null : <p>{description}</p>}
  </div>
</header>

export const PosterHero = ({ children, tone = 'yellow' }: Readonly<{
  children: ReactNode
  tone?: 'blue' | 'red' | 'yellow'
}>) => <section className={`poster-hero poster-hero--${tone}`} data-ui="poster-hero">{children}</section>

export const StatBlock = ({ label, value, tone = 'canvas' }: Readonly<{
  label: string
  value: string | number
  tone?: 'blue' | 'canvas' | 'red' | 'yellow'
}>) => <div className={`stat-block stat-block--${tone}`} data-ui="stat-block">
  <strong>{value}</strong>
  <span>{label}</span>
</div>

export const SearchActionField = ({ action, id, label, buttonLabel = 'Search', disabled = false, reason }: Readonly<{
  action: string
  id: string
  label: string
  buttonLabel?: string
  disabled?: boolean
  reason?: string
}>) => <form className="search-field" role="search" action={action} method="get" data-ui="search-field">
  <label htmlFor={id}>{label}</label>
  <div className="search-field__control">
    <input id={id} name="q" type="search" disabled={disabled} aria-describedby={reason === undefined ? undefined : `${id}-reason`} />
    <button type="submit" disabled={disabled}>{buttonLabel}</button>
  </div>
  {reason === undefined ? null : <p id={`${id}-reason`} role="status">{reason}</p>}
</form>

export type AxisItem = Readonly<{ label: string; href?: string; count?: number }>

export const AxisRail = ({ title, items }: Readonly<{ title: string; items: readonly AxisItem[] }>) => <section className="axis-rail" data-ui="axis-rail">
  <h3>{title}</h3>
  <ul>
    {items.map((item) => <li key={`${title}-${item.label}`}>
      {item.href === undefined ? <span>{item.label}</span> : <a href={item.href}>{item.label}</a>}
      {item.count === undefined ? null : <strong>{item.count}</strong>}
    </li>)}
  </ul>
</section>

export const PromptCard = ({ link, ordinal }: Readonly<{ link: PageLink; ordinal: number }>) => <article className="prompt-card" data-ui="prompt-card">
  <div className="prompt-card__art" aria-hidden="true">
    <span>{String(ordinal).padStart(2, '0')}</span>
  </div>
  <div className="prompt-card__body">
    <p className="prompt-card__eyebrow">Approved route</p>
    <h3><a href={link.href}>{link.label}</a></h3>
    <p className="status-chip">Evidence backed</p>
  </div>
</article>

export const EvidenceBadge = ({ label, tone }: Readonly<{
  label: string
  tone: 'available' | 'candidate' | 'explicit' | 'inferred' | 'stale' | 'unavailable'
}>) => <span className={`evidence-badge evidence-badge--${tone}`} data-ui="evidence-badge">{label}</span>

export const UnavailablePanel = ({ title, reason, state = 'unavailable' }: Readonly<{
  title: string
  reason: string
  state?: 'candidate' | 'stale' | 'unavailable'
}>) => <section className={`state-panel state-panel--${state}`} data-ui="state-panel" data-module-state={state}>
  <span className="state-panel__shape" aria-hidden="true" />
  <h3>{title}</h3>
  <p role="status">{reason}</p>
</section>

export const MethodNote = ({ children }: Readonly<{ children: ReactNode }>) => <aside className="method-note" data-ui="method-note">
  <p className="method-note__label">Method / evidence rule</p>
  <div>{children}</div>
</aside>

export const RelatedLinkBand = ({ links }: Readonly<{ links: readonly PageLink[] }>) => <nav className="related-band" aria-label="Related prompt surfaces" data-ui="related-links">
  <p>Continue exploring</p>
  {links.length === 0
    ? <span role="status">No approved related surfaces are available.</span>
    : <ul>{links.map((link) => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}</ul>}
</nav>

export const FinalCta = ({ title, description, action }: Readonly<{
  title: string
  description: string
  action: ReactNode
}>) => <section className="final-cta" data-ui="final-cta">
  <span className="final-cta__disc" aria-hidden="true" />
  <div><h2>{title}</h2><p>{description}</p></div>
  <div className="final-cta__action">{action}</div>
</section>
