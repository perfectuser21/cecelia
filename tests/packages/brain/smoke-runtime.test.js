import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SMOKE_SCRIPT = path.resolve(REPO_ROOT, 'packages/brain/scripts/smoke/smoke-runtime.sh');

describe('smoke-runtime.sh 结构验证', () => {
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

  it('包含 27 个 feature 断言标签', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    const features = [
      // health
      'brain-health', 'brain-status', 'circuit-breaker', 'brain-status-full', 'circuit-breaker-reset',
      // admin
      'llm-caller', 'area-slot-config', 'model-profile', 'skills-registry', 'task-type-config', 'device-lock',
      // agent
      'agent-execution', 'executor-status', 'cluster-status', 'session-scan', 'session-kill',
      // tick
      'self-drive', 'tick-loop', 'tick-cleanup-zombie', 'recurring-tasks',
      'tick-disable', 'tick-enable', 'tick-drain', 'tick-drain-cancel',
      'tick-drain-status', 'tick-execute', 'tick-startup-errors',
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
