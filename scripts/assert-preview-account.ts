import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const accountID = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ''
if (!/^[0-9a-f]{32}$/i.test(accountID)) {
  throw new Error('Export a 32-character CLOUDFLARE_ACCOUNT_ID before provisioning Preview resources')
}

const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js')
await execFileAsync(process.execPath, [wrangler, 'whoami', '--account', accountID, '--json'], {
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountID },
  maxBuffer: 8 * 1024 * 1024,
})
process.stdout.write('Cloudflare Preview account selection verified.\n')
