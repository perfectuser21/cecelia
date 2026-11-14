import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const runner = path.join(repoRoot, 'packages/brain/scripts/cecelia-run.sh');
const taskId = '00000000-0000-4000-8000-00000000cafe';

describe('machine launch provenance command contract', () => {
  it('cecelia-run dry-run 输出 machine provenance 三字段并调用 launcher', () => {
    const result = spawnSync(
      'bash',
      [runner, '--dry-run', taskId, 'checkpoint-contract', '/tmp/prompt-contract'],
      { cwd: repoRoot, encoding: 'utf8', env: process.env }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('claude-launch.sh');
    expect(result.stdout).toContain('CECELIA_DISPATCH=1');
    expect(result.stdout).toContain('CECELIA_LAUNCHED_BY=cecelia-run');
    expect(result.stdout).toContain(`HARNESS_TASK_ID=${taskId}`);
  });

});
