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

  describe('suggestion-dispatcher.js', () => {
    const src = readFileSync(resolve(__dirname, '../suggestion-dispatcher.js'), 'utf-8');

    it('prompt 应包含 Scope 层级', () => {
      expect(src).toContain('Layer 5 Scope');
    });

    it('prompt 应包含完整的 7 层层级定义', () => {
      expect(src).toContain('Layer 3 KR');
      expect(src).toContain('Layer 4 Project');
      expect(src).toContain('Layer 5 Scope');
      expect(src).toContain('Layer 6 Initiative');
      expect(src).toContain('Layer 7 Task/Pipeline');
    });
  });
});
