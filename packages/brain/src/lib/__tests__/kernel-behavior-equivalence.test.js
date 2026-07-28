import { describe, expect, it } from 'vitest';
import {
  BEHAVIOR_DIMENSIONS,
  GOLDEN_PATH_STEPS,
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
  buildEquivalenceReport,
  buildEvidenceEnvelopes,
  formatEquivalenceMarkdown,
  projectJourneyCells,
  validateBehaviorEquivalence,
} from '../kernel-behavior-equivalence.js';

const NOW = Date.parse('2026-07-28T12:00:00.000Z');
const SHA = '8e034654d196221ddca25a7f032612b526bad031';

function completeProof(provider, scenario) {
  return {
    test_command: `npx vitest run packages/brain/src/orchestrator/__tests__/merge-authority.test.js -t '${provider} ${scenario}'`,
    expected_result: scenario === 'violation' ? 'blocked' : 'pass',
    observed_result: scenario === 'violation' ? 'blocked' : 'pass',
    evidence_refs: [`test:merge-authority:${provider}:${scenario}`],
    effect_receipt_id: `receipt:test:${provider}:${scenario}:${SHA}`,
  };
}

function completeMatrix() {
  return Object.fromEntries(PROOF_PROVIDERS.map((provider) => [
    provider,
    Object.fromEntries(PROOF_SCENARIOS.map((scenario) => [
      scenario,
      completeProof(provider, scenario),
    ])),
  ]));
}

function steps() {
  return GOLDEN_PATH_STEPS.map((id) => ({ id, name: `Step ${id}` }));
}

function provenBehavior(overrides = {}) {
  return {
    behavior_id: 'KERNEL-P0-MERGE-AUTHORITY',
    priority: 'P0',
    owner: 'kernel.merge_authority',
    contract_version: '1.0.0',
    status: 'proven',
    legacy_behavior: 'Claude controller only merged after all gates.',
    legacy_evidence: ['git:legacy/harness-controller/SKILL.md@2.10.0'],
    unified_constructs: ['kernel.merge_authority', 'kernel.merge_effect_receipt'],
    steps: ['S9'],
    dimensions: [...BEHAVIOR_DIMENSIONS],
    assertion_id: 'KERNEL-MERGE-AUTHORITY-01',
    failure_semantics: 'Missing or stale evidence denies merge.',
    freshness: {
      verified_at: '2026-07-28T08:00:00.000Z',
      expires_at: '2026-08-04T08:00:00.000Z',
    },
    proof_identity: {
      artifact_sha: SHA,
      version: '1.268.2',
      effect_receipt_id: `receipt:test:merge-authority:${SHA}`,
    },
    proof_matrix: completeMatrix(),
    ...overrides,
  };
}

function contract(behaviors = [provenBehavior()]) {
  return {
    golden_paths: [{ id: 'KERNEL-MERGE-AUTHORITY-01' }],
    behavior_equivalence: {
      schema_version: '1.0.0',
      contract_version: '2026-07-28.1',
      required_behavior_count: behaviors.length,
      journey: {
        key: 'kernel-harness-delivery',
        steps: steps(),
      },
      dimensions: [...BEHAVIOR_DIMENSIONS],
      behaviors,
    },
  };
}

describe('canonical behavior equivalence axes', () => {
  it('locks S0-S12, eleven dimensions, and the provider/scenario matrix', () => {
    expect(GOLDEN_PATH_STEPS).toEqual(
      Array.from({ length: 13 }, (_, index) => `S${index}`),
    );
    expect(BEHAVIOR_DIMENSIONS).toHaveLength(11);
    expect(PROOF_PROVIDERS).toEqual(['claude', 'codex', 'grok']);
    expect(PROOF_SCENARIOS).toEqual(['normal', 'violation', 'recovery']);
  });
});

