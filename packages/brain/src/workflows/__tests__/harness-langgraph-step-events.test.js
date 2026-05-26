/**
 * harness-langgraph-step-events.test.js
 * 验证 harness-initiative.graph.js 在关键节点向 cecelia_events 写入 langgraph_step 事件。
 * 使用 source-code 扫描（不需要完整 node_modules），与同目录其他 b-series test 同模式。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  '../../harness-initiative.graph.js'
);
const src = readFileSync(SRC_PATH, 'utf8');

// 截取各函数体的辅助函数
function extractFnBody(fnName, nextFnMarker) {
  const start = src.indexOf(`export async function ${fnName}`);
  if (start === -1) return '';
  const end = nextFnMarker ? src.indexOf(nextFnMarker, start) : start + 800;
  return src.slice(start, end > start ? end : start + 800);
}

describe('emitLangGraphStep helper', () => {
  it('is defined and inserts into cecelia_events', () => {
    expect(src).toMatch(/async function emitLangGraphStep/);
    expect(src).toMatch(/INSERT INTO cecelia_events/);
    expect(src).toMatch(/'langgraph_step'/);
    expect(src).toMatch(/'harness-initiative'/);
  });

  it('swallows DB errors (try/catch with console.warn)', () => {
    const helperSection = src.slice(
      src.indexOf('async function emitLangGraphStep'),
      src.indexOf('\nexport const InitiativeState')
    );
    expect(helperSection).toMatch(/catch.*err/);
    expect(helperSection).toMatch(/console\.warn/);
  });

  it('skips insert when taskId is falsy (early return guard)', () => {
    const helperSection = src.slice(
      src.indexOf('async function emitLangGraphStep'),
      src.indexOf('\nexport const InitiativeState')
    );
    expect(helperSection).toMatch(/if\s*\(!taskId\)\s*return/);
  });
});

describe('runGanLoopNode — langgraph_step events', () => {
  const body = extractFnBody('runGanLoopNode', '\nexport async function dbUpsertNode');

  it('emits proposer event at start', () => {
    expect(body).toMatch(/emitLangGraphStep/);
    expect(body).toMatch(/node.*proposer/);
  });

  it('emits reviewer event after ganResult with review_round', () => {
    expect(body).toMatch(/node.*reviewer/);
    expect(body).toMatch(/review_round/);
    expect(body).toMatch(/review_verdict/);
  });
});

describe('fanoutPassthroughNode — langgraph_step events', () => {
  const body = extractFnBody('fanoutPassthroughNode', '\n// Layer 3');

  it('emits generator event', () => {
    expect(body).toMatch(/emitLangGraphStep/);
    expect(body).toMatch(/generator/);
  });
});

describe('finalE2eNode — langgraph_step events', () => {
  const body = extractFnBody('finalE2eNode', '\nexport async function reportNode');

  it('emits evaluator event', () => {
    expect(body).toMatch(/emitLangGraphStep/);
    expect(body).toMatch(/evaluator/);
  });
});

describe('reportNode — langgraph_step events', () => {
  const body = extractFnBody('reportNode', '\n// ────');

  it('emits report event with evaluator_verdict and pr_urls', () => {
    expect(body).toMatch(/emitLangGraphStep/);
    expect(body).toMatch(/node.*report/);
    expect(body).toMatch(/evaluator_verdict/);
    expect(body).toMatch(/pr_urls/);
  });
});
