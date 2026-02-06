/**
 * Feature Tick Tests
 * Tests for Feature Tick system, task routing, and anti-crossing
 */

import { describe, it, expect } from 'vitest';
import { FEATURE_STATUS, FEATURE_TICK_INTERVAL_MS } from '../feature-tick.js';
import {
  identifyWorkType, getTaskLocation, determineExecutionMode, routeTaskCreate,
  isValidTaskType, isValidLocation, getValidTaskTypes, LOCATION_MAP
} from '../task-router.js';

// ==================== Feature Status Tests ====================

describe('FEATURE_STATUS', () => {
  it('should have all expected status values', () => {
    expect(FEATURE_STATUS.PLANNING).toBe('planning');
    expect(FEATURE_STATUS.TASK_CREATED).toBe('task_created');
    expect(FEATURE_STATUS.TASK_RUNNING).toBe('task_running');
    expect(FEATURE_STATUS.TASK_COMPLETED).toBe('task_completed');
    expect(FEATURE_STATUS.EVALUATING).toBe('evaluating');
    expect(FEATURE_STATUS.COMPLETED).toBe('completed');
    expect(FEATURE_STATUS.CANCELLED).toBe('cancelled');
  });

  it('should have 7 status values', () => {
    expect(Object.keys(FEATURE_STATUS)).toHaveLength(7);
  });
});

