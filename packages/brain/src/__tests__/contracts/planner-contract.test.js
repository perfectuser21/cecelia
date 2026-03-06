/**
 * Contract Test: planner.js
 *
 * Guards the interface contract of planner functions.
 * Tests pure exported functions; DB-dependent functions tested via shape validation.
 */
import { describe, it, expect } from 'vitest';
import {
  applyContentAwareScore,
  selectTopAreas,
  selectActiveInitiativeForArea,
} from '../../planner.js';

describe('planner contract', () => {
  describe('applyContentAwareScore', () => {
    it('returns an array', () => {
      const result = applyContentAwareScore([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('preserves all input tasks', () => {
      const tasks = [
        { id: '1', payload: {} },
        { id: '2', payload: { decomposition_mode: 'known' } },
      ];
      const result = applyContentAwareScore(tasks);
      expect(result).toHaveLength(2);
    });

    it('adds _content_score_bonus to each task', () => {
      const tasks = [{ id: '1', payload: {} }];
      const result = applyContentAwareScore(tasks);
      expect(result[0]).toHaveProperty('_content_score_bonus');
      expect(typeof result[0]._content_score_bonus).toBe('number');
    });

    it('gives bonus to known decomposition tasks', () => {
      const tasks = [
        { id: '1', payload: {} },
        { id: '2', payload: { decomposition_mode: 'known' } },
      ];
      const result = applyContentAwareScore(tasks);
      expect(result[1]._content_score_bonus).toBeGreaterThan(result[0]._content_score_bonus);
    });

    it('handles tasks without payload', () => {
      const tasks = [{ id: '1' }];
      const result = applyContentAwareScore(tasks);
      expect(result[0]._content_score_bonus).toBe(0);
    });
  });

  describe('selectTopAreas', () => {
    it('returns array for valid state', () => {
      const state = {
        objectives: [],
        keyResults: [],
        activeTasks: [],
      };
      const result = selectTopAreas(state, 3);
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty for no active areas', () => {
      const state = {
        objectives: [{ id: '1', type: 'area_okr', status: 'completed' }],
        keyResults: [],
        activeTasks: [],
      };
      expect(selectTopAreas(state, 3)).toHaveLength(0);
    });

    it('returns areas with queued tasks first', () => {
      const state = {
        objectives: [
          { id: 'area-1', type: 'area_okr', status: 'active', priority: 'P0' },
          { id: 'area-2', type: 'area_okr', status: 'active', priority: 'P1' },
        ],
        keyResults: [
          { id: 'kr-1', parent_id: 'area-1', status: 'in_progress' },
        ],
        activeTasks: [
          { id: 't-1', status: 'queued', goal_id: 'kr-1' },
        ],
      };
      const result = selectTopAreas(state, 3);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].id).toBe('area-1');
    });

    it('respects count limit', () => {
      const state = {
        objectives: [
          { id: 'a1', type: 'area_okr', status: 'active', priority: 'P0' },
          { id: 'a2', type: 'area_okr', status: 'active', priority: 'P1' },
          { id: 'a3', type: 'area_okr', status: 'active', priority: 'P2' },
        ],
        keyResults: [
          { id: 'kr1', parent_id: 'a1', status: 'in_progress' },
          { id: 'kr2', parent_id: 'a2', status: 'in_progress' },
          { id: 'kr3', parent_id: 'a3', status: 'in_progress' },
        ],
        activeTasks: [
          { id: 't1', status: 'queued', goal_id: 'kr1' },
          { id: 't2', status: 'queued', goal_id: 'kr2' },
          { id: 't3', status: 'queued', goal_id: 'kr3' },
        ],
      };
      expect(selectTopAreas(state, 1)).toHaveLength(1);
    });
  });

  describe('selectActiveInitiativeForArea', () => {
    it('returns null for area with no matching KRs', () => {
      const area = { id: 'area-1' };
      const state = {
        keyResults: [],
        activeTasks: [],
        projects: [],
      };
      const result = selectActiveInitiativeForArea(area, state);
      expect(result).toBeNull();
    });
  });
});
