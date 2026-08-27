import { describe, expect, it } from 'vitest'

import { escapeAttribute, escapeText } from '../src/escape'

describe('HTML escaping', () => {
  it('encodes script-like text without allowing markup', () => {
    expect(escapeText('<script>alert("x") & more</script>')).toBe(
      '&lt;script&gt;alert("x") &amp; more&lt;/script&gt;',
    )
  })

  it('encodes quotes, ampersands, and attribute-breakout payloads', () => {
    expect(escapeAttribute('" autofocus onfocus="alert(1)" & <tag>')).toBe(
      '&quot; autofocus onfocus=&quot;alert(1)&quot; &amp; &lt;tag&gt;',
    )
    expect(escapeAttribute("'quoted'" )).toBe('&#39;quoted&#39;')
  })
})