describe('validateBehaviorEquivalence', () => {
  it('never treats non-empty receipt strings or unit-test commands as live proof', () => {
    const result = validateBehaviorEquivalence(contract(), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'trusted_receipt_bundle_required' }),
      expect.objectContaining({ code: 'non_live_proof_command' }),
    ]));
  });

  it('rejects a silently truncated behavior inventory', () => {
    const truncated = contract();
    truncated.behavior_equivalence.required_behavior_count = 2;

    const result = validateBehaviorEquivalence(truncated, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'behavior_inventory_count_mismatch',
    }));
  });

  it('accepts only a complete, fresh 3x3 proven contract', () => {
    const result = validateBehaviorEquivalence(contract(), { now: NOW });

    expect(result.valid).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.behaviors[0]).toMatchObject({
      claimed_status: 'proven',
      effective_status: 'proven',
    });
  });

  it.each([
    ['provider scenario', (behavior) => { delete behavior.proof_matrix.grok.recovery; }],
    ['artifact SHA', (behavior) => { delete behavior.proof_identity.artifact_sha; }],
    ['version', (behavior) => { delete behavior.proof_identity.version; }],
    ['effect receipt', (behavior) => { delete behavior.proof_identity.effect_receipt_id; }],
    ['verified_at', (behavior) => { delete behavior.freshness.verified_at; }],
    ['expires_at', (behavior) => { delete behavior.freshness.expires_at; }],
  ])('auto-demotes false proven to gap when %s is missing', (_label, mutate) => {
    const behavior = provenBehavior();
    mutate(behavior);

    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.behaviors[0].claimed_status).toBe('proven');
    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings.some((finding) => finding.behavior_id === behavior.behavior_id)).toBe(true);
  });

  it.each([
    'grep -q merge packages/brain/src/orchestrator/merge-authority.js',
    'rg "merge authorization" README.md',
    'test -f packages/brain/src/orchestrator/merge-authority.js',
    'bash packages/brain/scripts/smoke/kernel-merge-authority-smoke.sh',
  ])('rejects documentation/static/smoke-only pseudo-proof: %s', (testCommand) => {
    const behavior = provenBehavior();
    behavior.proof_matrix.claude.violation.test_command = testCommand;

    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'pseudo_proof_command',
      path: 'proof_matrix.claude.violation.test_command',
    }));
  });

  it('requires violation proof to observe a real denial', () => {
    const behavior = provenBehavior();
    behavior.proof_matrix.codex.violation.observed_result = 'pass';

    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'violation_not_proven_to_fire',
    }));
  });

  it('keeps an explicitly documented gap without manufacturing validation errors', () => {
    const gap = provenBehavior({
      status: 'gap',
      gap: {
        reason: 'No real Grok recovery receipt exists.',
        owner: 'kernel.fleet',
        closure_plan: 'Run the production Grok recovery canary and append its receipt.',
      },
      proof_matrix: {},
      proof_identity: {},
    });

    const result = validateBehaviorEquivalence(contract([gap]), { now: NOW });

    expect(result.valid).toBe(true);
    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.behaviors[0].gap.reason).toContain('Grok');
  });

  it('auto-demotes expired proof and never projects it green', () => {
    const stale = provenBehavior({
      freshness: {
        verified_at: '2026-07-01T00:00:00.000Z',
        expires_at: '2026-07-20T00:00:00.000Z',
      },
    });
    const result = validateBehaviorEquivalence(contract([stale]), { now: NOW });
    const cells = projectJourneyCells(result);

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({ code: 'proof_stale' }));
    expect(cells.every((cell) => cell.cell_status !== 'green')).toBe(true);
    expect(cells.every((cell) => cell.cell_status === 'pending')).toBe(true);
  });

  it('requires intentional replacement rationale and complete replacement proof', () => {
    const replacement = provenBehavior({
      status: 'intentional_replacement',
      replacement: {
        legacy_construct: 'Claude Stop hook',
        unified_construct: 'Kernel Attempt Supervisor',
      },
    });
    const result = validateBehaviorEquivalence(contract([replacement]), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'replacement_rationale_missing',
    }));
  });

  it('finds dangling supersession references and cycles', () => {
    const first = provenBehavior({
      behavior_id: 'B-FIRST',
      superseded_by: 'B-SECOND',
    });
    const second = provenBehavior({
      behavior_id: 'B-SECOND',
      superseded_by: 'B-FIRST',
    });
    const dangling = provenBehavior({
      behavior_id: 'B-DANGLING',
      superseded_by: 'B-MISSING',
    });

    const result = validateBehaviorEquivalence(contract([first, second, dangling]), { now: NOW });

    expect(result.findings).toContainEqual(expect.objectContaining({
      behavior_id: 'B-DANGLING',
      code: 'supersession_target_missing',
    }));
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'supersession_cycle',
    }));
    expect(result.behaviors.every((behavior) => behavior.effective_status === 'gap')).toBe(true);
  });
});

