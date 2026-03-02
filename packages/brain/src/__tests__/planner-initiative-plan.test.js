/**
 * Planner Initiative Plan Tests
 * Tests for the enhanced Planner that detects "KR with active Initiative but no Task"
 * and auto-generates initiative_plan tasks.
 */

import { describe, it, expect } from 'vitest';
import { scoreKRs } from '../planner.js';

// ============================================================
// scoreKRs - Initiative bonus
// ============================================================

describe('scoreKRs - initiative bonus', () => {
  it('should give +15 bonus to KR with active initiative but no queued task', () => {
    const krWithInitiative = { id: 'kr-1', priority: 'P1', progress: 50 };
    const krWithoutInitiative = { id: 'kr-2', priority: 'P1', progress: 50 };

    const state = {
      keyResults: [krWithInitiative, krWithoutInitiative],
      activeTasks: [], // no queued tasks
      focus: null,
      initiativeKRIds: new Set(['kr-1']) // kr-1 has active initiative
    };

    const scored = scoreKRs(state);
    const score1 = scored.find(s => s.kr.id === 'kr-1').score;
    const score2 = scored.find(s => s.kr.id === 'kr-2').score;

    // kr-1 should have +15 bonus over kr-2
    expect(score1 - score2).toBe(15);
    // kr-1 should be ranked first
    expect(scored[0].kr.id).toBe('kr-1');
  });

  it('should NOT give initiative bonus to KR that already has queued tasks', () => {
    const kr = { id: 'kr-1', priority: 'P1', progress: 50 };

    const stateWithQueued = {
      keyResults: [kr],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-1', project_id: 'proj-1' }
      ],
      focus: null,
      initiativeKRIds: new Set(['kr-1']) // kr-1 has initiative
    };

    const stateWithoutQueued = {
      keyResults: [{ ...kr }],
      activeTasks: [],
      focus: null,
      initiativeKRIds: new Set() // no initiative
    };

    const scoredWithQueued = scoreKRs(stateWithQueued);
    const scoredWithoutQueued = scoreKRs(stateWithoutQueued);

    const scoreWithQueued = scoredWithQueued[0].score;
    const scoreWithoutQueued = scoredWithoutQueued[0].score;

    // When has queued task: gets +15 from queuedByGoal, NOT from initiative bonus
    // When no queued task and no initiative: gets +0
    // Both cases should give same +15 boost (not double-counted)
    expect(scoreWithQueued).toBe(scoreWithoutQueued + 15);
  });

  it('should work correctly when initiativeKRIds is not provided (backward compat)', () => {
    const state = {
      keyResults: [
        { id: 'kr-1', priority: 'P1', progress: 0 }
      ],
      activeTasks: [],
      focus: null
      // no initiativeKRIds field
    };

    // Should not throw
    const scored = scoreKRs(state);
    expect(scored).toHaveLength(1);
    expect(scored[0].kr.id).toBe('kr-1');
  });

  it('should rank KR with initiative higher than same-priority KR without initiative', () => {
    const state = {
      keyResults: [
        { id: 'kr-no-init', priority: 'P1', progress: 0 },
        { id: 'kr-has-init', priority: 'P1', progress: 0 }
      ],
      activeTasks: [],
      focus: null,
      initiativeKRIds: new Set(['kr-has-init'])
    };

    const scored = scoreKRs(state);
    // kr-has-init should rank first
    expect(scored[0].kr.id).toBe('kr-has-init');
    // Score difference should be exactly 15
    const scoreHasInit = scored.find(s => s.kr.id === 'kr-has-init').score;
    const scoreNoInit = scored.find(s => s.kr.id === 'kr-no-init').score;
    expect(scoreHasInit - scoreNoInit).toBe(15);
  });

  it('should not apply initiative bonus if KR has both queued task AND is in initiativeKRIds', () => {
    // initiativeKRIds is built from DB query that already excludes KRs with queued tasks
    // But just in case both conditions are true, initiative bonus should NOT stack with queued bonus
    const state = {
      keyResults: [
        { id: 'kr-both', priority: 'P1', progress: 0 },
        { id: 'kr-init-only', priority: 'P1', progress: 0 },
        { id: 'kr-queue-only', priority: 'P1', progress: 0 }
      ],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-both', project_id: 'proj-1' },
        { id: 't-2', status: 'queued', goal_id: 'kr-queue-only', project_id: 'proj-2' }
      ],
      focus: null,
      initiativeKRIds: new Set(['kr-both', 'kr-init-only'])
    };

    const scored = scoreKRs(state);
    const scoreBoth = scored.find(s => s.kr.id === 'kr-both').score;
    const scoreInitOnly = scored.find(s => s.kr.id === 'kr-init-only').score;
    const scoreQueueOnly = scored.find(s => s.kr.id === 'kr-queue-only').score;

    // kr-both: has queued task → +15 (from queuedByGoal), but NOT initiative bonus (has queued task)
    // kr-init-only: no queued task + in initiativeKRIds → +15 (from initiative bonus)
    // kr-queue-only: has queued task → +15 (from queuedByGoal)
    expect(scoreBoth).toBe(scoreQueueOnly); // both have queued task, same +15
    expect(scoreInitOnly).toBe(scoreQueueOnly); // initiative bonus equals queued bonus
  });
});
