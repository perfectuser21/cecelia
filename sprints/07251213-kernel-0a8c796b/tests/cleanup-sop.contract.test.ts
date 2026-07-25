import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const shellTest = path.join(
  repoRoot,
  'packages/brain/scripts/__tests__/cleanup-conversation-captures.test.sh'
);

describe('conversation capture cleanup SOP contract', () => {
  it('cleanup SOP 真执行先备份后限定删除且备份失败零删除', () => {
    const result = spawnSync('bash', [shellTest], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_NAME: process.env.DB_NAME || 'cecelia_test',
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /before=.*backed_up=.*deleted=.*after=/s
    );
  });
});
