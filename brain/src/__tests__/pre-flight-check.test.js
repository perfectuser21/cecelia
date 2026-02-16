/**
 * Pre-flight Check Tests
 * Tests for task quality validation before dispatch
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { preFlightCheck, getPreFlightStats } from '../pre-flight-check.js';

describe('preFlightCheck', () => {
  describe('title validation', () => {
    it('should fail for empty title', async () => {
      const task = { title: '', description: 'Valid description', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task title is empty');
    });

    it('should fail for short title (< 5 characters)', async () => {
      const task = { title: 'test', description: 'Valid description', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task title too short (< 5 characters)');
    });

    it('should pass for valid title', async () => {
      const task = { title: 'Implement feature X', description: 'Valid description with enough characters', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('description validation', () => {
    it('should fail for empty description', async () => {
      const task = { title: 'Valid Title', description: '', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task description is empty');
    });

    it('should fail for short description (< 20 characters)', async () => {
      const task = { title: 'Valid Title', description: 'short', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Task description too short (< 20 characters)');
    });

    it('should fail for placeholder text', async () => {
      const task = { title: 'Valid Title', description: 'TODO: Add description later', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Description contains placeholder text');
    });

    it('should fail for generic descriptions', async () => {
      const task = { title: 'Valid Title', description: 'test', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Description is too generic');
    });

    it('should pass for valid description', async () => {
      const task = {
        title: 'Implement feature X',
        description: 'Add user authentication feature with JWT tokens',
        priority: 'P1'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('priority validation', () => {
    it('should fail for missing priority', async () => {
      const task = { title: 'Valid Title', description: 'Valid description' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Invalid priority: undefined');
    });

    it('should fail for invalid priority', async () => {
      const task = { title: 'Valid Title', description: 'Valid description', priority: 'P5' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Invalid priority: P5');
    });

    it('should pass for valid priority P0', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P0' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });

    it('should pass for valid priority P1', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });

    it('should pass for valid priority P2', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P2' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('skill validation', () => {
    it('should fail for unknown skill', async () => {
      const task = {
        title: 'Valid Title',
        description: 'Valid description',
        priority: 'P1',
        skill: '/unknown'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Unknown skill: /unknown');
    });

    it('should pass for valid skill /dev', async () => {
      const task = {
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        priority: 'P1',
        skill: '/dev'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });

    it('should pass when skill is not specified', async () => {
      const task = { title: 'Valid Title', description: 'Valid description with enough characters', priority: 'P1' };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
    });
  });

  describe('comprehensive validation', () => {
    it('should return multiple issues for invalid task', async () => {
      const task = {
        title: 'bad',
        description: 'x',
        priority: 'invalid'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(1);
      expect(result.suggestions.length).toBeGreaterThan(1);
    });

    it('should pass for fully valid task', async () => {
      const task = {
        title: 'Implement user authentication',
        description: 'Add JWT-based authentication with refresh tokens and secure session management',
        priority: 'P1',
        skill: '/dev'
      };
      const result = await preFlightCheck(task);
      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.suggestions).toEqual([]);
    });
  });
});

describe('getPreFlightStats', () => {
  it('should return stats structure', async () => {
    // Mock pool for testing
    const mockPool = {
      query: async () => ({
        rows: [{
          failed_count: '5',
          passed_count: '95',
          all_issues: null
        }]
      })
    };

    const stats = await getPreFlightStats(mockPool);
    expect(stats).toHaveProperty('totalChecked');
    expect(stats).toHaveProperty('passed');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('passRate');
    expect(stats).toHaveProperty('issueDistribution');
  });

  it('should calculate pass rate correctly', async () => {
    const mockPool = {
      query: async () => ({
        rows: [{
          failed_count: '20',
          passed_count: '80',
          all_issues: null
        }]
      })
    };

    const stats = await getPreFlightStats(mockPool);
    expect(stats.totalChecked).toBe(100);
    expect(stats.passed).toBe(80);
    expect(stats.failed).toBe(20);
    expect(stats.passRate).toBe('80.00%');
  });

  it('should handle zero checks gracefully', async () => {
    const mockPool = {
      query: async () => ({
        rows: [{
          failed_count: '0',
          passed_count: '0',
          all_issues: null
        }]
      })
    };

    const stats = await getPreFlightStats(mockPool);
    expect(stats.totalChecked).toBe(0);
    expect(stats.passRate).toBe('0%');
  });
});
