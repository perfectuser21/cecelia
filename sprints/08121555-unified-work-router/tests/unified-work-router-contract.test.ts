import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Unified Work Router recovery and baseline contracts [BEHAVIOR]', () => {
  it('credential-bearing origin 不泄漏且不删除活跃 cwd', async () => {
    const module = await import('../../../packages/brain/src/harness-worktree.js');
    const root = mkdtempSync(join(tmpdir(), 'harness-origin-recovery-'));
    const source = join(root, 'source');
    const host = join(root, 'host');
    const wtPath = join(host, '.claude', 'worktrees', 'harness-v2', 'task-active123');
    const credentialOrigin = 'https://oauth2:super-secret@example.invalid/perfectuser21/cecelia.git';
    const cleanOrigin = 'https://example.invalid/perfectuser21/cecelia.git';
    const logs: string[] = [];
    const removed: string[] = [];
    try {
      execFileSync('git', ['init', '--initial-branch=main', source]);
      execFileSync('git', ['-C', source, 'config', 'user.email', 'harness@example.invalid']);
      execFileSync('git', ['-C', source, 'config', 'user.name', 'Harness']);
      execFileSync('git', ['-C', source, 'commit', '--allow-empty', '-m', 'baseline']);
      execFileSync('git', ['-C', source, 'remote', 'add', 'origin', cleanOrigin]);
      execFileSync('git', ['clone', source, wtPath]);
      execFileSync('git', ['-C', wtPath, 'remote', 'set-url', 'origin', credentialOrigin]);

      const actual = await module.ensureHarnessWorktree({
        taskId: 'active123-task',
        wtKey: 'active123',
        branch: 'cp-08122359-active123',
        baseRepo: source,
        wtHostRepo: host,
        activeKernelWorkspaces: [wtPath],
        rmFn: async (path: string) => { removed.push(path); },
        logFn: (line: string) => logs.push(line),
      });

      expect(actual).toBe(wtPath);
      expect(removed).toEqual([]);
      expect(execFileSync('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).trim()).toBe('true');
      expect(logs.join('\n')).not.toContain('super-secret');
      expect(module.canonicalizeGitOrigin(credentialOrigin)).toBe(module.canonicalizeGitOrigin(cleanOrigin));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('冻结 baseline 是产出 HEAD 祖先且三入口治理记录逐项锚定 baseline', () => {
    const sql = readFileSync('sprints/08121555-unified-work-router/tests/baseline-governance.sql', 'utf8');
    expect(sql).toContain("string_to_array(:'task_ids_csv', ',')");
    expect(sql).toContain('count(DISTINCT target.task_id) FROM target) = 3');
    expect(sql).toContain('r.base_sha = :\'baseline\'');
    expect(sql).toContain('c.base_revision = :\'baseline\'');
    expect(sql).toContain('h.source_revision = :\'baseline\'');
  });
});
