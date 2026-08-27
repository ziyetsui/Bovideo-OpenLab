'use client'

import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'

const MonacoClientProvider = dynamic(() => import('./MonacoClientProvider'), { ssr: false })

export default function LocalMonacoProvider({ children }: { children?: ReactNode }) {
  return <MonacoClientProvider>{children}</MonacoClientProvider>
}
