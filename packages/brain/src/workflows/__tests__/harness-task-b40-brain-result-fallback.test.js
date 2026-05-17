import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B40: evaluateContractNode Protocol v2.5 — .brain-result.json fallback', () => {
  const graphSource = readFileSync(
    resolve(__dirname, '../harness-task.graph.js'),
    'utf8'
  );

  it('graph.js 导入 readBrainResult', () => {
    expect(graphSource).toMatch(/readBrainResult/);
  });

  it('graph.js 含 Protocol v2.5 fallback 注释', () => {
    expect(graphSource).toMatch(/Protocol v2\.5/);
  });

  it('graph.js 在 readVerdictFile 为 null 时尝试 readBrainResult', () => {
    // 验证 readBrainResult 调用在 readVerdictFile 的 if 块之后
    const v2Pos = graphSource.indexOf('readVerdictFile(state.worktreePath)');
    const v25Pos = graphSource.indexOf('readBrainResult(state.worktreePath');
    expect(v2Pos).toBeGreaterThan(-1);
    expect(v25Pos).toBeGreaterThan(v2Pos);
  });

  it('graph.js readBrainResult 调用被 try-catch 包裹以防文件不存在', () => {
    expect(graphSource).toMatch(/try\s*\{[\s\S]*?readBrainResult[\s\S]*?\}\s*catch/);
  });

  it('graph.js .brain-result.json 结果使用 log_excerpt 或 failed_step 作为 feedback', () => {
    expect(graphSource).toMatch(/brainResult\.log_excerpt\s*\|\|\s*brainResult\.failed_step/);
  });
});
