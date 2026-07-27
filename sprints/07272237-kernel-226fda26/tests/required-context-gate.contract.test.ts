import { describe, expect, it } from 'vitest';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const CONTRACT_ID = '99999999-8888-7777-6666-555555555555';
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4226';
const CURRENT_SHA = 'a'.repeat(40);

function fakePool(rowsByTable = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes('FROM initiative_runs')) {
        return {
          rows: rowsByTable.initiative_runs ?? [{
            id: RUN_ID,
            contract_id: CONTRACT_ID,
            phase: 'evaluate',
            pr_url: PR_URL,
            current_task_id: TASK_ID,
          }],
        };
      }
      if (sql.includes('FROM initiative_contracts')) {
        return { rows: rowsByTable.initiative_contracts ?? [{ id: CONTRACT_ID, status: 'approved' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rows: rowsByTable.tasks ?? [{
            id: TASK_ID,
            status: 'in_progress',
            payload: {
              review_required: true,
              target_environment: 'local_api',
              base_repo: 'perfectuser21/cecelia',
              expected_repo: 'evil/repo',
              expected_run: 'evil-run',
              role: 'evil-role',
            },
          }],
        };
      }
      if (sql.includes('FROM orchestrator_decision_log')) {
        return { rows: rowsByTable.orchestrator_decision_log ?? [] };
      }
      if (sql.includes('FROM harness_attempts')) {
        return { rows: rowsByTable.harness_attempts ?? [] };
      }
      if (sql.includes('FROM account_usage_cache')) {
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql} params=${JSON.stringify(params)}`);
    },
  };
}

function makeDeps(overrides = {}) {
  return {
    pool: fakePool(overrides.rows),
    execCmd(command) {
      if (command.includes('gh pr view')) {
        return JSON.stringify({
          state: 'OPEN',
          isDraft: true,
          autoMergeRequest: null,
          mergeStateStatus: 'BLOCKED',
          headRefOid: CURRENT_SHA,
          statusCheckRollup: [{ state: 'SUCCESS', name: 'ci / unit' }],
        });
      }
      if (command.includes('gh pr checks')) return '[]';
      if (command.includes('gh pr list')) return '[]';
      if (command.includes('git ls-remote')) return '';
      if (command.includes('docker ps')) return '';
      if (command.includes('docker inspect')) return '{"ExitCode":0}';
      throw new Error(`unexpected command: ${command}`);
    },
    fileExists(path) {
      return path.endsWith('sprint-prd.md');
    },
    readFile() {
      return '';
    },
    listHostPids: async () => [],
  };
}

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: {
      url: PR_URL,
      state: 'OPEN',
      ci: 'pass',
      merged: false,
      head_sha: CURRENT_SHA,
      is_draft: true,
      auto_merge_request: null,
    },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CURRENT_SHA },
    judgeVerdict: { verdict: 'PASS', pr_head_sha: CURRENT_SHA },
    reviewRequired: true,
    reviewApproved: true,
    counters: {
      hops: 8,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
    },
    ...overrides,
  };
}

describe('kernel required-context contract [BEHAVIOR]', () => {
  it('server-owned facts derive target_environment and required contexts', async () => {
    const observed = await collectGroundTruth(makeDeps(), {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: 'sprints/07272237-kernel-226fda26/sprint-prd.md',
      callbackResultPath: '.missing-contract-result.json',
    });

    expect(observed.kernelReleaseGateTruth).toMatchObject({
      authority_source: 'server_owned',
      run_id: RUN_ID,
      task_id: TASK_ID,
      base_repo: 'perfectuser21/cecelia',
      target_environment: 'local_api',
      current_head_sha: CURRENT_SHA,
      pr_is_draft: true,
      auto_merge_request: null,
      caller_expected_repo_ignored: 'evil/repo',
      caller_expected_run_ignored: 'evil-run',
      caller_role_ignored: 'evil-role',
    });
    expect(observed.kernelReleaseGateTruth.required_contexts.length).toBeGreaterThan(0);
  });

  it.each([
    'stale_check_sha',
    'wrong_repo',
    'wrong_run_or_task',
    'missing_required_context',
    'preview_required_failed',
    'local_required_context_failed',
    'required_context_mapping_missing',
    'external_infrastructure_failure',
  ])('independent blocker reason stays exact: %s', (reason) => {
    const decision = derive(baseObserved({
      kernelReleaseGate: {
        allow: false,
        reason,
        current_head_sha: CURRENT_SHA,
      },
    }));

    expect(decision).toMatchObject({
      phase: 'evaluate',
      action: 'wait:kernel_release_gate',
      reason,
    });
  });

  it('local_api preview neutral only after local contexts pass', async () => {
    const observed = await collectGroundTruth(makeDeps({
      rows: {
        orchestrator_decision_log: [
          {
            hop: 21,
            action: 'effect:required_context_check',
            observed: {},
            detail: {
              pr_head_sha: CURRENT_SHA,
              target_environment: 'local_api',
              preview_dependency: false,
              required_contexts: [
                { name: 'contract/unit', status: 'PASS', tested_sha: CURRENT_SHA, locality: 'local' },
              ],
            },
          },
        ],
      },
    }), {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: 'sprints/07272237-kernel-226fda26/sprint-prd.md',
      callbackResultPath: '.missing-contract-result.json',
    });

    expect(observed.kernelReleaseGateTruth).toMatchObject({
      preview: {
        status: 'neutral',
        allow_without_preview: true,
      },
    });
  });

  it('preview-dependent targets hard fail without preview', async () => {
    const observed = await collectGroundTruth(makeDeps({
      rows: {
        tasks: [{
          id: TASK_ID,
          status: 'in_progress',
          payload: {
            review_required: true,
            target_environment: 'windows_cloud',
            base_repo: 'perfectuser21/cecelia',
          },
        }],
      },
    }), {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: 'sprints/07272237-kernel-226fda26/sprint-prd.md',
      callbackResultPath: '.missing-contract-result.json',
    });

    expect(observed.kernelReleaseGateTruth).toMatchObject({
      preview: {
        required: true,
        blocker_when_missing: 'preview_required_missing',
        blocker_when_failed: 'preview_required_failed',
      },
    });
  });

  it('legacy rollout stays explicit and does not weaken target-aware semantics', () => {
    const decision = derive(baseObserved({
      kernelReleaseGate: {
        allow: false,
        reason: 'local_required_context_failed',
        current_head_sha: CURRENT_SHA,
        legacy_rollout_applied: true,
      },
    }));

    expect(decision).toMatchObject({
      phase: 'evaluate',
      action: 'wait:kernel_release_gate',
      reason: 'local_required_context_failed',
    });
  });
});
