import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

import { scanAutonomousSessions } from '../src/routes/autonomous.js';

describe('scanAutonomousSessions', () => {
  let tmpRepo;

  beforeEach(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'auto-scan-'));
    execSync(`git init -q "${tmpRepo}"`, { stdio: 'pipe' });
    execSync(`git -C "${tmpRepo}" config user.email t@t.com`, { stdio: 'pipe' });
    execSync(`git -C "${tmpRepo}" config user.name t`, { stdio: 'pipe' });
    execSync(`git -C "${tmpRepo}" commit --allow-empty -qm init`, { stdio: 'pipe' });
  });

  afterEach(() => rmSync(tmpRepo, { recursive: true, force: true }));

  it('空仓库无 dev-mode → 返回空数组', async () => {
    const sessions = await scanAutonomousSessions(tmpRepo);
    expect(sessions).toEqual([]);
  });

  it('主仓库有 dev-mode → 解析正确', async () => {
    writeFileSync(join(tmpRepo, '.dev-mode.cp-test'), [
      'dev',
      'branch: cp-test',
      'autonomous_mode: true',
      'owner_session: sess-abc',
      'started: 2026-04-14T10:00:00+08:00',
      'step_0_worktree: done',
      'step_1_spec: done',
      'step_2_code: pending',
      'step_3_integrate: pending',
      'step_4_ship: pending',
    ].join('\n'));
    const sessions = await scanAutonomousSessions(tmpRepo);
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.branch).toBe('cp-test');
    expect(s.autonomous_mode).toBe(true);
    expect(s.owner_session).toBe('sess-abc');
    expect(s.steps.step_0_worktree).toBe('done');
    expect(s.steps.step_2_code).toBe('pending');
    expect(s.elapsed_seconds).toBeGreaterThanOrEqual(0);
  });

  it('harness_mode: true → 正确解析', async () => {
    writeFileSync(join(tmpRepo, '.dev-mode.cp-h'), [
      'dev', 'branch: cp-h', 'harness_mode: true', 'step_2_code: pending'
    ].join('\n'));
    const sessions = await scanAutonomousSessions(tmpRepo);
    expect(sessions[0].harness_mode).toBe(true);
  });

  it('cleanup_done: true → 排除', async () => {
    writeFileSync(join(tmpRepo, '.dev-mode.cp-done'), [
      'dev', 'branch: cp-done', 'step_2_code: done', 'cleanup_done: true'
    ].join('\n'));
    const sessions = await scanAutonomousSessions(tmpRepo);
    expect(sessions).toEqual([]);
  });

  it('按 started 降序', async () => {
    writeFileSync(join(tmpRepo, '.dev-mode.cp-old'), [
      'dev', 'branch: cp-old', 'started: 2026-04-14T08:00:00+08:00', 'step_2_code: pending'
    ].join('\n'));
    writeFileSync(join(tmpRepo, '.dev-mode.cp-new'), [
      'dev', 'branch: cp-new', 'started: 2026-04-14T12:00:00+08:00', 'step_2_code: pending'
    ].join('\n'));
    const sessions = await scanAutonomousSessions(tmpRepo);
    expect(sessions[0].branch).toBe('cp-new');
    expect(sessions[1].branch).toBe('cp-old');
  });
});
