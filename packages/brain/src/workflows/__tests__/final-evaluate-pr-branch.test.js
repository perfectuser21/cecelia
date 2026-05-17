import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B17: finalEvaluateDispatchNode env 含 PR_BRANCH', () => {
  const src = readFileSync(
    resolve(__dirname, '../harness-initiative.graph.js'),
    'utf8'
  );

  // 提取 finalEvaluateDispatchNode 函数体
  const fnStart = src.indexOf('export async function finalEvaluateDispatchNode');
  const fnEnd = src.indexOf('\nexport ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 5000);

  it('finalEvaluateDispatchNode env 块含 PR_URL', () => {
    expect(fnBody).toMatch(/PR_URL\s*:/);
  });

  it('finalEvaluateDispatchNode env 块含 PR_BRANCH', () => {
    expect(fnBody).toMatch(/PR_BRANCH\s*:/);
  });
});
