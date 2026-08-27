import Link from 'next/link'
import React from 'react'

import './styles.css'

export default function HomePage() {
  return (
    <main className="home">
      <div className="content">
        <p className="eyebrow">Phase 0 · Private engineering preview</p>
        <h1>Bovideo OpenLab</h1>
        <p className="lede">
          A sanitized, multilingual Payload CMS and Cloudflare reference implementation. This
          environment is intentionally noindex and is not a production release.
        </p>
        <div className="links">
          <Link className="admin" href="/admin">
            Open Payload Admin
          </Link>
          <a
            className="docs"
            href="https://github.com/ziyetsui/Bovideo-OpenLab"
            rel="noopener noreferrer"
            target="_blank"
          >
            View source
          </a>
        </div>
      </div>
      <div className="footer">
        <p>Only synthetic fixtures are permitted in this Preview.</p>
      </div>
    </main>
  )
}
