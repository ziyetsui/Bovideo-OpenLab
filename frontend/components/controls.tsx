'use client'

import { useState } from 'react'

export const CopyPromptButton = ({ text }: Readonly<{ text: string }>) => {
  const [status, setStatus] = useState('Copy prompt')

  const copy = async () => {
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('Prompt copied')
    } catch {
      setStatus('Copy failed — select the prompt manually')
    }
  }

  return <span className="copy-prompt-control">
    <button type="button" data-action="copy-prompt" onClick={copy}>Copy prompt</button>
    <span aria-live="polite" role="status">{status}</span>
  </span>
}

export const FacetControl = ({ label, initialPressed = false, pressed, onPressedChange }: Readonly<{
  label: string
  initialPressed?: boolean
  pressed?: boolean
  onPressedChange?: (pressed: boolean) => void
}>) => {
  const [localPressed, setLocalPressed] = useState(initialPressed)
  const currentPressed = pressed ?? localPressed
  const toggle = () => {
    const nextPressed = !currentPressed
    if (pressed === undefined) setLocalPressed(nextPressed)
    onPressedChange?.(nextPressed)
  }

  return <button type="button" data-link-policy="filter_state" data-noindex="true" aria-pressed={currentPressed} onClick={toggle}>
    {label}
  </button>
}
