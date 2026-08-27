'use client'

import * as monaco from 'monaco-editor'
import type { ReactNode } from 'react'

declare global {
  interface Window {
    monaco?: typeof monaco
    MonacoEnvironment?: {
      getWorker: (moduleId: string, label: string) => Worker
    }
  }
}

export default function MonacoClientProvider({ children }: { children?: ReactNode }) {
  window.MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === 'json') {
        return new Worker(new URL('monaco-editor/language/json/json.worker.js', import.meta.url), {
          type: 'module',
        })
      }
      return new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), {
        type: 'module',
      })
    },
  }
  window.monaco = monaco

  return children
}
