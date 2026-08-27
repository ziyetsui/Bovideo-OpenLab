import { describe, expect, it, vi } from 'vitest'

import { ensurePreviewAdmin } from '../../scripts/bootstrap-preview-admin'

const credentials = {
  baseURL: 'https://bovideo-openlab-preview.example.workers.dev',
  email: 'preview-admin@example.invalid',
  password: 'sensitive-test-value',
}

describe('ensurePreviewAdmin', () => {
  it('keeps an existing administrator without reopening first registration', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    await expect(ensurePreviewAdmin({ ...credentials, fetchImpl })).resolves.toBe('existing')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toContain('/api/users/login')
  })

  it('uses first-register only after login fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    await expect(ensurePreviewAdmin({ ...credentials, fetchImpl })).resolves.toBe('created')
    expect(fetchImpl.mock.calls[1][0]).toContain('/api/users/first-register')
  })

  it('does not expose credentials in failure messages', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    await expect(ensurePreviewAdmin({ ...credentials, fetchImpl })).rejects.not.toThrow(
      /preview-admin@example|sensitive-test-value/,
    )
  })
})
