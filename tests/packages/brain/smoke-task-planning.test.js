import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SMOKE_SCRIPT = path.resolve(REPO_ROOT, 'packages/brain/scripts/smoke/smoke-task-planning.sh');

describe('smoke-task-planning.sh 结构验证', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SMOKE_SCRIPT)).toBe(true);
  });

  it('文件可执行', () => {
    const stat = fs.statSync(SMOKE_SCRIPT);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it('包含 ok/fail/section 函数', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('ok()');
    expect(c).toContain('fail()');
    expect(c).toContain('section()');
  });

  it('包含 32 个 feature 断言标签', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    const features = [
      // task (13)
      'task-create', 'task-update', 'task-dispatch', 'task-feedback',
      'task-block', 'task-unblock', 'task-checkpoint', 'task-ci-diagnosis',
      'task-log-viewer', 'task-reflections', 'task-route-diagnose',
      'task-type-config', 'task-type-info',
      // schedule (10)
      'schedule-nightly', 'schedule-daily-report', 'schedule-desire-loop',
      'schedule-kr-progress', 'schedule-okr-tick', 'schedule-pipeline-patrol',
      'schedule-rumination', 'schedule-topic-generation',
      'schedule-zombie-sweep', 'schedule-credential-check',
      // planning (4)
      'planner-slots', 'pr-plan', 'prd-generate', 'trd-generate',
      // proposal (5)
      'proposal-list', 'proposal-create', 'proposal-approve',
      'proposal-reject', 'proposal-rollback',
    ];
    for (const f of features) {
      expect(c, `缺少 feature: ${f}`).toContain(f);
    }
  });

  it('包含 exit 0/1 退出逻辑', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('exit 0');
    expect(c).toContain('exit 1');
  });

  it('包含 BRAIN 变量定义', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('BRAIN=');
    expect(c).toContain('localhost:5221');
  });
});
