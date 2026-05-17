/**
 * cortex.js 结构性回归测试
 * 守护 analyzeDeep 圈复杂度，防止重构后再次退化（CC 55 → ~2）
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORTEX_PATH = resolve(__dirname, '../cortex.js');

describe('cortex.js 结构回归守护', () => {
  const cortexSource = readFileSync(CORTEX_PATH, 'utf8');

  describe('analyzeDeep 函数复杂度守护', () => {
    it('analyzeDeep 函数体不超过 35 行（CC 退化防护）', () => {
      // 提取 analyzeDeep 函数体（从函数声明到第一个 closing }）
      const match = cortexSource.match(/async function analyzeDeep[\s\S]*?\n\}/);
      expect(match).not.toBeNull();

      const lines = match[0].split('\n').length;
      expect(lines).toBeLessThanOrEqual(35);
    });

    it('analyzeDeep 通过委托模式实现（调用 _buildBaseContext）', () => {
      // 验证 analyzeDeep 调用了 _buildBaseContext 辅助函数（委托拆分的核心标志）
      const match = cortexSource.match(/async function analyzeDeep[\s\S]*?\n\}/);
      expect(match).not.toBeNull();

      expect(match[0]).toContain('_buildBaseContext');
    });

    it('analyzeDeep 通过委托模式实现（调用 _callLLMAndProcess）', () => {
      // 验证 analyzeDeep 调用了 _callLLMAndProcess 辅助函数
      const match = cortexSource.match(/async function analyzeDeep[\s\S]*?\n\}/);
      expect(match).not.toBeNull();

      expect(match[0]).toContain('_callLLMAndProcess');
    });
  });
});
