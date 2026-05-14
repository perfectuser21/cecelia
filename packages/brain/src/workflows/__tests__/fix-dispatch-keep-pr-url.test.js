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
    const startIdx = src.indexOf('export async function fixDispatchNode');
    expect(startIdx).toBeGreaterThan(-1);
    // 找到函数体结束 (匹配下一个 `^}` 或下一个 `export `)
    const restAfter = src.slice(startIdx);
    const endRel = restAfter.search(/\n\}\n/);
    expect(endRel).toBeGreaterThan(-1);
    const body = restAfter.slice(0, endRel);
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
