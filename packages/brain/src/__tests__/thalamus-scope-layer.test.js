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

    it('路由表应包含 scope 关键词', () => {
      expect(src).toContain('scope');
      expect(src).toContain('范围');
      expect(src).toContain('边界定义');
    });

    it('scope 关键词应路由到 initiative_plan', () => {
      const lines = src.split('\n');
      const scopeLine = lines.find(l => l.includes('scope') && l.includes('范围') && l.includes('边界定义'));
      expect(scopeLine).toBeDefined();
      expect(scopeLine).toContain('initiative_plan');
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
