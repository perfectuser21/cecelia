/**
 * Unified Intent Router Tests
 */

import { describe, it, expect } from 'vitest';
import { routeByTaskLayer, identifyTaskLayer } from '../unified-intent-router.js';

describe('Unified Intent Router', () => {
  describe('routeByTaskLayer', () => {
    it('Layer 1-4 应该路由到秋米拆解', async () => {
      const testCases = [
        { task_layer: 'Layer 1', expected: '/autumnrice' },
        { task_layer: 'Layer 2', expected: '/autumnrice' },
        { task_layer: 'Layer 3', expected: '/autumnrice' },
        { task_layer: 'Layer 4', expected: '/autumnrice' }
      ];

      for (const { task_layer, expected } of testCases) {
        const result = await routeByTaskLayer({
          task_layer,
          content: 'test content',
          source: 'test'
        });

        expect(result.action).toBe('decompose');
        expect(result.skill).toBe(expected);
      }
    });

    it('Layer 5-6 应该路由到 /dev', async () => {
      const testCases = [
        { task_layer: 'Layer 5', expected: '/dev' },
        { task_layer: 'Layer 6', expected: '/dev' }
      ];

      for (const { task_layer, expected } of testCases) {
        const result = await routeByTaskLayer({
          task_layer,
          content: 'test content',
          source: 'test'
        });

        expect(result.action).toBe('execute');
        expect(result.skill).toBe(expected);
      }
    });

    it('缺少 task_layer 时应该 fallback 到 Layer 5', async () => {
      const result = await routeByTaskLayer({
        content: 'test content',
        source: 'test'
      });

      expect(result.action).toBe('execute');
      expect(result.skill).toBe('/dev');
    });

    it('无效 task_layer 格式时应该 fallback', async () => {
      const result = await routeByTaskLayer({
        task_layer: 'invalid format',
        content: 'test content',
        source: 'test'
      });

      expect(result.action).toBe('execute');
      expect(result.skill).toBe('/dev');
    });
  });

  describe('identifyTaskLayer', () => {
    it('应该识别 OKR 相关内容为 Layer 2', async () => {
      const result = await identifyTaskLayer('创建 OKR 目标');
      expect(result).toBe('Layer 2');
    });

    it('应该识别项目相关内容为 Layer 4', async () => {
      const result = await identifyTaskLayer('启动新项目');
      expect(result).toBe('Layer 4');
    });

    it('应该识别修复类内容为 Layer 6', async () => {
      const result = await identifyTaskLayer('修复登录 bug');
      expect(result).toBe('Layer 6');
    });

    it('默认应该返回 Layer 5', async () => {
      const result = await identifyTaskLayer('普通开发任务');
      expect(result).toBe('Layer 5');
    });
  });
});
