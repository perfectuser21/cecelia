import { describe, expect, it } from 'vitest';

import {
  RELEASE_QUALITY_BRANCH,
  RELEASE_QUALITY_MAX_AGE_MS,
  RELEASE_QUALITY_WORKFLOW,
  validateReleaseQualityObservation,
} from '../release-run-quality.js';

const REPOSITORY = 'perfectuser21/cecelia';
const OBSERVED_AT = '2026-07-29T12:00:00.000Z';
const RUN_ID = 123456;

function validObservation(overrides = {}) {
  return {
    status: 'pass',
    repository: REPOSITORY,
    workflow_file: 'nightly-regression.yml',
    branch: 'main',
    run_id: RUN_ID,
    head_sha: 'a'.repeat(40),
    conclusion: 'success',
    completed_at: '2026-07-28T12:00:00.000Z',
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`,
    ...overrides,
  };
}

function validate(observation, overrides = {}) {
  return validateReleaseQualityObservation(observation, {
    repository: REPOSITORY,
    observedAt: OBSERVED_AT,
    ...overrides,
  });
}

describe('ReleaseRun nightly quality contract', () => {
  it('freezes the old fixed main/nightly/48h policy', () => {
    expect(RELEASE_QUALITY_WORKFLOW).toBe('nightly-regression.yml');
    expect(RELEASE_QUALITY_BRANCH).toBe('main');
    expect(RELEASE_QUALITY_MAX_AGE_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('returns only the exact canonical fresh receipt', () => {
    const observation = validObservation();
    const receipt = validate(observation);

    expect(receipt).toEqual(observation);
    expect(Object.keys(receipt).sort()).toEqual([
      'branch',
      'completed_at',
      'conclusion',
      'head_sha',
      'html_url',
      'repository',
      'run_id',
      'status',
      'workflow_file',
    ]);
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it('accepts a success completed exactly at the 48h boundary', () => {
    expect(validate(validObservation({
      completed_at: '2026-07-27T12:00:00.000Z',
    }))).toMatchObject({ status: 'pass' });
  });

  it.each([
    ['non-object observation', null],
    ['array observation', []],
    ['extra caller field', validObservation({ bypass: true })],
    ['non-pass status', validObservation({ status: 'fail' })],
    ['wrong repository', validObservation({ repository: 'attacker/repo' })],
    ['wrong workflow', validObservation({ workflow_file: 'ci.yml' })],
    ['wrong branch', validObservation({ branch: 'develop' })],
    ['zero run id', validObservation({ run_id: 0 })],
    ['floating run id', validObservation({ run_id: 12.5 })],
    ['string run id', validObservation({ run_id: '123456' })],
    ['uppercase head SHA', validObservation({ head_sha: 'A'.repeat(40) })],
    ['short head SHA', validObservation({ head_sha: 'a'.repeat(39) })],
    ['failed conclusion', validObservation({ conclusion: 'failure' })],
    ['invalid completion timestamp', validObservation({ completed_at: 'not-a-time' })],
    ['future completion timestamp', validObservation({
      completed_at: '2026-07-29T12:00:00.001Z',
    })],
    ['stale completion timestamp', validObservation({
      completed_at: '2026-07-27T11:59:59.999Z',
    })],
    ['wrong URL repository', validObservation({
      html_url: `https://github.com/attacker/repo/actions/runs/${RUN_ID}`,
    })],
    ['wrong URL run id', validObservation({
      html_url: `https://github.com/${REPOSITORY}/actions/runs/654321`,
    })],
    ['URL with query', validObservation({
      html_url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}?attempt=1`,
    })],
    ['URL with fragment', validObservation({
      html_url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}#job`,
    })],
    ['URL with credentials', validObservation({
      html_url: `https://token@github.com/${REPOSITORY}/actions/runs/${RUN_ID}`,
    })],
  ])('rejects %s', (_label, observation) => {
    expect(() => validate(observation)).toThrow(/^release_quality_/);
  });

  it.each([
    ['invalid expected repository', { repository: '../repo' }],
    ['invalid observation time', { observedAt: 'not-a-time' }],
  ])('rejects a server contract with %s', (_label, overrides) => {
    expect(() => validate(validObservation(), overrides)).toThrow(/^release_quality_/);
  });
});
