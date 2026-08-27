// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'
import os from 'node:os'
import path from 'node:path'

// Each Vitest worker needs a D1 state directory of its own. Sharing Wrangler's
// default persisted state lets parallel schema pushes race and corrupt tests.
process.env.PAYLOAD_LOCAL_BINDINGS_PATH ??= path.join(
  os.tmpdir(),
  `bo-pseo-vitest-${process.pid}-${process.env.VITEST_POOL_ID ?? 'default'}`,
)
