export const testUser = {
  email: 'dev@payloadcms.com',
  password: 'test',
}

async function postJSON(baseURL: string, path: string): Promise<Response> {
  return fetch(`${baseURL}${path}`, {
    body: JSON.stringify(testUser),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

/**
 * Ensures the local test user through the running Payload HTTP server. This
 * avoids opening the same local D1 database from a second Miniflare process.
 */
export async function seedTestUser(baseURL = 'http://localhost:3000'): Promise<void> {
  const login = await postJSON(baseURL, '/api/users/login')
  if (login.ok) return

  const register = await postJSON(baseURL, '/api/users/first-register')
  if (register.ok) return

  throw new Error(
    `Unable to ensure local E2E user: login=${login.status}, first-register=${register.status}`,
  )
}
