import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default {
  root: repoRoot,
  test: {
    include: [
      'sprints/07300855-kernel-pr4457-devops-blockers/tests/devops-blockers-contract.test.ts',
    ],
    environment: 'node',
  },
};
