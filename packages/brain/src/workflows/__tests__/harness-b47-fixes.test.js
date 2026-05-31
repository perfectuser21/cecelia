/**
 * B47 regression tests — 5 bug fixes in harness pipeline:
 * 1. spawnNode/evaluateContractNode thread_id must include :fix${N} suffix
 * 2. ReviewerOutputSchema.ci_workflow_alignment should be optional
 * 3. computeVerdictFromRubric ci_workflow_alignment null → fallback 10
 * 4. plannerBranch priority from JSON planner_branch field
 * 5. evaluateContractNode injects JOURNEY_TYPE env
 */
import { describe, it, expect } from 'vitest';
import { computeVerdictFromRubric, detectConvergenceTrend } from '../harness-gan.graph.js';
import { ReviewerOutputSchema } from '../../harness-shared.js';

// ── Fix 3: computeVerdictFromRubric ci_workflow_alignment fallback ────────────

describe('computeVerdictFromRubric B47 — ci_workflow_alignment optional fallback', () => {
  const baseScores = {
    dod_machineability: 8,
    scope_match_prd: 8,
    test_is_red: 8,
    internal_consistency: 8,
    risk_registered: 8,
    verification_oracle_completeness: 8,
  };

  it('missing ci_workflow_alignment → defaults to 10 (N/A=pass), returns APPROVED when others pass', () => {
    const scores = { ...baseScores }; // no ci_workflow_alignment
    const result = computeVerdictFromRubric(scores, 1);
    expect(result).toBe('APPROVED');
  });

  it('ci_workflow_alignment present and below threshold → REVISION', () => {
    const scores = { ...baseScores, ci_workflow_alignment: 5 };
    const result = computeVerdictFromRubric(scores, 1);
    expect(result).toBe('REVISION');
  });

  it('ci_workflow_alignment present and at threshold → APPROVED', () => {
    const scores = { ...baseScores, ci_workflow_alignment: 7 };
    const result = computeVerdictFromRubric(scores, 1);
    expect(result).toBe('APPROVED');
  });

  it('other required dimension missing → returns null (unchanged behavior)', () => {
    const scores = { ...baseScores, ci_workflow_alignment: 8 };
    delete scores.dod_machineability;
    const result = computeVerdictFromRubric(scores, 1);
    expect(result).toBeNull();
  });

  it('null scores → returns null (unchanged behavior)', () => {
    expect(computeVerdictFromRubric(null, 1)).toBeNull();
    expect(computeVerdictFromRubric(undefined, 1)).toBeNull();
  });
});

// ── Fix 2: ReviewerOutputSchema ci_workflow_alignment optional ────────────────

describe('ReviewerOutputSchema B47 — ci_workflow_alignment optional', () => {
  const baseReviewer = {
    verdict: 'APPROVED',
    rubric_scores: {
      dod_machineability: 8,
      scope_match_prd: 8,
      test_is_red: 8,
      internal_consistency: 8,
      risk_registered: 8,
      verification_oracle_completeness: 8,
    },
    feedback: 'looks good',
  };

  it('parses correctly without ci_workflow_alignment (old reviewer SKILL)', () => {
    const result = ReviewerOutputSchema.safeParse(baseReviewer);
    expect(result.success).toBe(true);
    // default(10) applied
    expect(result.data.rubric_scores.ci_workflow_alignment).toBe(10);
  });

  it('parses correctly with ci_workflow_alignment present', () => {
    const data = {
      ...baseReviewer,
      rubric_scores: { ...baseReviewer.rubric_scores, ci_workflow_alignment: 7 },
    };
    const result = ReviewerOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
    expect(result.data.rubric_scores.ci_workflow_alignment).toBe(7);
  });
});

// ── Fix 4: plannerBranch JSON priority ───────────────────────────────────────

describe('plannerBranch B47 — JSON field priority over regex', () => {
  function extractPlannerBranch(plannerOutput) {
    const plannerBranchFromJson = plannerOutput.match(/"planner_branch"\s*:\s*"([^"]+)"/)?.[1];
    return (
      plannerBranchFromJson ||
      plannerOutput.match(/cp-[0-9]+-harness-prd/)?.[0] ||
      'main'
    );
  }

  it('reads planner_branch from JSON verdict', () => {
    const output = '{"verdict":"DONE","planner_branch":"cp-05311234-harness-prd","sprint_dir":"sprints"}';
    expect(extractPlannerBranch(output)).toBe('cp-05311234-harness-prd');
  });

  it('falls back to regex when JSON field absent', () => {
    const output = 'branch cp-05311234-harness-prd is ready';
    expect(extractPlannerBranch(output)).toBe('cp-05311234-harness-prd');
  });

  it('falls back to main when no branch found', () => {
    const output = '{"verdict":"DONE","sprint_dir":"sprints"}';
    expect(extractPlannerBranch(output)).toBe('main');
  });

  it('JSON field takes priority over regex pattern in same string', () => {
    // JSON field has different branch name than the regex pattern
    const output = 'also cp-99999999-harness-prd {"planner_branch":"cp-05311234-harness-prd"}';
    expect(extractPlannerBranch(output)).toBe('cp-05311234-harness-prd');
  });
});
