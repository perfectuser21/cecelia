import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
export const assertScratchConfig = (env = process.env) => privatePgConfig(env);
export const assertScratchIdentity = (pool, env = process.env) => verifyPrivatePg(pool, env);
