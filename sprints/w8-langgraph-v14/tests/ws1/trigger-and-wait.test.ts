import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TRIGGER = 'sprints/w8-langgraph-v14/scripts/trigger.sh';
const TASK_ID_FILE = '/tmp/v14-initiative-task-id';

describe('Workstream 1 — trigger + wait pipeline [BEHAVIOR]', () => {
  it('trigger.sh 文件存在且可执行', () => {
    expect(existsSync(TRIGGER)).toBe(true);
    const mode = statSync(TRIGGER).mode;
    expect((mode & 0o111) !== 0).toBe(true);
  });

  it('trigger.sh 调用 POST /api/brain/tasks 注册 harness_initiative', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c).toContain('/api/brain/tasks');
    expect(c).toContain('harness_initiative');
    expect(c).toMatch(/curl[^\n]*-X\s+POST/);
  });

  it('trigger.sh 把 INITIATIVE_TASK_ID 写到 /tmp/v14-initiative-task-id', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c).toContain(TASK_ID_FILE);
  });

  it('trigger.sh 含轮询逻辑等待 status=completed（且不是死等 sleep 单次）', () => {
    const c = readFileSync(TRIGGER, 'utf8');
    expect(c).toContain('completed');
    expect(c).toMatch(/while|for/);
    expect(c).toMatch(/SELECT[^;]+status[^;]+FROM\s+tasks/i);
  });

  it('执行 trigger.sh 后 /tmp/v14-initiative-task-id 含合法 UUID（端到端真行为）', () => {
    execSync(`bash ${TRIGGER}`, { stdio: 'inherit', timeout: 5400_000 });
    expect(existsSync(TASK_ID_FILE)).toBe(true);
    const id = readFileSync(TASK_ID_FILE, 'utf8').trim();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }, 5400_000);

  it('initiative 在 tasks 表中达到 status=completed', () => {
    const id = readFileSync(TASK_ID_FILE, 'utf8').trim();
    const dbUrl = process.env.DB_URL || 'postgresql://localhost/cecelia';
    const status = execSync(
      `psql "${dbUrl}" -t -c "SELECT status FROM tasks WHERE id='${id}'"`,
      { encoding: 'utf8' }
    ).trim();
    expect(status).toBe('completed');
  });
});
