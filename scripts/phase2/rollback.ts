import { runLocalActivationCheck } from './activate'

export const runLocalRollbackCheck = runLocalActivationCheck
if (process.argv[1]?.endsWith('rollback.ts')) console.log(JSON.stringify(await runLocalRollbackCheck()))
