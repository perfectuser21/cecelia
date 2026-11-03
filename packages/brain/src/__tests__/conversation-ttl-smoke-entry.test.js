import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
describe('conversation TTL私有smoke入口', () => {
  it('没有Engine和stop.sh时仍执行真实TTL行为回归，不连接Brain或数据库', () => {
    const root = mkdtempSync(join(tmpdir(), 'ttl-smoke-entry-'));
    try {
      for (const path of ['packages/brain/scripts/smoke/conversation-ttl-archiver-smoke.sh',
        'packages/brain/src/conversation-ttl-archiver.js', 'packages/brain/src/__tests__/conversation-ttl-archiver.test.js']) {
        mkdirSync(dirname(join(root, path)), { recursive: true }); copyFileSync(join(repo, path), join(root, path));
      }
      writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
      writeFileSync(join(root, 'packages/brain/vitest.config.js'), 'export default {test:{globals:true,environment:"node"}};\n');
      symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
      const result = spawnSync('bash', ['packages/brain/scripts/smoke/conversation-ttl-archiver-smoke.sh'], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: root, CI: 'true' },
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toMatch(/4 passed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('当前锚点执法只验证Brain行为，不以旧Skill文案代替合同', () => {
    const root = mkdtempSync(join(tmpdir(), 'anchor-smoke-entry-'));
    try {
      for (const path of ['packages/brain/scripts/smoke/anchor-check-smoke.sh', 'packages/brain/src/anchor-check.js',
        'packages/brain/src/lib/task-type-registry.js', 'packages/brain/src/__tests__/anchor-check.test.js']) {
        mkdirSync(dirname(join(root, path)), { recursive: true }); copyFileSync(join(repo, path), join(root, path));
      }
      writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
      writeFileSync(join(root, 'packages/brain/vitest.config.js'), 'export default {test:{globals:true,environment:"node"}};\n');
      symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
      const result = spawnSync('bash', ['packages/brain/scripts/smoke/anchor-check-smoke.sh'], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: root, CI: 'true' },
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toMatch(/13 passed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