describe('FEATURE_TICK_INTERVAL_MS', () => {
  it('should be a positive number', () => {
    expect(FEATURE_TICK_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('should be 30 seconds by default', () => {
    expect(FEATURE_TICK_INTERVAL_MS).toBe(30000);
  });
});

// ==================== Work Type Identification Tests ====================

describe('identifyWorkType', () => {
  it('should identify single task patterns', () => {
    expect(identifyWorkType('修复登录 bug')).toBe('single');
    expect(identifyWorkType('fix the login issue')).toBe('single');
    expect(identifyWorkType('改一下配置文件')).toBe('single');
    expect(identifyWorkType('加个日志打印')).toBe('single');
    expect(identifyWorkType('删掉无用代码')).toBe('single');
    expect(identifyWorkType('更新依赖版本')).toBe('single');
    expect(identifyWorkType('调整样式')).toBe('single');
  });

  it('should identify feature patterns', () => {
    expect(identifyWorkType('实现用户登录功能')).toBe('feature');
    expect(identifyWorkType('做一个新的 Dashboard')).toBe('feature');
    expect(identifyWorkType('新功能：数据导出')).toBe('feature');
    expect(identifyWorkType('构建监控系统')).toBe('feature');
    expect(identifyWorkType('重构用户模块')).toBe('feature');
    expect(identifyWorkType('implement user authentication')).toBe('feature');
  });

  it('should return ask_autumnrice for ambiguous input', () => {
    expect(identifyWorkType('看看这个代码')).toBe('ask_autumnrice');
    expect(identifyWorkType('帮我处理一下')).toBe('ask_autumnrice');
    expect(identifyWorkType('')).toBe('ask_autumnrice');
    expect(identifyWorkType(null)).toBe('ask_autumnrice');
  });
});

// ==================== Task Location Tests ====================

describe('getTaskLocation', () => {
  it('should route dev tasks to US', () => {
    expect(getTaskLocation('dev')).toBe('us');
  });

  it('should route review tasks to US', () => {
    expect(getTaskLocation('review')).toBe('us');
  });

  it('should route talk tasks to HK', () => {
    expect(getTaskLocation('talk')).toBe('hk');
  });

  it('should route data tasks to HK', () => {
    expect(getTaskLocation('data')).toBe('hk');
  });

  it('should route qa tasks to US', () => {
    expect(getTaskLocation('qa')).toBe('us');
  });

  it('should route audit tasks to US', () => {
    expect(getTaskLocation('audit')).toBe('us');
  });

  it('should route research tasks to HK', () => {
    expect(getTaskLocation('research')).toBe('hk');
  });

  it('should default to US for unknown task types', () => {
    expect(getTaskLocation('unknown')).toBe('us');
    expect(getTaskLocation(null)).toBe('us');
    expect(getTaskLocation(undefined)).toBe('us');
  });
});

describe('LOCATION_MAP', () => {
  it('should have correct mappings', () => {
    expect(LOCATION_MAP.dev).toBe('us');
    expect(LOCATION_MAP.review).toBe('us');
    expect(LOCATION_MAP.talk).toBe('hk');
    expect(LOCATION_MAP.data).toBe('hk');
    expect(LOCATION_MAP.qa).toBe('us');
    expect(LOCATION_MAP.audit).toBe('us');
    expect(LOCATION_MAP.research).toBe('hk');
  });
});

// ==================== Execution Mode Tests ====================

describe('determineExecutionMode', () => {
  it('should return recurring for recurring tasks', () => {
    expect(determineExecutionMode({ input: 'test', is_recurring: true })).toBe('recurring');
  });

  it('should return feature_task when feature_id is provided', () => {
    expect(determineExecutionMode({ input: 'test', feature_id: 'uuid-123' })).toBe('feature_task');
  });

  it('should return single for single task patterns', () => {
    expect(determineExecutionMode({ input: '修复 bug' })).toBe('single');
  });

  it('should default to single for feature patterns without feature_id', () => {
    expect(determineExecutionMode({ input: '实现新功能' })).toBe('single');
  });
});

// ==================== Route Task Create Tests ====================

describe('routeTaskCreate', () => {
  it('should return correct routing for dev task', () => {
    const result = routeTaskCreate({ title: 'test', task_type: 'dev' });
    expect(result.location).toBe('us');
    expect(result.execution_mode).toBe('single');
    expect(result.task_type).toBe('dev');
  });

  it('should return correct routing for talk task', () => {
    const result = routeTaskCreate({ title: 'test', task_type: 'talk' });
    expect(result.location).toBe('hk');
    expect(result.execution_mode).toBe('single');
  });

  it('should return feature_task mode when feature_id provided', () => {
    const result = routeTaskCreate({ title: 'test', task_type: 'dev', feature_id: 'uuid' });
    expect(result.execution_mode).toBe('feature_task');
  });

  it('should return recurring mode when is_recurring is true', () => {
    const result = routeTaskCreate({ title: 'test', task_type: 'dev', is_recurring: true });
    expect(result.execution_mode).toBe('recurring');
  });

  it('should include routing reason', () => {
    const result = routeTaskCreate({ title: 'test', task_type: 'dev' });
    expect(result.routing_reason).toContain('task_type=dev');
    expect(result.routing_reason).toContain('location=us');
  });
});

// ==================== Validation Tests ====================

describe('isValidTaskType', () => {
  it('should return true for valid task types', () => {
    expect(isValidTaskType('dev')).toBe(true);
    expect(isValidTaskType('review')).toBe(true);
    expect(isValidTaskType('talk')).toBe(true);
    expect(isValidTaskType('data')).toBe(true);
    expect(isValidTaskType('qa')).toBe(true);
    expect(isValidTaskType('audit')).toBe(true);
    expect(isValidTaskType('research')).toBe(true);
  });

  it('should return false for invalid task types', () => {
    expect(isValidTaskType('invalid')).toBe(false);
    expect(isValidTaskType('')).toBe(false);
    expect(isValidTaskType(null)).toBe(false);
  });
});

describe('isValidLocation', () => {
  it('should return true for valid locations', () => {
    expect(isValidLocation('us')).toBe(true);
    expect(isValidLocation('hk')).toBe(true);
  });

  it('should return false for invalid locations', () => {
    expect(isValidLocation('uk')).toBe(false);
    expect(isValidLocation('')).toBe(false);
    expect(isValidLocation(null)).toBe(false);
  });
});

describe('getValidTaskTypes', () => {
  it('should return all valid task types', () => {
    const types = getValidTaskTypes();
    expect(types).toContain('dev');
    expect(types).toContain('review');
    expect(types).toContain('talk');
    expect(types).toContain('data');
    expect(types).toContain('qa');
    expect(types).toContain('audit');
    expect(types).toContain('research');
  });
});
