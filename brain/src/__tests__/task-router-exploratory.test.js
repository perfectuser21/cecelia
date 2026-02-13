/**
 * Test: task-router.js exploratory type support
 */

import { describe, it, expect } from 'vitest';
import {
  getTaskLocation,
  isValidTaskType,
  routeTaskCreate,
  LOCATION_MAP
} from '../task-router.js';

describe('task-router exploratory support', () => {
  describe('LOCATION_MAP', () => {
    it('should include exploratory type routing to US', () => {
      expect(LOCATION_MAP).toHaveProperty('exploratory');
      expect(LOCATION_MAP.exploratory).toBe('us');
    });
  });

  describe('getTaskLocation', () => {
    it('should return "us" for exploratory task type', () => {
      const location = getTaskLocation('exploratory');
      expect(location).toBe('us');
    });

    it('should handle case-insensitive exploratory type', () => {
      expect(getTaskLocation('EXPLORATORY')).toBe('us');
      expect(getTaskLocation('Exploratory')).toBe('us');
    });
  });

  describe('isValidTaskType', () => {
    it('should validate exploratory as valid task type', () => {
      expect(isValidTaskType('exploratory')).toBe(true);
    });

    it('should validate exploratory case-insensitively', () => {
      expect(isValidTaskType('EXPLORATORY')).toBe(true);
      expect(isValidTaskType('Exploratory')).toBe(true);
    });
  });

  describe('routeTaskCreate', () => {
    it('should route exploratory task to US location', () => {
      const routing = routeTaskCreate({
        title: 'Test exploratory task',
        task_type: 'exploratory'
      });

      expect(routing).toHaveProperty('location', 'us');
      expect(routing).toHaveProperty('task_type', 'exploratory');
      expect(routing.routing_reason).toContain('location=us');
    });

    it('should determine execution_mode for exploratory task', () => {
      const routing = routeTaskCreate({
        title: 'Exploratory validation',
        task_type: 'exploratory'
      });

      expect(routing).toHaveProperty('execution_mode');
      expect(['single', 'feature_task', 'recurring']).toContain(routing.execution_mode);
    });
  });
});
