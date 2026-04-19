/**
 * executor.js — LangGraph PostgresSaver checkpointer 注入测试
 *
 * 不 spawn executor（依赖重），改为源码结构断言：
 *   1. 正确 import PostgresSaver
 *   2. 调 setup() 在 runHarnessPipeline 之前
 *   3. checkpointer 作为 runHarnessPipeline opts 传入
 *   4. DATABASE_URL fallback 指向本机 cecelia
 *
 * 动机：保证 43 分钟 harness pipeline 不会因 Brain 重启白跑（PostgresSaver 持久化 state）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(path.resolve(__dirname, '../executor.js'), 'utf8');

describe('executor.js — LangGraph PostgresSaver checkpointer 注入', () => {
  it('imports PostgresSaver from @langchain/langgraph-checkpoint-postgres', () => {
    expect(executorSrc).toMatch(/@langchain\/langgraph-checkpoint-postgres/);
    expect(executorSrc).toMatch(/PostgresSaver\.fromConnString/);
  });

  it('calls checkpointer.setup() before runHarnessPipeline', () => {
    const setupIdx = executorSrc.indexOf('checkpointer.setup()');
    const runIdx = executorSrc.indexOf('runHarnessPipeline(task,');
    expect(setupIdx).toBeGreaterThan(-1);
    expect(runIdx).toBeGreaterThan(-1);
    expect(setupIdx).toBeLessThan(runIdx);
  });

  it('passes checkpointer to runHarnessPipeline opts', () => {
    // 匹配 runHarnessPipeline(task, { ... checkpointer ... })
    const callBlock = executorSrc.match(/runHarnessPipeline\(task,\s*\{[\s\S]{0,800}?\}\)/);
    expect(callBlock).toBeTruthy();
    expect(callBlock[0]).toMatch(/checkpointer/);
  });

  it('uses DATABASE_URL fallback to localhost cecelia', () => {
    expect(executorSrc).toMatch(/postgresql:\/\/cecelia@localhost:5432\/cecelia/);
  });
});
