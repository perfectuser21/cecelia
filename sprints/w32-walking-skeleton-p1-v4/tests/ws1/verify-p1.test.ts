import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SCRIPT = resolve(ROOT, 'sprints/w32-walking-skeleton-p1-v4/verify-p1.sh');
const REPORT = resolve(ROOT, 'sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md');

function readScript(): string {
  if (!existsSync(SCRIPT)) throw new Error(`verify-p1.sh 不存在：${SCRIPT}（generator TDD red 阶段预期）`);
  return readFileSync(SCRIPT, 'utf8');
}

describe('Workstream 1 — verify-p1.sh 静态结构 [BEHAVIOR]', () => {
  it('verify-p1.sh 文件存在且可执行', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const st = statSync(SCRIPT);
    expect(st.mode & 0o111).toBeGreaterThan(0);
  });

  it('内含 POST /api/brain/tasks 创建 harness_initiative 的 curl 段', () => {
    const c = readScript();
    expect(c).toMatch(/curl[^\n]+-X\s+POST[^\n]+\/api\/brain\/tasks/);
    expect(c).toMatch(/harness_initiative/);
  });

  it('使用 PRD 字面 query 名 initiative_id（不漂到 iid/task/root_id/n）', () => {
    const c = readScript();
    expect(c).toMatch(/dispatch\/recent\?initiative_id=/);
    for (const bad of ['?iid=', '?task=', '?root_id=', '?n=', '?max=']) {
      expect(c.includes('dispatch/recent' + bad)).toBe(false);
    }
  });

  it('含 fleet/slots 调用 + in_use==in_progress_task_count 不变量断言', () => {
    const c = readScript();
    expect(c).toMatch(/\/api\/brain\/fleet\/slots/);
    expect(c).toMatch(/in_use[^\n]*in_progress_task_count/);
  });

  it('含 SQL count(DISTINCT thread_id) 检查 thread 连续性', () => {
    const c = readScript();
    expect(c).toMatch(/count\(DISTINCT\s+thread_id\)/i);
  });

  it('含 SQL 60min zombie 反向检查 (B8 阈值)', () => {
    const c = readScript();
    expect(c).toMatch(/last_heartbeat_at\s*<\s*NOW\(\)\s*-\s*interval\s*'60 minutes'/);
  });

  it('渲染 p1-final-acceptance.md 含 3 个必需段', () => {
    const c = readScript();
    expect(c).toContain('## Verdict:');
    expect(c).toContain('## Oracle a-g 实测');
    expect(c).toContain('## Anomaly');
  });

  it('不写入 packages/brain/** 任何文件', () => {
    const c = readScript();
    expect(c).not.toMatch(/>\s*packages\/brain/);
    expect(c).not.toMatch(/sed\s+-i[^\n]*packages\/brain/);
    expect(c).not.toMatch(/cp\s+[^\n]+\s+packages\/brain/);
  });

  it('使用 PRD 字面响应字段名（.status/.thread_id/.event_type/.in_use/.in_progress_task_count）', () => {
    const c = readScript();
    for (const lit of ['.status', '.thread_id', '.event_type', '.in_use', '.in_progress_task_count']) {
      expect(c).toContain(lit);
    }
  });

  it('不在 jq -e 正向断言里使用禁用字段名 (.state/.task_state/.phase/.stage/.used/.busy/.running_count)', () => {
    const c = readScript();
    for (const bad of ['.state', '.task_state', '.phase', '.stage', '.used', '.busy', '.running_count']) {
      expect(c.includes(`jq -e '${bad}`)).toBe(false);
      expect(c.includes(`jq -e "${bad}`)).toBe(false);
    }
  });
});

describe('Workstream 1 — p1-final-acceptance.md 报告结构 [BEHAVIOR]', () => {
  it('报告文件存在（TDD red：脚本未跑前不存在）', () => {
    expect(existsSync(REPORT)).toBe(true);
  });

  it('含字面 "## Verdict: PASS" 或 "## Verdict: FAIL" 行', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/^## Verdict: (PASS|FAIL)$/m);
  });

  it('含 "## Oracle a-g 实测" 段', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/^## Oracle a-g 实测/m);
  });

  it('含 "## Anomaly" 段', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toMatch(/^## Anomaly/m);
  });

  it('7 oracle 字母 a-g 各占表格一行', () => {
    const c = readFileSync(REPORT, 'utf8');
    for (const o of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(c).toMatch(new RegExp(`^\\| ${o} \\|`, 'm'));
    }
  });

  it('禁用同义 oracle 命名 (oracle1/oracle_a) 不出现', () => {
    const c = readFileSync(REPORT, 'utf8');
    for (const bad of ['oracle1', 'oracle2', 'oracle_a', 'oracle_b']) {
      expect(c).not.toMatch(new RegExp(bad));
    }
  });
});
