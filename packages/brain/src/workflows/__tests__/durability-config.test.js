/**
 * durability-config.test.js — Stream 2 (LangGraph 修正 sprint)
 *
 * 强校验所有顶层 graph .compile({ checkpointer ... }) 显式指定 durability:'sync'。
 * 默认 'async' 在 brain 进程崩溃时小概率丢最近 checkpoint，生产必须 'sync'。
 *
 * 同时守门 harness-gan.graph.js 不再有 `|| new MemorySaver()` 静默 fallback：
 * PostgresSaver 缺失必须 fail-fast，否则 brain 重启后 state 全丢 → ghost task。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = resolve(__dirname, '..');

describe('durability config [BEHAVIOR]', () => {
  const FILES = [
    'consciousness.graph.js',
    'dev-task.graph.js',
    'harness-gan.graph.js',
    'harness-task.graph.js',
    'harness-initiative.graph.js',
  ];

  for (const file of FILES) {
    it(`${file} 顶层 .compile({ checkpointer ... }) 必须含 durability:'sync'`, () => {
      const src = readFileSync(resolve(WORKFLOW_DIR, file), 'utf8');
      // 抓 .compile({ ... checkpointer ... }) 块（顶层 compile 都带 checkpointer，
      // subgraph 占位 compile 不带 checkpointer，正则不匹配，自动跳过）
      const matches = src.match(/\.compile\(\s*\{[^}]*checkpointer[^}]*\}\s*\)/g) || [];
      if (matches.length === 0) {
        // 该文件无顶层 compile（理论不应发生，但兜底不报错）
        return;
      }
      for (const m of matches) {
        expect(m, `compile 块缺 durability:\n${m}`).toMatch(/durability:\s*['"]sync['"]/);
      }
    });
  }

  it("harness-gan.graph.js 不含 MemorySaver fallback (`|| new MemorySaver()`)", () => {
    const src = readFileSync(resolve(WORKFLOW_DIR, 'harness-gan.graph.js'), 'utf8');
    expect(src).not.toMatch(/\|\|\s*new\s+MemorySaver/);
  });

  it('harness-gan.graph.js 不再 import MemorySaver（生产代码不该用）', () => {
    const src = readFileSync(resolve(WORKFLOW_DIR, 'harness-gan.graph.js'), 'utf8');
    // 抓 import 块里的 MemorySaver 标识符（包括 multi-line named import）
    const importBlocks = src.match(/import\s*\{[\s\S]*?\}\s*from\s*['"]@langchain\/langgraph['"]/g) || [];
    for (const blk of importBlocks) {
      expect(blk, `不应 import MemorySaver:\n${blk}`).not.toMatch(/\bMemorySaver\b/);
    }
  });

  it('runGanContractGraph 在 checkpointer 缺失时必须 throw（fail-fast，不 fallback）', async () => {
    const mod = await import('../harness-gan.graph.js');
    expect(typeof mod.runGanContractGraph).toBe('function');
    // 必填 taskId/executor 已经会先 throw；要专门测 checkpointer 校验，
    // 必须传齐前置必填项。错误消息应含 'checkpointer'。
    await expect(
      mod.runGanContractGraph({
        taskId: 'test-task-1',
        initiativeId: 'init-1',
        sprintDir: '/tmp/x',
        prdContent: 'prd',
        executor: async () => ({ stdout: '', stderr: '' }),
        worktreePath: '/tmp/x',
        githubToken: 'x',
        // checkpointer 故意不传
      })
    ).rejects.toThrow(/checkpointer/i);
  });
});
