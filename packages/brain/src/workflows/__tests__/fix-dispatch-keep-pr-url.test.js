import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fixDispatchNode } from '../harness-task.graph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B19: fixDispatchNode 保留 pr_url / pr_branch（同 PR push 新 commit）', () => {
  const src = readFileSync(
    resolve(__dirname, '../harness-task.graph.js'),
    'utf8'
  );

  it('fixDispatchNode 函数体不再 reset pr_url = null', () => {
    const fnMatch = src.match(/export async function fixDispatchNode[\s\S]{0,400}\n\}/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch[0];
    expect(body).not.toMatch(/pr_url:\s*null/);
    expect(body).not.toMatch(/pr_branch:\s*null/);
  });

  it('fixDispatchNode 真返回不含 pr_url/pr_branch reset', async () => {
    const result = await fixDispatchNode({
      fix_round: 1,
      pr_url: 'https://github.com/x/y/pull/2936',
      pr_branch: 'cp-xxx-ws1',
    });
    // 返回 object 中应不显式 set pr_url 或 pr_branch（让 reducer 保留旧值）
    expect(result.pr_url).toBeUndefined();
    expect(result.pr_branch).toBeUndefined();
    expect(result.fix_round).toBe(2);
    expect(result.containerId).toBeNull();
    expect(result.ci_status).toBe('pending');
  });
});
