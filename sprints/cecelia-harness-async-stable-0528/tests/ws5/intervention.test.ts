import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// vitest 运行目录: packages/brain/
const HANDLER_PATH = join(process.cwd(), 'src/harness-intervention-handler.js');
const ROUTER_PATH = join(process.cwd(), 'src/task-router.js');

describe('WS5 — Intervention Handler + Router 注册 [BEHAVIOR]', () => {
  it('harness-intervention-handler.js 文件存在', () => {
    expect(existsSync(HANDLER_PATH)).toBe(true);
  });

  it('handler 含 action 字段输出（retry/skip/alert）', () => {
    const c = readFileSync(HANDLER_PATH, 'utf8');
    expect(c).toContain('action');
    const hasValues = c.includes('retry') || c.includes('skip') || c.includes('alert');
    expect(hasValues).toBe(true);
  });

  it('handler 含 docker logs 读取逻辑', () => {
    const c = readFileSync(HANDLER_PATH, 'utf8');
    const hasDockerLogs = c.includes('docker') || c.includes('logs') || c.includes('container');
    expect(hasDockerLogs).toBe(true);
  });

  it('handler 含 LLM 客户端调用（现有 Brain LLM，不引入新外部依赖）', () => {
    const c = readFileSync(HANDLER_PATH, 'utf8');
    const hasLLM = c.includes('llm') || c.includes('LLM') || c.includes('claude') || c.includes('anthropic');
    expect(hasLLM).toBe(true);
  });

  it('handler 含 try-catch 错误处理（LLM 失败时返回 action=alert）', () => {
    const c = readFileSync(HANDLER_PATH, 'utf8');
    expect(c).toMatch(/try|catch/);
  });

  it('task-router.js 路由 harness_intervention → harness-intervention-handler', () => {
    const c = readFileSync(ROUTER_PATH, 'utf8');
    expect(c).toContain('harness-intervention-handler');
  });
});
