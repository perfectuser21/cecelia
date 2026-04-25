/**
 * content-pipeline-graph.test.js
 *
 * 验证 LangGraph 骨架 content pipeline：
 *   - 6 个节点定义齐全
 *   - happy path: research → copywrite → copy_review(APPROVED) → generate → image_review(PASS) → export
 *   - copy_review REVISION → 回到 copywrite
 *   - image_review FAIL    → 回到 generate
 */
import { describe, it, expect, vi } from 'vitest';

// 防真连 pg：compileContentPipelineApp 改 async 默认走 PgCheckpointer
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
    getNextVersion: vi.fn((current) => (typeof current === 'number' ? current + 1 : 1)),
  }),
}));

import {
  CONTENT_PIPELINE_NODE_NAMES,
  buildContentPipelineGraph,
  compileContentPipelineApp,
  placeholderNode,
} from '../content-pipeline-graph.js';

describe('CONTENT_PIPELINE_NODE_NAMES', () => {
  it('exposes the 6 expected node names in order', () => {
    expect(CONTENT_PIPELINE_NODE_NAMES).toEqual([
      'research',
      'copywrite',
      'copy_review',
      'generate',
      'image_review',
      'export',
    ]);
  });
});

describe('buildContentPipelineGraph + compileContentPipelineApp', () => {
  it('graph compiles with 6 nodes (skeleton)', async () => {
    const app = await compileContentPipelineApp();
    expect(app).toBeDefined();
    expect(typeof app.invoke).toBe('function');
    expect(typeof app.stream).toBe('function');
  });

  it('happy path: APPROVED + PASS reaches export and stops', async () => {
    const app = await compileContentPipelineApp();
    const finalState = await app.invoke(
      { pipeline_id: 'p-happy', keyword: 'demo' },
      { configurable: { thread_id: 'p-happy' } },
    );
    // trace 累计了 6 节点路径
    expect(finalState.trace).toEqual([
      'research', 'copywrite', 'copy_review', 'generate', 'image_review', 'export',
    ]);
    expect(finalState.copy_review_verdict).toBe('APPROVED');
    expect(finalState.image_review_verdict).toBe('PASS');
  });

  it('copy_review REVISION sends control back to copywrite (one rebound)', async () => {
    // copy_review 第一次返回 REVISION，第二次返回 APPROVED
    let reviewCalls = 0;
    const app = await compileContentPipelineApp({
      overrides: {
        copy_review: async () => {
          reviewCalls += 1;
          return {
            trace: 'copy_review',
            copy_review_verdict: reviewCalls === 1 ? 'REVISION' : 'APPROVED',
          };
        },
      },
    });
    const finalState = await app.invoke(
      { pipeline_id: 'p-rev', keyword: 'rebound' },
      { configurable: { thread_id: 'p-rev' } },
    );
    // copywrite 出现 2 次（首次 + REVISION 回路）
    const copywriteCount = finalState.trace.filter((t) => t === 'copywrite').length;
    expect(copywriteCount).toBe(2);
    expect(reviewCalls).toBe(2);
    // 最后到达 export
    expect(finalState.trace[finalState.trace.length - 1]).toBe('export');
  });

  it('image_review FAIL sends control back to generate (one rebound)', async () => {
    let imgCalls = 0;
    const app = await compileContentPipelineApp({
      overrides: {
        image_review: async () => {
          imgCalls += 1;
          return {
            trace: 'image_review',
            image_review_verdict: imgCalls === 1 ? 'FAIL' : 'PASS',
          };
        },
      },
    });
    const finalState = await app.invoke(
      { pipeline_id: 'p-fail', keyword: 'fix-loop' },
      { configurable: { thread_id: 'p-fail' } },
    );
    const generateCount = finalState.trace.filter((t) => t === 'generate').length;
    expect(generateCount).toBe(2);
    expect(imgCalls).toBe(2);
    expect(finalState.trace[finalState.trace.length - 1]).toBe('export');
  });

  it('state carries path references only (no large text bodies)', async () => {
    // 验证 state 可携带路径而不累积文本
    const app = await compileContentPipelineApp({
      overrides: {
        research: async () => ({
          trace: 'research',
          findings_path: '/tmp/findings.json',
        }),
        copywrite: async (state) => {
          // 下游节点拿到的是路径，不是 findings 内容本身
          expect(state.findings_path).toBe('/tmp/findings.json');
          return {
            trace: 'copywrite',
            copy_path: '/tmp/copy.md',
            article_path: '/tmp/article.md',
          };
        },
      },
    });
    const finalState = await app.invoke(
      { pipeline_id: 'p-refs', keyword: 'demo' },
      { configurable: { thread_id: 'p-refs' } },
    );
    expect(finalState.findings_path).toBe('/tmp/findings.json');
    expect(finalState.copy_path).toBe('/tmp/copy.md');
    expect(finalState.article_path).toBe('/tmp/article.md');
  });
});

describe('placeholderNode', () => {
  it('appends label to trace and merges optional state update', async () => {
    const node = placeholderNode('research', () => ({ findings_path: '/x/findings.json' }));
    const out = await node({});
    expect(out.trace).toBe('research');
    expect(out.findings_path).toBe('/x/findings.json');
  });

  it('default copy_review placeholder returns APPROVED (breaks rebound)', async () => {
    const app = await compileContentPipelineApp();
    const finalState = await app.invoke(
      { pipeline_id: 'p-default', keyword: 'demo' },
      { configurable: { thread_id: 'p-default' } },
    );
    // 默认 APPROVED 不回环
    expect(finalState.trace.filter((t) => t === 'copywrite').length).toBe(1);
  });

  it('default image_review placeholder returns PASS (breaks rebound)', async () => {
    const app = await compileContentPipelineApp();
    const finalState = await app.invoke(
      { pipeline_id: 'p-default-img', keyword: 'demo' },
      { configurable: { thread_id: 'p-default-img' } },
    );
    // 默认 PASS 不回环
    expect(finalState.trace.filter((t) => t === 'generate').length).toBe(1);
  });
});
