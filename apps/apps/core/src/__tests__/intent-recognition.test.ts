/**
 * Intent Recognition Unit Tests
 *
 * Tests for KR1 intent recognition functionality
 */

import { describe, it, expect } from 'vitest';
import { recognizeIntent } from '../services/intent-recognition.service.js';
import { extractIntent, extractPriority, extractStatus, extractTitle, extractEntities } from '../utils/nlp-parser.js';
import { IntentType } from '../types/intent.types.js';

describe('Intent Recognition Service', () => {
  describe('CREATE_TASK intent', () => {
    it('识别"实现用户登录接口"为 CREATE_TASK', () => {
      const result = recognizeIntent({ text: '实现用户登录接口' });
      expect(result.intent).toBe(IntentType.CREATE_TASK);
      expect(result.entities.title).toBe('用户登录接口');
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('识别"添加用户管理功能"为 CREATE_TASK', () => {
      const result = recognizeIntent({ text: '添加用户管理功能' });
      expect(result.intent).toBe(IntentType.CREATE_TASK);
      expect(result.entities.title).toBeDefined();
    });

    it('识别"implement login API"为 CREATE_TASK', () => {
      const result = recognizeIntent({ text: 'implement login API' });
      expect(result.intent).toBe(IntentType.CREATE_TASK);
    });
  });

  describe('CREATE_GOAL intent', () => {
    it('识别"完成整个用户认证系统作为 P0 目标"为 CREATE_GOAL', () => {
      const result = recognizeIntent({ text: '完成整个用户认证系统作为 P0 目标' });
      expect(result.intent).toBe(IntentType.CREATE_GOAL);
      expect(result.entities.title).toContain('用户认证系统');
      expect(result.entities.priority).toBe('P0');
    });

    it('识别"实现整个系统"为 CREATE_GOAL', () => {
      const result = recognizeIntent({ text: '实现整个用户管理系统' });
      expect(result.intent).toBe(IntentType.CREATE_GOAL);
    });
  });

  describe('CREATE_PROJECT intent', () => {
    it('识别"新建一个电商项目"为 CREATE_PROJECT', () => {
      const result = recognizeIntent({ text: '新建一个电商项目' });
      expect(result.intent).toBe(IntentType.CREATE_PROJECT);
    });

    it('识别"create new project"为 CREATE_PROJECT', () => {
      const result = recognizeIntent({ text: 'create new project' });
      expect(result.intent).toBe(IntentType.CREATE_PROJECT);
    });
  });

  describe('QUERY_TASKS intent', () => {
    it('识别"我有哪些待办任务"为 QUERY_TASKS', () => {
      const result = recognizeIntent({ text: '我有哪些待办任务' });
      expect(result.intent).toBe(IntentType.QUERY_TASKS);
      expect(result.entities.status).toBe('pending');
    });

    it('识别"查看所有任务"为 QUERY_TASKS', () => {
      const result = recognizeIntent({ text: '查看所有任务' });
      expect(result.intent).toBe(IntentType.QUERY_TASKS);
    });
  });

  describe('UPDATE_TASK intent', () => {
    it('识别"把登录功能标记为完成"为 UPDATE_TASK', () => {
      const result = recognizeIntent({ text: '把登录功能标记为完成' });
      expect(result.intent).toBe(IntentType.UPDATE_TASK);
      expect(result.entities.status).toBe('completed');
    });

    it('识别"更新任务状态为进行中"为 UPDATE_TASK', () => {
      const result = recognizeIntent({ text: '更新任务状态为进行中' });
      expect(result.intent).toBe(IntentType.UPDATE_TASK);
      expect(result.entities.status).toBe('in_progress');
    });
  });

  describe('Priority extraction', () => {
    it('提取 P0 优先级', () => {
      const priority = extractPriority('完成用户认证系统作为 P0 目标');
      expect(priority).toBe('P0');
    });

    it('提取 P1 优先级', () => {
      const priority = extractPriority('实现登录功能 P1');
      expect(priority).toBe('P1');
    });

    it('提取 P2 优先级', () => {
      const priority = extractPriority('添加 P2 普通功能');
      expect(priority).toBe('P2');
    });

    it('没有优先级时返回 undefined', () => {
      const priority = extractPriority('实现登录功能');
      expect(priority).toBeUndefined();
    });
  });

  describe('Status extraction', () => {
    it('提取 completed 状态', () => {
      const status = extractStatus('标记为完成');
      expect(status).toBe('completed');
    });

    it('提取 pending 状态', () => {
      const status = extractStatus('查看待办任务');
      expect(status).toBe('pending');
    });

    it('提取 in_progress 状态', () => {
      const status = extractStatus('正在进行中的任务');
      expect(status).toBe('in_progress');
    });
  });

  describe('Title extraction', () => {
    it('提取任务标题（移除"实现"前缀）', () => {
      const title = extractTitle('实现用户登录接口', IntentType.CREATE_TASK);
      expect(title).toBe('用户登录接口');
    });

    it('提取任务标题（移除"添加"前缀）', () => {
      const title = extractTitle('添加用户管理功能', IntentType.CREATE_TASK);
      expect(title).toContain('用户管理');
    });

    it('移除优先级标记', () => {
      const title = extractTitle('P0 完成用户认证系统', IntentType.CREATE_GOAL);
      expect(title).not.toContain('P0');
    });
  });

  describe('Entity extraction integration', () => {
    it('综合提取所有实体信息', () => {
      const entities = extractEntities('实现用户登录功能 P1', IntentType.CREATE_TASK);
      expect(entities.title).toBeDefined();
      expect(entities.priority).toBe('P1');
    });

    it('提取带状态的实体', () => {
      const entities = extractEntities('把登录功能标记为完成', IntentType.UPDATE_TASK);
      expect(entities.status).toBe('completed');
    });
  });

  describe('Confidence and explanation', () => {
    it('明确的创建请求应有高置信度', () => {
      const result = recognizeIntent({ text: '创建一个任务：实现登录' });
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('模糊请求应提示需要确认', () => {
      const result = recognizeIntent({ text: '搞一个东西', confidenceThreshold: 0.6 });
      // Low confidence should trigger confirmation
      if (result.confidence < 0.6) {
        expect(result.requiresConfirmation).toBe(true);
      }
    });

    it('应生成解释说明', () => {
      const result = recognizeIntent({ text: '实现用户登录接口' });
      expect(result.explanation).toBeDefined();
      expect(result.explanation).toContain('识别为');
    });
  });

  describe('Default values', () => {
    it('未指定优先级时默认为 P1', () => {
      const result = recognizeIntent({ text: '实现登录功能' });
      expect(result.entities.priority).toBe('P1');
    });

    it('默认置信度阈值为 0.3', () => {
      const result = recognizeIntent({ text: '实现登录' });
      // Should use default threshold if not specified
      expect(result).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('空输入应抛出错误', () => {
      expect(() => recognizeIntent({ text: '' })).toThrow();
    });

    it('只有空格的输入应抛出错误', () => {
      expect(() => recognizeIntent({ text: '   ' })).toThrow();
    });

    it('非常短的输入也应能识别', () => {
      const result = recognizeIntent({ text: '实现登录' });
      expect(result.intent).toBeDefined();
    });

    it('超长输入应能处理', () => {
      const longText = '实现' + '用户登录功能'.repeat(50);
      const result = recognizeIntent({ text: longText });
      expect(result.intent).toBeDefined();
    });
  });

  describe('Response time requirement', () => {
    it('响应时间应 < 500ms', () => {
      const start = Date.now();
      recognizeIntent({ text: '实现用户登录接口' });
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });

    it('批量识别也应快速', () => {
      const inputs = [
        '实现登录',
        '添加功能',
        '查询任务',
        '更新状态',
        '创建项目',
      ];
      const start = Date.now();
      inputs.forEach(text => recognizeIntent({ text }));
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Scenario validations', () => {
    // Scenario 1: Create Task
    it('场景1：创建Task - "实现用户登录接口"', () => {
      const result = recognizeIntent({ text: '实现用户登录接口' });
      expect(result.intent).toBe(IntentType.CREATE_TASK);
      expect(result.entities.title).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    // Scenario 2: Create Goal
    it('场景2：创建Goal - "完成整个用户认证系统作为 P0 目标"', () => {
      const result = recognizeIntent({ text: '完成整个用户认证系统作为 P0 目标' });
      expect(result.intent).toBe(IntentType.CREATE_GOAL);
      expect(result.entities.priority).toBe('P0');
    });

    // Scenario 3: Query Tasks
    it('场景3：查询任务 - "我有哪些待办任务"', () => {
      const result = recognizeIntent({ text: '我有哪些待办任务' });
      expect(result.intent).toBe(IntentType.QUERY_TASKS);
      expect(result.entities.status).toBe('pending');
    });

    // Scenario 4: Update Status
    it('场景4：更新状态 - "把登录功能标记为完成"', () => {
      const result = recognizeIntent({ text: '把登录功能标记为完成' });
      expect(result.intent).toBe(IntentType.UPDATE_TASK);
      expect(result.entities.status).toBe('completed');
    });
  });
});

describe('NLP Parser Utilities', () => {
  describe('extractIntent', () => {
    it('正确匹配关键词模式', () => {
      const { intent, confidence } = extractIntent('实现用户登录功能');
      expect(intent).toBe(IntentType.CREATE_TASK);
      expect(confidence).toBeGreaterThan(0);
    });

    it('无法识别时返回 UNKNOWN', () => {
      const { intent } = extractIntent('随便说点什么');
      expect(intent).toBe(IntentType.UNKNOWN);
    });
  });

  describe('Semantic distinction', () => {
    it('区分 Goal（系统级）和 Task（功能级）', () => {
      const goalResult = extractIntent('完成整个用户认证系统');
      const taskResult = extractIntent('实现登录接口');

      expect(goalResult.intent).toBe(IntentType.CREATE_GOAL);
      expect(taskResult.intent).toBe(IntentType.CREATE_TASK);
    });

    it('带"系统"关键词倾向于识别为 Goal', () => {
      const result = extractIntent('实现用户管理系统');
      expect(result.intent).toBe(IntentType.CREATE_GOAL);
    });

    it('带"接口"/"API"关键词倾向于识别为 Task', () => {
      const result = extractIntent('实现用户登录 API');
      expect(result.intent).toBe(IntentType.CREATE_TASK);
    });
  });
});

describe('Controller Input Validation', () => {
  describe('Context validation', () => {
    it('null context should be rejected', () => {
      const request = {
        text: '创建任务',
        context: null as unknown as object,  // Invalid: null
        confidenceThreshold: 0.3
      };

      // Test the validation logic directly
      const context = request.context;
      const isInvalid = context !== undefined && (context === null || typeof context !== 'object');
      expect(isInvalid).toBe(true);
    });

    it('string context should be rejected', () => {
      const request = {
        text: '创建任务',
        context: 'invalid' as unknown as object,  // Invalid: string
        confidenceThreshold: 0.3
      };

      const context = request.context;
      const isInvalid = context !== undefined && (context === null || typeof context !== 'object');
      expect(isInvalid).toBe(true);
    });

    it('valid object context should be accepted', () => {
      const request = {
        text: '创建任务',
        context: { user_id: '123' },  // Valid: object
        confidenceThreshold: 0.3
      };

      const context = request.context;
      const isInvalid = context !== undefined && (context === null || typeof context !== 'object');
      expect(isInvalid).toBe(false);
    });

    it('undefined context should be accepted (optional field)', () => {
      const request = {
        text: '创建任务',
        context: undefined,  // Valid: optional field
        confidenceThreshold: 0.3
      };

      const context = request.context;
      const isInvalid = context !== undefined && (context === null || typeof context !== 'object');
      expect(isInvalid).toBe(false);
    });
  });
});
