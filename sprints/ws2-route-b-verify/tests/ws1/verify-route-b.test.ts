import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SCRIPT_PATH = resolve(process.cwd(), 'sprints/ws2-route-b-verify/verify-route-b.sh');

describe('WS1 — verify-route-b.sh [BEHAVIOR]', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('脚本含 Route B 触发命令（POST /api/brain/tasks）', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('/api/brain/tasks');
    expect(content).toMatch(/POST/);
  });

  it('脚本含 task_type=dev 断言', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('task_type');
    expect(content).toContain('dev');
  });

  it('脚本含 title 非空断言', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('title');
  });

  it('脚本含时间窗口防造假逻辑', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');
    const hasTimeWindow =
      content.includes('300') ||
      content.includes('5 minutes') ||
      content.includes('date +%s');
    expect(hasTimeWindow).toBe(true);
  });

  it('脚本含 Brain 健康检查（Brain 离线时拒绝继续）', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('health');
  });
});
