import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const originalArgv = process.argv;
process.argv = [...process.argv, '--sprint-dir', '.'];
const { extractBehaviorTests, runCmd } = require('../../scripts/devgate/light-evaluator.cjs');
process.argv = originalArgv;

describe('light evaluator checklist DoD parsing', () => {
  it('executes checklist-style BEHAVIOR entries instead of treating them as skipped', () => {
    const dod = `
- [ ] [BEHAVIOR] [L2] B-08: scratch 多入口真实闭环
  Test: manual:bash -c 'DB_URL="$DB_URL" bash packages/brain/scripts/smoke/router.sh'

- [ ] [BEHAVIOR] B-09: 治理门禁全绿
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh"
`;

    expect(extractBehaviorTests(dod)).toEqual([
      {
        id: 'B-08',
        cmd: 'DB_URL="$DB_URL" bash packages/brain/scripts/smoke/router.sh',
      },
      {
        id: 'B-09',
        cmd: 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh',
      },
    ]);
  });
});

describe('light evaluator command bytes', () => {
  it('不会把合同命令中的反斜杠重复反转义', () => {
    const result = runCmd("printf '%s' '\\\\'", 5_000);
    expect(result.exit_code).toBe(0);
    expect(result.output).toBe('\\\\');
  });
});
