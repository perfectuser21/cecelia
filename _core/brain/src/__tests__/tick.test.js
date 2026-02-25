/**
 * Tick Tests
 * Tests for task routing and tick functionality
 */

import { describe, it, expect } from 'vitest';
import { routeTask, TASK_TYPE_AGENT_MAP } from '../tick.js';

describe('routeTask', () => {
  it('should route dev tasks to /dev', () => {
    const task = { task_type: 'dev' };
    expect(routeTask(task)).toBe('/dev');
  });

  it('should route talk tasks to /talk', () => {
    const task = { task_type: 'talk' };
    expect(routeTask(task)).toBe('/talk');
  });

  it('should route qa tasks to /qa', () => {
    const task = { task_type: 'qa' };
    expect(routeTask(task)).toBe('/qa');
  });

  it('should route audit tasks to /audit', () => {
    const task = { task_type: 'audit' };
    expect(routeTask(task)).toBe('/audit');
  });

  it('should return null for research tasks (requires manual handling)', () => {
    const task = { task_type: 'research' };
    expect(routeTask(task)).toBeNull();
  });

  it('should default to /dev when task_type is missing', () => {
    const task = {};
    expect(routeTask(task)).toBe('/dev');
  });

  it('should default to /dev for unknown task_type', () => {
    const task = { task_type: 'unknown_type' };
    expect(routeTask(task)).toBe('/dev');
  });
});

describe('TASK_TYPE_AGENT_MAP', () => {
  it('should have all expected task types', () => {
    expect(TASK_TYPE_AGENT_MAP).toHaveProperty('dev');
    expect(TASK_TYPE_AGENT_MAP).toHaveProperty('talk');
    expect(TASK_TYPE_AGENT_MAP).toHaveProperty('qa');
    expect(TASK_TYPE_AGENT_MAP).toHaveProperty('audit');
    expect(TASK_TYPE_AGENT_MAP).toHaveProperty('research');
  });

  it('should map to correct agent skills', () => {
    expect(TASK_TYPE_AGENT_MAP.dev).toBe('/dev');
    expect(TASK_TYPE_AGENT_MAP.talk).toBe('/talk');
    expect(TASK_TYPE_AGENT_MAP.qa).toBe('/qa');
    expect(TASK_TYPE_AGENT_MAP.audit).toBe('/audit');
    expect(TASK_TYPE_AGENT_MAP.research).toBeNull();
  });
});