describe('evidence envelope and journey projection', () => {
  it('builds one exact envelope per provider/scenario without inventing missing values', () => {
    const behavior = provenBehavior();
    behavior.proof_matrix.grok.recovery.effect_receipt_id = undefined;
    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });
    const envelopes = buildEvidenceEnvelopes(result);

    expect(envelopes).toHaveLength(9);
    expect(envelopes.find(
      (item) => item.provider === 'grok' && item.scenario === 'recovery',
    )).toMatchObject({
      behavior_id: behavior.behavior_id,
      priority: 'P0',
      artifact_sha: SHA,
      provider: 'grok',
      scenario: 'recovery',
      effect_receipt_id: null,
    });
  });

  it('projects proven evidence into existing journey_step_links cell vocabulary', () => {
    const result = validateBehaviorEquivalence(contract(), { now: NOW });
    const cells = projectJourneyCells(result);

    expect(cells).toHaveLength(BEHAVIOR_DIMENSIONS.length);
    expect(cells[0]).toEqual(expect.objectContaining({
      step: 'S9',
      cell_kind: 'element',
      cell_status: 'green',
      assertion_ref: 'KERNEL-MERGE-AUTHORITY-01',
    }));
    expect(cells.every((cell) => cell.write_database === false)).toBe(true);
  });
});

describe('honest equivalence report', () => {
  it('accounts for priority, effective status, axes, matrix, fire commands, and gaps', () => {
    const gap = provenBehavior({
      behavior_id: 'KERNEL-P1-REPORT-CLOSURE',
      priority: 'P1',
      status: 'gap',
      steps: ['S12'],
      dimensions: ['ledger_freshness', 'axis_alignment'],
      proof_matrix: {},
      gap: {
        reason: 'No live production receipt exists.',
        owner: 'kernel.reports',
        closure_plan: 'Run the production closure drill.',
      },
    });
    const validation = validateBehaviorEquivalence(
      contract([provenBehavior(), gap]),
      { now: NOW },
    );

    const report = buildEquivalenceReport(validation, {
      evaluatedAt: '2026-07-28T12:00:00.000Z',
    });

    expect(report.summary).toEqual({
      total: 2,
      by_priority: { P0: 1, P1: 1 },
      by_effective_status: { proven: 1, gap: 1, intentional_replacement: 0 },
      findings: 0,
    });
    expect(report.axes).toMatchObject({
      steps: GOLDEN_PATH_STEPS,
      dimensions: BEHAVIOR_DIMENSIONS,
      providers: PROOF_PROVIDERS,
      scenarios: PROOF_SCENARIOS,
      possible_cells: 143,
    });
    expect(report.provider_matrix).toMatchObject({
      required_cells: 18,
      receipted_cells: 9,
      missing_cells: 9,
    });
    expect(report.proven_to_fire_commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        behavior_id: 'KERNEL-P0-MERGE-AUTHORITY',
        provider: 'claude',
        scenario: 'violation',
      }),
    ]));
    expect(report.gaps).toEqual([
      expect.objectContaining({
        behavior_id: 'KERNEL-P1-REPORT-CLOSURE',
        owner: 'kernel.reports',
        closure_plan: 'Run the production closure drill.',
      }),
    ]);
  });

  it('renders deterministic Markdown that says gaps are not proof', () => {
    const gap = provenBehavior({
      status: 'gap',
      proof_matrix: {},
      gap: {
        reason: 'No real Grok recovery receipt exists.',
        owner: 'kernel.fleet',
        closure_plan: 'Run the Grok recovery drill.',
      },
    });
    const validation = validateBehaviorEquivalence(contract([gap]), { now: NOW });
    const report = buildEquivalenceReport(validation, {
      evaluatedAt: '2026-07-28T12:00:00.000Z',
    });

    const first = formatEquivalenceMarkdown(report);
    const second = formatEquivalenceMarkdown(report);

    expect(second).toBe(first);
    expect(first).toContain('11 项行为维度');
    expect(first).toContain('缺口不是证明');
    expect(first).toContain('No real Grok recovery receipt exists.');
    expect(first).toContain('Run the Grok recovery drill.');
  });
});
