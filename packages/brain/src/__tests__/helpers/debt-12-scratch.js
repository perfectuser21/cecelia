import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
export const assertScratchEnvironment = () => privatePgConfig();
export const verifyScratchPool = pool => verifyPrivatePg(pool);
