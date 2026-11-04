import brain from '../../packages/brain/vitest.config.js';
import manifest from './debt-pg-tests.json' with { type: 'json' };

export const privatePgTests = manifest.tests.map(row => row.path);
export const brainRelativePgPath = path => path.startsWith('packages/brain/') ? path.slice('packages/brain/'.length) : '../../' + path;
export default {
  ...brain,
  test: { ...brain.test,
    include: manifest.tests.filter(row => row.status === 'ready' || process.env.CECELIA_PRIVATE_PG_INCLUDE_PENDING === '1').map(row => brainRelativePgPath(row.path)),
    exclude: ['**/node_modules/**'],
  },
};
