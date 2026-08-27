import { runLocalActivationCheck } from './activate'

export const runLocalPublicationSmokeCheck = runLocalActivationCheck
if (process.argv[1]?.endsWith('smoke.ts')) console.log(JSON.stringify(await runLocalPublicationSmokeCheck()))
