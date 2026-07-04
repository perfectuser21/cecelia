/**
 * determinism.test.js —— 确定性纪律守门测试
 *
 * 验证 orchestrator 纯函数层（derive / gates / counters）不含非确定性调用：
 *   Date.now() / Math.random() / new Date()
 *
 * 这些函数在 tick 循环中反复调用，任何隐性时钟/随机依赖都会导致
 * 跨 hop 行为不可重放（断言来自 design doc §确定性纪律）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PURE_MODULES = ['derive', 'gates', 'counters'];
const NON_DETERMINISTIC_PATTERN = /Date\.now\s*\(|Math\.random\s*\(|new\s+Date\s*\(/;

const SRC_DIR = resolve(new URL('../', import.meta.url).pathname);

describe('确定性纪律：纯函数模块禁止非确定性调用', () => {
  for (const mod of PURE_MODULES) {
    it(`${mod}.js 不含 Date.now / Math.random / new Date`, () => {
      const src = readFileSync(resolve(SRC_DIR, `${mod}.js`), 'utf8');
      // 去掉注释行再检查（注释里可以提及这些名字）
      const codeOnly = src
        .split('\n')
        .filter(line => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
        .join('\n');
      expect(NON_DETERMINISTIC_PATTERN.test(codeOnly)).toBe(false);
    });
  }
});

describe('确定性纪律：纯函数模块不引入 Node.js IO 模块', () => {
  const IO_PATTERN = /require\(['"]fs['"]\)|import.*from\s+['"]fs['"]/;

  for (const mod of PURE_MODULES) {
    it(`${mod}.js 不直接 import/require fs`, () => {
      const src = readFileSync(resolve(SRC_DIR, `${mod}.js`), 'utf8');
      expect(IO_PATTERN.test(src)).toBe(false);
    });
  }
});
