/**
 * topics-route.test.ts (contract test)
 *
 * 验证 GET /api/brain/topics 路由的静态契约：
 *   1. 路由文件存在
 *   2. 已注册到 routes.js
 *   3. 路由实现包含必要逻辑（日期过滤、默认今日、响应结构）
 *
 * 动态行为测试（mock db + supertest）见：
 *   packages/brain/src/__tests__/topics-route-behavior.test.js
 */

import { describe, it, expect } from 'vitest';
import { accessSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_SRC = resolve(__dirname, '../../../../../packages/brain/src');

// ─── Artifact 验证 ───────────────────────────────────────────────────────────

describe('GET /api/brain/topics — 路由 Artifact', () => {
  it('routes/topics.js 文件存在', () => {
    expect(() =>
      accessSync(resolve(BRAIN_SRC, 'routes/topics.js'))
    ).not.toThrow();
  });

  it('routes.js 已注册 topics 路由（包含 topics 关键字）', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes.js'), 'utf8');
    expect(content).toContain('topics');
  });

  it('routes.js 使用 /topics 路径挂载', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes.js'), 'utf8');
    expect(content).toContain('/topics');
  });
});

// ─── 路由实现契约 ─────────────────────────────────────────────────────────────

describe('GET /api/brain/topics — 路由实现契约', () => {
  it('使用 pool.query 查询 topic_selection_log', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes/topics.js'), 'utf8');
    expect(content).toContain('topic_selection_log');
    expect(content).toContain('pool.query');
  });

  it('默认按 CURRENT_DATE 过滤（无 date 参数时返回今日）', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes/topics.js'), 'utf8');
    expect(content).toContain('CURRENT_DATE');
  });

  it('支持 ?date 参数过滤指定日期（使用 $1 参数化查询）', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes/topics.js'), 'utf8');
    expect(content).toContain('selected_date = $1');
    expect(content).toContain('req.query');
  });

  it('响应体包含 data / date / total 字段', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes/topics.js'), 'utf8');
    expect(content).toContain('data:');
    expect(content).toContain('date:');
    expect(content).toContain('total:');
  });

  it('错误处理返回 500', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes/topics.js'), 'utf8');
    expect(content).toContain('status(500)');
  });

  it('从 db.js 导入 pool（使用项目标准 db 模块）', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes/topics.js'), 'utf8');
    expect(content).toContain("from '../db.js'");
  });
});

// ─── topic-selector 无硬编码 codex/gpt-5.4 ──────────────────────────────────

describe('topic-selector.js — LLM 调用契约', () => {
  it('使用 callLLM 函数调用 LLM', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'topic-selector.js'), 'utf8');
    expect(content).toContain('callLLM');
  });

  it('使用 cortex profile（非硬编码 codex）', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'topic-selector.js'), 'utf8');
    expect(content).toContain('cortex');
  });

  it('不包含硬编码 gpt-5.4 模型', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'topic-selector.js'), 'utf8');
    expect(content).not.toContain('gpt-5.4');
  });
});

// ─── llm-caller.js fallback 机制 ─────────────────────────────────────────────

describe('llm-caller.js — fallback 机制契约', () => {
  it('包含 candidates 候选列表', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'llm-caller.js'), 'utf8');
    expect(content).toContain('candidates');
  });

  it('包含 fallbacks 配置', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'llm-caller.js'), 'utf8');
    expect(content).toContain('fallbacks');
  });
});
