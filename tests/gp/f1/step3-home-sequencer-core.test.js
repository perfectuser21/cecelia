// Crystal 历史编码证据仍从此格序派生；当前Workflow不执行旧序列器路由。
import { describe, it, expect } from 'vitest';
import { STAGE_ORDER } from '../../../packages/brain/src/orchestrator/home-sequencer.js';

describe('历史编码证据的格序', () => {
  it('保留Crystal正在消费的历史格名与顺序', () => {
    expect(STAGE_ORDER).toEqual([
      '__run_init', 'plan', 'contract', 'seal', 'generate',
      'evaluate', 'judge', 'publish', 'merge', 'cleanup', '__run_finalize',
    ]);
  });
});
