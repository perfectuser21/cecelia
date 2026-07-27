import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const preflightScript = path.join(
  repoRoot,
  'packages/brain/scripts/smoke/pr4372-db-preflight-smoke.sh'
);

describe('evaluator DB preflight contract [BEHAVIOR]', () => {
  it('evaluator DB preflight 脚本默认使用 host.docker.internal 且拒绝 127.0.0.1', () => {
    expect(
      fs.existsSync(preflightScript),
      'RED: pr4372 evaluator DB preflight smoke 脚本尚未实现'
    ).toBe(true);

    const script = fs.readFileSync(preflightScript, 'utf8');
    expect(script).toContain('host.docker.internal');
    expect(script).toMatch(/127\.0\.0\.1/);
    expect(script).toMatch(/DB_URL/);
  });

  it('evaluator DB preflight 校验 current_database inet_server_addr 与 _test preview 白名单', () => {
    expect(
      fs.existsSync(preflightScript),
      'RED: 缺少 DB preflight 真回执脚本，无法校验 current_database()/inet_server_addr()'
    ).toBe(true);

    const script = fs.readFileSync(preflightScript, 'utf8');
    expect(script).toContain('current_database()');
    expect(script).toContain('inet_server_addr()');
    expect(script).toMatch(/_test/);
    expect(script).toMatch(/preview_/);
  });
});
