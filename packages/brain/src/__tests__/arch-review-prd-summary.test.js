/**
 * arch-review-prd-summary.test.js
 *
 * 验证 daily-review-scheduler 生成的 arch_review task payload 含 prd_summary，
 * 且 ≥ 20 字符（pre-flight-check L64 门槛）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('arch_review task payload 含 prd_summary ≥ 20 字符', () => {
  it('INSERT 语句的 payload JSON 含 prd_summary 且长度 ≥ 20', () => {
    const src = readFileSync(resolve(__dirname, '../daily-review-scheduler.js'), 'utf8');

    // 找 arch_review 的 INSERT：VALUES ($1, 'arch_review', ...) 的位置
    // 该字符串唯一标识 arch_review 的 INSERT 语句
    const archInsertValuesIndex = src.indexOf("VALUES ($1, 'arch_review'");
    expect(archInsertValuesIndex).toBeGreaterThan(-1);

    // 向后截取足够的内容（payload JSON 在 VALUES 后面的参数数组里）
    const insertRegion = src.slice(archInsertValuesIndex, archInsertValuesIndex + 1000);

    // 必须含 prd_summary 字段
    expect(insertRegion).toMatch(/prd_summary/);

    // 提取 prd_summary 的实际值并验证长度 ≥ 20
    const match = insertRegion.match(/prd_summary['"]?\s*:\s*`([^`]+)`/);
    if (match) {
      // 模板字符串：去掉 ${...} 占位符后的静态部分也应 ≥ 20 字符
      const staticPart = match[1].replace(/\$\{[^}]+\}/g, '');
      expect(staticPart.length).toBeGreaterThanOrEqual(20);
    } else {
      // 普通字符串
      const matchStr = insertRegion.match(/prd_summary['"]?\s*:\s*['"]([^'"]+)['"]/);
      expect(matchStr).not.toBeNull();
      if (matchStr) {
        expect(matchStr[1].length).toBeGreaterThanOrEqual(20);
      }
    }
  });
});
