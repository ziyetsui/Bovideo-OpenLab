import type { Metadata } from 'next'
import React from 'react'
import '@fontsource-variable/outfit/wght.css'
import './styles.css'

export const metadata: Metadata = {
  description: 'Sanitized Phase 0 engineering preview for the Bovideo multilingual pSEO platform.',
  robots: {
    follow: false,
    googleBot: {
      follow: false,
      index: false,
      noimageindex: true,
    },
    index: false,
    nocache: true,
  },
  title: 'Bovideo OpenLab — Engineering Preview',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
