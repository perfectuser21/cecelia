import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(__dirname, '../../..');
const scriptPath = path.join(workspaceRoot, 'scripts/relay-demo/sort-json-keys.mjs');

function runSorter(input: unknown) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'relay-demo-sort-json-keys-'));
  const inputPath = path.join(tempDir, 'input.json');
  writeFileSync(inputPath, `${JSON.stringify(input)}\n`, 'utf8');

  const result = spawnSync(process.execPath, [scriptPath, inputPath], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });

  rmSync(tempDir, { recursive: true, force: true });
  return result;
}

describe('sort-json-keys CLI 合同 [BEHAVIOR]', () => {
  it('嵌套对象会递归按字典序排序；若输入已排序则保持语义一致且不增删字段', () => {
    const sortedInput = {
      alpha: {
        charlie: 3,
        delta: 4,
      },
      middle: {
        alpha: 1,
        bravo: 2,
      },
      zebra: 1,
    };
    const result = runSorter(sortedInput);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(sortedInput);
    expect(Object.keys(JSON.parse(result.stdout))).toEqual(Object.keys(sortedInput));
    expect(Object.keys(JSON.parse(result.stdout).alpha)).toEqual(Object.keys(sortedInput.alpha));
    expect(Object.keys(JSON.parse(result.stdout).middle)).toEqual(Object.keys(sortedInput.middle));
  });

  it('数组顺序保持不变，但数组中的对象元素也会递归排序', () => {
    const result = runSorter({
      items: [
        { bravo: 2, alpha: 1 },
        'plain',
        { delta: 4, charlie: 3 },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      items: [
        { alpha: 1, bravo: 2 },
        'plain',
        { charlie: 3, delta: 4 },
      ],
    });
  });

  it('空对象保持为空对象，不被替换或扩展', () => {
    const result = runSorter({
      outer: {},
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      outer: {},
    });
  });
});
