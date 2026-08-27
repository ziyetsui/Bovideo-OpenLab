'use client'

import { useState } from 'react'

export const CopyPromptButton = ({ text }: Readonly<{ text: string }>) => {
  const [status, setStatus] = useState('Copy original prompt')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied original prompt')
    } catch {
      setStatus('Copy failed — select the prompt manually')
    }
  }

  return <button type="button" data-action="copy-prompt" onClick={copy}>{status}</button>
}
