import { setImmediate as nativeSetImmediate } from 'node:timers';
import { buildExistingOpsSources as rawBuilder } from '../../existing-ops-source.js';

export async function buildExistingOpsSources(options) {
  try {
    return await rawBuilder(options);
  } finally {
    await new Promise(resolve => nativeSetImmediate(resolve));
  }
}
