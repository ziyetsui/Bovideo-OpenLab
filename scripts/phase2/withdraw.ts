import { runLocalActivationCheck } from './activate'

export const runLocalWithdrawalCheck = runLocalActivationCheck
if (process.argv[1]?.endsWith('withdraw.ts')) console.log(JSON.stringify(await runLocalWithdrawalCheck()))
