/**
 * durability-config.test.js — Stream 2 (LangGraph 修正 sprint)
 *
 * 强校验所有顶层 graph .compile({ checkpointer ... }) 显式指定 durability:'sync'。
 * 默认 'async' 在 brain 进程崩溃时小概率丢最近 checkpoint，生产必须 'sync'。
 *
 * （harness-gan.graph.js 已随 A5 删除，其 MemorySaver fallback 守门一并移除。）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = resolve(__dirname, '..');

describe('durability config [BEHAVIOR]', () => {
  // dev-task.graph.js 已于 T6 物理删除（迁离 LangGraph，走 triggerCeceliaRun）
  const FILES = [
    'consciousness.graph.js',
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
});
