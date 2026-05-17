/**
 * 验证 Thalamus prompt 和 Suggestion-Dispatcher prompt 包含 Scope 层级关键词
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Scope 层级识别', () => {
  describe('thalamus.js', () => {
    const src = readFileSync(resolve(__dirname, '../thalamus.js'), 'utf-8');

    it('丘脑 prompt 应包含 domain 路由（v2.0 domain-only 模式）', () => {
      expect(src).toContain('domain');
      expect(src).toContain('buildDomainRouteTable');
    });

    it('丘脑 prompt 应包含 planning domain 关键词（含 scope）', () => {
      expect(src).toContain('规划');
      expect(src).toContain('scope');
    });
  });

  describe('thalamus.js SUGGESTION_READY handler（层级描述已迁入丘脑）', () => {
    const thalamSrc = readFileSync(resolve(__dirname, '../thalamus.js'), 'utf-8');

    it('SUGGESTION_READY handler 应包含 Scope 层级', () => {
      expect(thalamSrc).toContain('Layer 5 Scope');
    });

    it('SUGGESTION_READY handler 应包含完整的 7 层层级定义', () => {
      expect(thalamSrc).toContain('Layer 3 KR');
      expect(thalamSrc).toContain('Layer 4 Project');
      expect(thalamSrc).toContain('Layer 5 Scope');
      expect(thalamSrc).toContain('Layer 6 Initiative');
      expect(thalamSrc).toContain('Layer 7 Task/Pipeline');
    });
  });
});
