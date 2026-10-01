import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('Notion投影真实smoke保持schema安全路径和既有投影行为', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const smokeEnv = { ...process.env, FORCE_COLOR: '1', TERM: 'xterm' };
  delete smokeEnv.NO_COLOR;
  const output = execFileSync('bash', ['packages/brain/scripts/smoke/notion-probe-projection-smoke.sh'],
    { cwd: root, encoding: 'utf8', timeout: 30000, env: smokeEnv });
  expect(output).toContain('探针：建页/补列/回写/指纹去重');
  expect(output).toContain('判定回执：业务行过滤/批次前缀/判定原因');
  expect(output).toContain('格子行：翻色 → PATCH CellStatus=pending');
  expect(output).toMatch(/Tests\s+14 passed\s+\(14\)/);
  expect(output).toContain('[notion-probe-projection-smoke] PASS');
}, 35000);
