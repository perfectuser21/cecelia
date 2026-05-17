import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B15: evaluate_contract verdict 解析改用 extractField', () => {
  const graphSource = readFileSync(
    resolve(__dirname, '../harness-task.graph.js'),
    'utf8'
  );

  it('graph.js 不再含老 regex /verdict:\\s*(PASS|FAIL)/i', () => {
    expect(graphSource).not.toMatch(/stdout\.match\(\/verdict:\\s\*\(PASS\|FAIL\)\/i\)/);
  });

  it('graph.js 含 extractField(.., "verdict") 调用', () => {
    expect(graphSource).toMatch(/extractField\([^,]+,\s*['"]verdict['"]\)/);
  });
});
