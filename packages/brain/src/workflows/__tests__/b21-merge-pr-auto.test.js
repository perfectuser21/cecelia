import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B21: mergePrNode auto-merge PR', () => {
  const src = readFileSync(resolve(__dirname, '../harness-task.graph.js'), 'utf8');

  it('mergePrNode 函数体含 gh pr merge 调用', () => {
    const fnStart = src.indexOf('async function mergePrNode');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, fnStart + 1500);
    expect(fnBody).toMatch(/gh.*pr.*merge.*squash|gh.*pr.*merge.*--auto/i);
  });

  it('mergePrNode 使用 state.pr_url 作为合并目标', () => {
    const fnStart = src.indexOf('async function mergePrNode');
    const fnBody = src.slice(fnStart, fnStart + 1500);
    expect(fnBody).toMatch(/state\.pr_url|state\?\.pr_url/);
  });

  it('mergePrNode 处理 merge 失败（不 throw 让 graph 退 END）', () => {
    const fnStart = src.indexOf('async function mergePrNode');
    const fnBody = src.slice(fnStart, fnStart + 1500);
    expect(fnBody).toMatch(/try|catch/);
  });
});
