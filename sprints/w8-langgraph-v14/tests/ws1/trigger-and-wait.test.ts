// Round 3: 8 个 it() 用例覆盖 trigger.sh 全部 BEHAVIOR；
// 不动代码跑（脚本未实现）→ 8 个全红，命令：
//   npx vitest run sprints/w8-langgraph-v14/tests/ws1/ --reporter=verbose
// 新增第 8 条覆盖 R5 mitigation：GENERATOR 30min stall fail-fast。
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TRIGGER = 'sprints/w8-langgraph-v14/scripts/trigger.sh';
const TASK_ID_FILE = '/tmp/v14-initiative-task-id';
const DB_URL = process.env.DB_URL || 'postgresql://localhost/cecelia';

describe('Workstream 1 — trigger + 60s fail-fast + 30min stall + wait pipeline [BEHAVIOR]', () => {
  // L14 — 未实现红证据：existsSync(TRIGGER) === false → 第一行断言失败
  it('trigger.sh 文件存在且可执行', () => {
    expect(existsSync(TRIGGER)).toBe(true);
    const mode = statSync(TRIGGER).mode;
    expect((mode & 0o111) !== 0).toBe(true);
  });

  // L22 — 未实现红证据：readFileSync 抛 ENOENT
  it('trigger.sh 调用 POST /api/brain/tasks 注册 harness_initiative', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c).toContain('/api/brain/tasks');
    expect(c).toContain('harness_initiative');
    expect(c).toMatch(/curl[^\n]*-X\s+POST/);
  });

  // L30 — 未实现红证据：readFileSync 抛 ENOENT
  it('trigger.sh 把 INITIATIVE_TASK_ID 写到 /tmp/v14-initiative-task-id', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c).toContain(TASK_ID_FILE);
  });

  // L38 — 未实现红证据：readFileSync 抛 ENOENT
  it('trigger.sh 含轮询逻辑等待 status=completed（且不是死等 sleep 单次）', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c).toContain('completed');
    expect(c).toMatch(/while|for/);
    expect(c).toMatch(/SELECT[^;]+status[^;]+FROM\s+tasks/i);
  });

  // L46 — 未实现红证据：execSync ENOENT 抛错；脚本未跑 → /tmp/v14-initiative-task-id 不存在
  it('执行 trigger.sh 后 /tmp/v14-initiative-task-id 含合法 UUID（端到端真行为）', () => {
    execSync(`bash ${TRIGGER}`, { stdio: 'inherit', timeout: 5400_000 });
    expect(existsSync(TASK_ID_FILE)).toBe(true);
    const id = readFileSync(TASK_ID_FILE, 'utf8').trim();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }, 5400_000);

  // L57 — 未实现红证据：脚本未跑过 → harness_initiatives 没有对应行 → count = 0
  // R1 mitigation: 60s consciousness loop fail-fast
  it('trigger.sh 含 60s consciousness loop fail-fast 校验且生效（harness_initiatives 行已派生 — R1）', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c).toContain('harness_initiatives');
    expect(c).toMatch(/(60|fail.fast|consciousness)/i);
    const id = readFileSync(TASK_ID_FILE, 'utf8').trim();
    const cnt = execSync(
      `psql "${DB_URL}" -t -c "SELECT count(*) FROM harness_initiatives WHERE root_task_id='${id}'"`,
      { encoding: 'utf8' }
    ).trim();
    expect(cnt).toBe('1');
  });

  // L70 — 未实现红证据：psql 在 tasks 表查不到该 id → 空字符串 !== 'completed'
  it('initiative 在 tasks 表中达到 status=completed', () => {
    const id = readFileSync(TASK_ID_FILE, 'utf8').trim();
    const status = execSync(
      `psql "${DB_URL}" -t -c "SELECT status FROM tasks WHERE id='${id}'"`,
      { encoding: 'utf8' }
    ).trim();
    expect(status).toBe('completed');
  });

  // L80 — 未实现红证据：脚本不存在 → readFileSync 抛 ENOENT
  // R5 mitigation: GENERATOR 节点停留 > 30min 即 exit 3 fail-fast
  // 静态校验脚本含必要关键字 + 数值阈值 + exit code 三要素
  it('trigger.sh 含 GENERATOR 节点停留 > 30min 即 exit 3 fail-fast 段（R5 mitigation 实证）', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c, 'GENERATOR 关键字缺失').toMatch(/GENERATOR/);
    expect(c, 'harness_state_transitions 关键字缺失').toContain('harness_state_transitions');
    expect(c, '30min 阈值数字缺失').toMatch(/\b30\b/);
    expect(c, 'exit 3 fail-fast 关键字缺失').toMatch(/exit\s+3/);
  });
});
