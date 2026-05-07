import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync, constants } from 'node:fs';
import { execSync } from 'node:child_process';

const FIXED_UUID = '39d535f3-520a-4a92-a2b6-b31645e11664';
const SCRIPT_A = 'scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh';
const SCRIPT_B = 'scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh';
const SCRIPT_C = 'scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh';

describe('Workstream 2 — fault A: docker SIGKILL [BEHAVIOR]', () => {
  it('脚本 A 文件存在', () => {
    expect(() => accessSync(SCRIPT_A, constants.R_OK)).not.toThrow();
  });

  it('脚本 A 含 shebang + set -euo pipefail + fixed UUID', () => {
    const c = readFileSync(SCRIPT_A, 'utf8');
    expect(c).toMatch(/^#!\/bin\/bash/);
    expect(c).toMatch(/set -[eu]+o\s+pipefail/);
    expect(c).toContain(FIXED_UUID);
  });

  it('脚本 A 含 docker kill --signal=KILL 或 -s KILL', () => {
    const c = readFileSync(SCRIPT_A, 'utf8');
    expect(c).toMatch(/docker kill\s+(--signal=KILL|-s\s+KILL)/);
  });

  it('脚本 A 校验 callback_queue.failure_class=docker_oom_killed', () => {
    const c = readFileSync(SCRIPT_A, 'utf8');
    expect(c).toContain('callback_queue');
    expect(c).toContain('docker_oom_killed');
  });

  it('脚本 A 校验子任务最终 status=completed 且 execution_attempts 检查', () => {
    const c = readFileSync(SCRIPT_A, 'utf8');
    expect(c).toContain('execution_attempts');
    expect(c).toMatch(/status\s*=\s*['"]?completed/);
  });

  it('脚本 A bash -n 语法合法', () => {
    expect(() => execSync(`bash -n ${SCRIPT_A}`, { stdio: 'pipe' })).not.toThrow();
  });
});

describe('Workstream 2 — fault B: max_fix_rounds interrupt [BEHAVIOR]', () => {
  it('脚本 B 文件存在', () => {
    expect(() => accessSync(SCRIPT_B, constants.R_OK)).not.toThrow();
  });

  it('脚本 B 含 shebang + set -euo pipefail + fixed UUID', () => {
    const c = readFileSync(SCRIPT_B, 'utf8');
    expect(c).toMatch(/^#!\/bin\/bash/);
    expect(c).toMatch(/set -[eu]+o\s+pipefail/);
    expect(c).toContain(FIXED_UUID);
  });

  it('脚本 B 含 interrupt_pending + harness-interrupts API', () => {
    const c = readFileSync(SCRIPT_B, 'utf8');
    expect(c).toContain('interrupt_pending');
    expect(c).toContain('/api/brain/harness-interrupts');
  });

  it('脚本 B 含 resume body {"decision":{"action":"abort"}} + /resume 路径', () => {
    const c = readFileSync(SCRIPT_B, 'utf8');
    expect(c).toMatch(/"decision"\s*:\s*\{\s*"action"\s*:\s*"abort"/);
    expect(c).toMatch(/\/resume/);
  });

  it('脚本 B 校验 HTTP 202 + interrupt_resumed + initiative_runs.phase=failed', () => {
    const c = readFileSync(SCRIPT_B, 'utf8');
    expect(c).toContain('202');
    expect(c).toContain('interrupt_resumed');
    expect(c).toContain('initiative_runs');
    expect(c).toMatch(/phase\s*=\s*['"]?failed/);
  });

  it('脚本 B bash -n 语法合法', () => {
    expect(() => execSync(`bash -n ${SCRIPT_B}`, { stdio: 'pipe' })).not.toThrow();
  });
});

describe('Workstream 2 — fault C: watchdog deadline [BEHAVIOR]', () => {
  it('脚本 C 文件存在', () => {
    expect(() => accessSync(SCRIPT_C, constants.R_OK)).not.toThrow();
  });

  it('脚本 C 含 shebang + set -euo pipefail + fixed UUID', () => {
    const c = readFileSync(SCRIPT_C, 'utf8');
    expect(c).toMatch(/^#!\/bin\/bash/);
    expect(c).toMatch(/set -[eu]+o\s+pipefail/);
    expect(c).toContain(FIXED_UUID);
  });

  it('脚本 C 含 UPDATE initiative_runs SET deadline_at=NOW()-INTERVAL', () => {
    const c = readFileSync(SCRIPT_C, 'utf8');
    expect(c).toMatch(/UPDATE\s+initiative_runs[\s\S]+deadline_at\s*=\s*NOW\(\)\s*-\s*INTERVAL/i);
  });

  it('脚本 C 校验 failure_reason=watchdog_overdue', () => {
    const c = readFileSync(SCRIPT_C, 'utf8');
    expect(c).toContain('watchdog_overdue');
  });

  it('脚本 C 含轮询等待逻辑（for in $(seq ...)）', () => {
    const c = readFileSync(SCRIPT_C, 'utf8');
    expect(c).toMatch(/for\s+\w+\s+in\s+\$\(seq/);
  });

  it('脚本 C 校验 Brain 日志含 [harness-watchdog] flagged', () => {
    const c = readFileSync(SCRIPT_C, 'utf8');
    expect(c).toContain('harness-watchdog');
    expect(c).toContain('flagged');
  });

  it('脚本 C bash -n 语法合法', () => {
    expect(() => execSync(`bash -n ${SCRIPT_C}`, { stdio: 'pipe' })).not.toThrow();
  });
});
