/**
 * task-router-failover.test.js
 * Validates routing failure detection and fallback strategies
 */

import { describe, it, expect } from 'vitest';
import {
  routeTaskWithFallback,
  detectRoutingFailure,
  getFallbackStrategy,
  SKILL_WHITELIST,
  FALLBACK_STRATEGIES,
  VALID_TASK_TYPES
} from '../task-router.js';

describe('routing failure detection', () => {
  it('detectRoutingFailure - valid routing returns no failure', () => {
    const routing = {
      task_type: 'dev',
      location: 'us',
      skill: '/dev'
    };
    const result = detectRoutingFailure(routing);
    expect(result.failed).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('detectRoutingFailure - invalid task_type returns failure', () => {
    const routing = {
      task_type: 'invalid_type',
      location: 'us',
      skill: '/dev'
    };
    const result = detectRoutingFailure(routing);
    expect(result.failed).toBe(true);
    expect(result.reason).toBe('invalid_task_type:invalid_type');
  });

  it('detectRoutingFailure - invalid location returns failure', () => {
    const routing = {
      task_type: 'dev',
      location: 'invalid_loc',
      skill: '/dev'
    };
    const result = detectRoutingFailure(routing);
    expect(result.failed).toBe(true);
    expect(result.reason).toBe('invalid_location:invalid_loc');
  });

  it('detectRoutingFailure - invalid skill returns failure', () => {
    const routing = {
      task_type: 'dev',
      location: 'us',
      skill: '/invalid-skill'
    };
    const result = detectRoutingFailure(routing);
    expect(result.failed).toBe(true);
    expect(result.reason).toBe('invalid_skill:/invalid-skill');
  });
});

describe('fallback strategies', () => {
  it('getFallbackStrategy - skill fallback exists', () => {
    const result = getFallbackStrategy('skill', 'dev');
    expect(result).not.toBeNull();
    expect(result.strategy).toBe('skill_fallback');
    expect(result.fallbackValue).toBe('talk');
  });

  it('getFallbackStrategy - location fallback exists', () => {
    const result = getFallbackStrategy('location', 'us');
    expect(result).not.toBeNull();
    expect(result.strategy).toBe('location_fallback');
    expect(result.fallbackValue).toBe('hk');
  });

  it('getFallbackStrategy - no fallback for unknown type', () => {
    const result = getFallbackStrategy('unknown', 'value');
    expect(result).toBeNull();
  });
});

describe('routeTaskWithFallback - success scenarios', () => {
  it('valid dev task returns success status', () => {
    const result = routeTaskWithFallback({
      title: '修复一个 bug',
      task_type: 'dev'
    });

    expect(result.routing_status).toBe('success');
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/dev');
    expect(result.failure_reason).toBeNull();
    expect(result.fallback_strategy).toBeNull();
  });

  it('valid talk task returns success status', () => {
    const result = routeTaskWithFallback({
      title: '和用户对话',
      task_type: 'talk'
    });

    expect(result.routing_status).toBe('success');
    expect(result.location).toBe('hk');
    expect(result.skill).toBe('/cecelia');
  });
});

describe('routeTaskWithFallback - fallback scenarios', () => {
  it('invalid task_type uses default fallback', () => {
    const result = routeTaskWithFallback({
      title: 'some task',
      task_type: 'unknown_type'
    });

    // Should fallback to default
    expect(result.routing_status).toBe('failed');
    expect(result.failure_reason).toBe('invalid_task_type:unknown_type');
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/dev');
  });

  it('default task_type uses dev skill', () => {
    const result = routeTaskWithFallback({
      title: 'some task'
    });

    expect(result.routing_status).toBe('success');
    expect(result.task_type).toBe('dev');
    expect(result.skill).toBe('/dev');
  });
});

describe('SKILL_WHITELIST', () => {
  it('contains all VALID_TASK_TYPES', () => {
    for (const taskType of VALID_TASK_TYPES) {
      expect(SKILL_WHITELIST[taskType]).toBeDefined();
    }
  });
});

describe('FALLBACK_STRATEGIES', () => {
  it('has skill fallback configured', () => {
    expect(FALLBACK_STRATEGIES.skill).toBeDefined();
    expect(FALLBACK_STRATEGIES.skill.dev).toBe('talk');
  });

  it('has location fallback configured', () => {
    expect(FALLBACK_STRATEGIES.location).toBeDefined();
    expect(FALLBACK_STRATEGIES.location.us).toBe('hk');
  });
});
