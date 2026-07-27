import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';

const MODULE_PATH = '../../../packages/brain/src/orchestrator/approved-contract-provenance.js';
const RUN_ID = '13d41c64-f5f1-4aaf-9487-c2608c3ec990';
const INITIATIVE_ID = '891b959f-98e5-43be-8315-dd83dedf00c8';
const SPRINT_DIR = 'sprints/kernel-contract-fixture';
const APPROVED_DIGEST = '1'.repeat(64);
const STALE_DIGEST = '2'.repeat(64);
const APPROVED_SOURCE_SHA = 'a'.repeat(40);

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: {
      url: 'https://github.com/perfectuser21/cecelia/pull/9999',
      state: 'OPEN',
      ci: 'pass',
      merged: false,
      head_sha: 'sha-current',
    },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 10,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: {
      hops: 12,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
    },
    decisionLog: [],
    ...overrides,
  };
}

async function subject() {
  return import(MODULE_PATH);
}

function sh(cwd: string, command: string) {
  return execFileSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Harness Test',
      GIT_AUTHOR_EMAIL: 'harness-test@example.invalid',
      GIT_COMMITTER_NAME: 'Harness Test',
      GIT_COMMITTER_EMAIL: 'harness-test@example.invalid',
    },
  }).trim();
}

function write(repo: string, filePath: string, content: string) {
  const abs = join(repo, filePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function createApprovedRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'approved-contract-provenance-'));
  sh(repo, 'git init -q');
  const rootGoldenPath = 'sprints/fixtures/approved-contract/golden.json';
  const sprintGoldenPath = `${SPRINT_DIR}/fixtures/replay-golden.json`;
  write(repo, `${SPRINT_DIR}/sprint-prd.md`, '# PRD\nGolden Path: approved manifest\n');
  write(repo, `${SPRINT_DIR}/contract-draft.md`, [
    '# Sprint Contract Draft',
    'Step 1',
    `Fixture: ${rootGoldenPath}`,
    `Golden: ${sprintGoldenPath}`,
    '',
  ].join('\n'));
  write(repo, `${SPRINT_DIR}/contract-dod.md`, '- [ ] [BEHAVIOR] [L2] approved path\n  Test: manual:bash npx vitest\n');
  write(repo, `${SPRINT_DIR}/task-plan.json`, '{"tasks":[{"task_id":"ws1"}]}\n');
  write(repo, `${SPRINT_DIR}/tests/approved.test.ts`, [
    'import { it } from "vitest";',
    `const referencedFixtures = ["${rootGoldenPath}", "${sprintGoldenPath}"];`,
    'it("approved", () => { if (referencedFixtures.length !== 2) throw new Error("missing referenced fixtures"); });',
    '',
  ].join('\n'));
  write(repo, 'DoD.md', [
    '# Root DoD',
    '- [ ] migration 365 stays approved',
    'Test: psql "$DB_URL" -c "SELECT version FROM schema_version WHERE version = \'365\'"',
    'Action: apply packages/brain/migrations/365_executor_kind_kernel_process.sql',
    'Expected: schema_version contains 365',
    'Environment: local_api',
    'Safety: fail-closed on approved contract drift',
    '',
  ].join('\n'));
  write(repo, 'packages/brain/migrations/365_executor_kind_kernel_process.sql', '-- migration 365\n');
  write(repo, rootGoldenPath, '{"migration":365}\n');
  write(repo, sprintGoldenPath, '{"replay":"approved"}\n');
  sh(repo, 'git add . && git commit -qm approved');
  const approvedSha = sh(repo, 'git rev-parse HEAD');
  return { repo, approvedSha };
}

describe('approved contract provenance manifest [BEHAVIOR]', () => {
  it('canonical manifest freezes approved PRD contract DoD task-plan tests and fixture artifacts', async () => {
    const { buildApprovedContractManifest } = await subject();
    const { repo, approvedSha } = createApprovedRepo();

    const manifest = await buildApprovedContractManifest({
      repoRoot: repo,
      runId: RUN_ID,
      contractVersion: 6,
      sourceCommitSha: approvedSha,
      sprintDir: SPRINT_DIR,
      approvedAt: '2026-07-27T00:00:00.000Z',
      reviewerVerdict: {
        attempt_id: 'reviewer-attempt-1',
        verdict: 'APPROVED',
        reviewer: 'harness-contract-reviewer',
      },
    });

    expect(manifest).toMatchObject({
      run_id: RUN_ID,
      contract_version: 6,
      source_commit_sha: approvedSha,
      sprint_dir: SPRINT_DIR,
      reviewer_verdict: expect.objectContaining({ verdict: 'APPROVED' }),
    });
    expect(manifest.artifacts.map((a: { path: string; kind: string }) => [a.path, a.kind])).toEqual([
      ['DoD.md', 'root_dod'],
      ['packages/brain/migrations/365_executor_kind_kernel_process.sql', 'migration'],
      ['sprints/fixtures/approved-contract/golden.json', 'golden'],
      [`${SPRINT_DIR}/fixtures/replay-golden.json`, 'golden'],
      [`${SPRINT_DIR}/contract-dod.md`, 'contract_dod'],
      [`${SPRINT_DIR}/contract-draft.md`, 'contract_draft'],
      [`${SPRINT_DIR}/sprint-prd.md`, 'prd'],
      [`${SPRINT_DIR}/task-plan.json`, 'task_plan'],
      [`${SPRINT_DIR}/tests/approved.test.ts`, 'test'],
    ]);
    expect(manifest.artifacts.every((a: { git_blob_oid: string; sha256: string; size: number; kind: string }) => (
      /^[a-f0-9]{40,64}$/.test(a.git_blob_oid)
      && /^[a-f0-9]{64}$/.test(a.sha256)
      && Number.isInteger(a.size)
      && a.size > 0
    ))).toBe(true);
    expect(manifest.manifest_digest).toMatch(/^[a-f0-9]{64}$/);

    const rebuilt = await buildApprovedContractManifest({
      repoRoot: repo,
      runId: RUN_ID,
      contractVersion: 6,
      sourceCommitSha: approvedSha,
      sprintDir: SPRINT_DIR,
      approvedAt: '2026-07-27T00:00:00.000Z',
      reviewerVerdict: {
        attempt_id: 'reviewer-attempt-1',
        verdict: 'APPROVED',
        reviewer: 'harness-contract-reviewer',
      },
    });
    expect(rebuilt.manifest_digest).toBe(manifest.manifest_digest);
  });

  it('append-only approval ledger records immutable facts and rejects same contract_version with a different manifest_digest', async () => {
    const { materializeApprovedContractManifest } = await subject();
    const pool = new pg.Pool(DB_DEFAULTS);
    const client = await pool.connect();
    const initiativeId = randomUUID();
    const runId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE initiative_contracts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          initiative_id uuid NOT NULL,
          version integer NOT NULL,
          status text NOT NULL DEFAULT 'draft',
          prd_content text,
          contract_content text,
          review_rounds integer DEFAULT 0,
          approved_at timestamptz,
          branch text,
          source_commit_sha text,
          manifest_digest text,
          approved_manifest jsonb,
          reviewer_verdict jsonb,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now(),
          UNIQUE (initiative_id, version)
        ) ON COMMIT DROP;
        CREATE TEMP TABLE initiative_contract_approvals (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          initiative_id uuid NOT NULL,
          run_id uuid NOT NULL,
          contract_version integer NOT NULL,
          source_commit_sha text NOT NULL,
          sprint_dir text NOT NULL,
          manifest_digest text NOT NULL,
          approved_manifest jsonb NOT NULL,
          reviewer_verdict jsonb NOT NULL,
          approved_at timestamptz NOT NULL DEFAULT now(),
          supersedes_approval_id uuid,
          created_at timestamptz DEFAULT now(),
          UNIQUE (initiative_id, contract_version, manifest_digest)
        ) ON COMMIT DROP;
        CREATE TEMP TABLE initiative_runs (
          id uuid PRIMARY KEY,
          initiative_id uuid NOT NULL,
          contract_id uuid,
          updated_at timestamptz DEFAULT now()
        ) ON COMMIT DROP;
      `);
      await client.query(
        'INSERT INTO initiative_runs (id, initiative_id) VALUES ($1::uuid, $2::uuid)',
        [runId, initiativeId],
      );

      const manifestA = {
        run_id: runId,
        contract_version: 6,
        source_commit_sha: 'a'.repeat(40),
        sprint_dir: SPRINT_DIR,
        artifacts: [],
        manifest_digest: '1'.repeat(64),
        approved_at: '2026-07-27T00:00:00.000Z',
        reviewer_verdict: { verdict: 'APPROVED' },
      };
      const manifestB = { ...manifestA, manifest_digest: '2'.repeat(64) };
      const manifestC = {
        ...manifestA,
        contract_version: 7,
        source_commit_sha: 'b'.repeat(40),
        manifest_digest: '3'.repeat(64),
        approved_at: '2026-07-27T01:00:00.000Z',
      };

      await materializeApprovedContractManifest(client, {
        runId,
        version: 6,
        branch: 'cp-harness-propose-r6-51836fb2-a12',
        manifest: manifestA,
        prdContent: '# PRD',
        contractContent: '# Contract',
      });
      await materializeApprovedContractManifest(client, {
        runId,
        version: 6,
        branch: 'cp-harness-propose-r6-51836fb2-a12',
        manifest: manifestA,
        prdContent: '# PRD replay attempted',
        contractContent: '# Contract replay attempted',
      });
      const afterReplay = await client.query(
        `SELECT count(*)::int AS count,
                max(manifest_digest) AS manifest_digest,
                max(prd_content) AS prd_content,
                max(contract_content) AS contract_content
           FROM initiative_contracts
          WHERE version = 6`,
      );
      expect(afterReplay.rows[0]).toMatchObject({
        count: 1,
        manifest_digest: manifestA.manifest_digest,
        prd_content: '# PRD',
        contract_content: '# Contract',
      });
      const ledgerAfterReplay = await client.query(
        `SELECT id, (count(*) OVER())::int AS count, contract_version, manifest_digest,
                source_commit_sha, sprint_dir, approved_manifest->>'manifest_digest' AS approved_manifest_digest,
                reviewer_verdict->>'verdict' AS reviewer_verdict
           FROM initiative_contract_approvals
          WHERE initiative_id = $1::uuid AND contract_version = 6
          ORDER BY approved_at`,
        [initiativeId],
      );
      expect(ledgerAfterReplay.rows).toHaveLength(1);
      expect(ledgerAfterReplay.rows[0]).toMatchObject({
        count: 1,
        contract_version: 6,
        manifest_digest: manifestA.manifest_digest,
        source_commit_sha: manifestA.source_commit_sha,
        sprint_dir: SPRINT_DIR,
        approved_manifest_digest: manifestA.manifest_digest,
        reviewer_verdict: 'APPROVED',
      });
      await expect(materializeApprovedContractManifest(client, {
        runId,
        version: 6,
        branch: 'cp-harness-propose-r6-51836fb2-a13',
        manifest: manifestB,
        prdContent: '# PRD changed',
        contractContent: '# Contract changed',
      })).rejects.toThrow(/approved_contract_manifest_conflict|same contract_version/i);
      await materializeApprovedContractManifest(client, {
        runId,
        version: 7,
        branch: 'cp-harness-propose-r7-51836fb2-a14',
        manifest: manifestC,
        prdContent: '# PRD v7',
        contractContent: '# Contract v7',
      });
      const ledgerVersions = await client.query(
        `SELECT id, contract_version, manifest_digest, supersedes_approval_id
           FROM initiative_contract_approvals
          WHERE initiative_id = $1::uuid
          ORDER BY contract_version`,
        [initiativeId],
      );
      expect(ledgerVersions.rows).toHaveLength(2);
      expect(ledgerVersions.rows[0]).toMatchObject({
        contract_version: 6,
        manifest_digest: manifestA.manifest_digest,
        supersedes_approval_id: null,
      });
      expect(ledgerVersions.rows[1]).toMatchObject({
        contract_version: 7,
        manifest_digest: manifestC.manifest_digest,
        supersedes_approval_id: ledgerVersions.rows[0].id,
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('approved migration 365 changed to 366 is rejected as approved_contract_drift', async () => {
    const { buildApprovedContractManifest, verifyApprovedContractManifest } = await subject();
    const { repo, approvedSha } = createApprovedRepo();
    const manifest = await buildApprovedContractManifest({
      repoRoot: repo,
      runId: RUN_ID,
      contractVersion: 6,
      sourceCommitSha: approvedSha,
      sprintDir: SPRINT_DIR,
      approvedAt: '2026-07-27T00:00:00.000Z',
      reviewerVerdict: { verdict: 'APPROVED' },
    });

    write(repo, 'DoD.md', [
      '# Root DoD',
      '- [ ] migration 366 stays approved',
      'Test: psql "$DB_URL" -c "SELECT version FROM schema_version WHERE version = \'366\'"',
      'Action: apply packages/brain/migrations/366_executor_kind_kernel_process.sql',
      'Expected: schema_version contains 366',
      'Environment: local_api',
      'Safety: fail-closed on approved contract drift',
      '',
    ].join('\n'));
    sh(repo, 'git mv packages/brain/migrations/365_executor_kind_kernel_process.sql packages/brain/migrations/366_executor_kind_kernel_process.sql');
    write(repo, 'packages/brain/migrations/366_executor_kind_kernel_process.sql', '-- migration 366\n');
    sh(repo, 'git add . && git commit -qm drift-365-to-366');
    const driftSha = sh(repo, 'git rev-parse HEAD');

    await expect(verifyApprovedContractManifest({
      repoRoot: repo,
      manifest,
      currentCommitSha: driftSha,
    })).resolves.toMatchObject({
      ok: false,
      reason: 'approved_contract_drift',
      drift: expect.arrayContaining([
        expect.objectContaining({ path: 'DoD.md', change: 'semantic' }),
        expect.objectContaining({ path: 'packages/brain/migrations/365_executor_kind_kernel_process.sql' }),
      ]),
    });
  });

  it('checkbox-only evidence-only provenance-only and combined root DoD edits are allowed', async () => {
    const { buildApprovedContractManifest, verifyApprovedContractManifest } = await subject();
    const baseLines = [
      '# Root DoD',
      '- [ ] migration 365 stays approved',
      'Test: psql "$DB_URL" -c "SELECT version FROM schema_version WHERE version = \'365\'"',
      'Action: apply packages/brain/migrations/365_executor_kind_kernel_process.sql',
      'Expected: schema_version contains 365',
      'Environment: local_api',
      'Safety: fail-closed on approved contract drift',
      '',
    ];
    const cases = [
      {
        label: 'checkbox-only',
        lines: [
          '# Root DoD',
          '- [x] migration 365 stays approved',
          ...baseLines.slice(2),
        ],
      },
      {
        label: 'evidence-only',
        lines: [
          ...baseLines.slice(0, -1),
          'Evidence: CI run 123 passed at sha-current',
          '',
        ],
      },
      {
        label: 'provenance-only',
        lines: [
          ...baseLines.slice(0, -1),
          'Provenance: checked by approved-contract-provenance',
          '',
        ],
      },
      {
        label: 'combined-mechanical',
        lines: [
          '# Root DoD',
          '- [x] migration 365 stays approved',
          ...baseLines.slice(2, -1),
          'Evidence: CI run 123 passed at sha-current',
          'Provenance: approved-contract-provenance manifest digest 1111',
          '',
        ],
      },
    ];

    for (const c of cases) {
      const { repo, approvedSha } = createApprovedRepo();
      const manifest = await buildApprovedContractManifest({
        repoRoot: repo,
        runId: RUN_ID,
        contractVersion: 6,
        sourceCommitSha: approvedSha,
        sprintDir: SPRINT_DIR,
        approvedAt: '2026-07-27T00:00:00.000Z',
        reviewerVerdict: { verdict: 'APPROVED' },
      });
      write(repo, 'DoD.md', c.lines.join('\n'));
      sh(repo, `git add DoD.md && git commit -qm ${c.label}`);
      const currentSha = sh(repo, 'git rev-parse HEAD');

      await expect(verifyApprovedContractManifest({
        repoRoot: repo,
        manifest,
        currentCommitSha: currentSha,
      })).resolves.toMatchObject({
        ok: true,
        allowed_mechanical_changes: expect.arrayContaining([
          expect.objectContaining({ path: 'DoD.md' }),
        ]),
      });
    }
  });

  it('referenced fixture and golden discovery freezes indirect assets and rejects their drift', async () => {
    const { buildApprovedContractManifest, verifyApprovedContractManifest } = await subject();
    const { repo, approvedSha } = createApprovedRepo();
    const manifest = await buildApprovedContractManifest({
      repoRoot: repo,
      runId: RUN_ID,
      contractVersion: 6,
      sourceCommitSha: approvedSha,
      sprintDir: SPRINT_DIR,
      approvedAt: '2026-07-27T00:00:00.000Z',
      reviewerVerdict: { verdict: 'APPROVED' },
    });

    const artifactPaths = manifest.artifacts.map((a: { path: string }) => a.path);
    expect(artifactPaths).toEqual(expect.arrayContaining([
      'sprints/fixtures/approved-contract/golden.json',
      `${SPRINT_DIR}/fixtures/replay-golden.json`,
    ]));

    write(repo, `${SPRINT_DIR}/fixtures/replay-golden.json`, '{"replay":"drifted"}\n');
    sh(repo, `git add ${SPRINT_DIR}/fixtures/replay-golden.json && git commit -qm referenced-golden-drift`);
    const driftSha = sh(repo, 'git rev-parse HEAD');

    await expect(verifyApprovedContractManifest({
      repoRoot: repo,
      manifest,
      currentCommitSha: driftSha,
    })).resolves.toMatchObject({
      ok: false,
      reason: 'approved_contract_drift',
      drift: expect.arrayContaining([
        expect.objectContaining({ path: `${SPRINT_DIR}/fixtures/replay-golden.json` }),
      ]),
    });
  });

  it('root DoD Test command action expected environment and safety semantic edits are each rejected as approved_contract_drift', async () => {
    const { buildApprovedContractManifest, verifyApprovedContractManifest } = await subject();
    const baseLines = [
      '# Root DoD',
      '- [ ] migration 365 stays approved',
      'Test: psql "$DB_URL" -c "SELECT version FROM schema_version WHERE version = \'365\'"',
      'Action: apply packages/brain/migrations/365_executor_kind_kernel_process.sql',
      'Expected: schema_version contains 365',
      'Environment: local_api',
      'Safety: fail-closed on approved contract drift',
      '',
    ];
    const cases = [
      {
        label: 'test-command',
        index: 2,
        line: 'Test: psql "$DB_URL" -c "SELECT version FROM schema_version WHERE version IN (\'365\',\'366\')"',
      },
      {
        label: 'action',
        index: 3,
        line: 'Action: apply packages/brain/migrations/365_executor_kind_kernel_process.sql with fallback rewrite',
      },
      {
        label: 'expected',
        index: 4,
        line: 'Expected: schema_version contains any approved-looking migration',
      },
      {
        label: 'environment',
        index: 5,
        line: 'Environment: developer_laptop',
      },
      {
        label: 'safety',
        index: 6,
        line: 'Safety: warn-only on approved contract drift',
      },
    ];

    for (const c of cases) {
      const { repo, approvedSha } = createApprovedRepo();
      const manifest = await buildApprovedContractManifest({
        repoRoot: repo,
        runId: RUN_ID,
        contractVersion: 6,
        sourceCommitSha: approvedSha,
        sprintDir: SPRINT_DIR,
        approvedAt: '2026-07-27T00:00:00.000Z',
        reviewerVerdict: { verdict: 'APPROVED' },
      });
      const lines = [...baseLines];
      lines[c.index] = c.line;
      write(repo, 'DoD.md', lines.join('\n'));
      sh(repo, `git add DoD.md && git commit -qm root-dod-semantic-drift-${c.label}`);
      const currentSha = sh(repo, 'git rev-parse HEAD');

      await expect(verifyApprovedContractManifest({
        repoRoot: repo,
        manifest,
        currentCommitSha: currentSha,
      })).resolves.toMatchObject({
        ok: false,
        reason: 'approved_contract_drift',
        drift: expect.arrayContaining([
          expect.objectContaining({ path: 'DoD.md', change: 'semantic' }),
        ]),
      });
    }
  });

  it('missing manifest unreachable stale sha and stale manifest digest fail closed', async () => {
    const { verifyApprovedContractReference } = await subject();
    const currentPrSha = 'b'.repeat(40);
    const manifestDigest = 'c'.repeat(64);

    expect(verifyApprovedContractReference({
      manifestLoadError: new Error('git object store unavailable'),
      expectedManifestDigest: manifestDigest,
      currentPrSha,
    })).toMatchObject({ ok: false, reason: 'approved_contract_manifest_unreachable' });
    expect(verifyApprovedContractReference({
      manifest: null,
      expectedManifestDigest: manifestDigest,
      currentPrSha,
    })).toMatchObject({ ok: false, reason: 'approved_contract_manifest_missing' });
    expect(verifyApprovedContractReference({
      manifest: { manifest_digest: manifestDigest, source_commit_sha: 'a'.repeat(40) },
      expectedManifestDigest: 'd'.repeat(64),
      currentPrSha,
    })).toMatchObject({ ok: false, reason: 'stale_manifest_digest' });
    expect(verifyApprovedContractReference({
      manifest: { manifest_digest: manifestDigest, source_commit_sha: 'a'.repeat(40) },
      expectedManifestDigest: manifestDigest,
      currentPrSha: null,
    })).toMatchObject({ ok: false, reason: 'current_pr_sha_missing' });
  });

  it('generator evaluator CI and merge gate reject unreachable approved manifest fail closed', async () => {
    const { verifyApprovedContractExecutionPreflight } = await subject();
    const { runApprovedContractProvenanceCheck } = await import('../../../scripts/ci/approved-contract-provenance-check.mjs');
    const { mergeGate } = await import('../../../packages/brain/src/orchestrator/gates.js');
    const approvedContract = {
      branch: 'cp-harness-propose-r6-51836fb2-a17',
      manifest_digest: APPROVED_DIGEST,
      source_commit_sha: APPROVED_SOURCE_SHA,
      approved_manifest: {
        manifest_digest: APPROVED_DIGEST,
        source_commit_sha: APPROVED_SOURCE_SHA,
        sprint_dir: SPRINT_DIR,
      },
    };

    expect(verifyApprovedContractExecutionPreflight({
      role: 'generator',
      contract: approvedContract,
      manifestLoadError: new Error('approved manifest row unreadable'),
      expectedManifestDigest: APPROVED_DIGEST,
    })).toMatchObject({
      ok: false,
      reason: 'approved_contract_manifest_unreachable',
    });
    expect(verifyApprovedContractExecutionPreflight({
      role: 'evaluator',
      contract: approvedContract,
      manifestLoadError: new Error('approved manifest row unreadable'),
      expectedManifestDigest: APPROVED_DIGEST,
      expectedPrHeadSha: 'sha-current',
      currentPrSha: 'sha-current',
    })).toMatchObject({
      ok: false,
      reason: 'approved_contract_manifest_unreachable',
    });
    await expect(runApprovedContractProvenanceCheck({
      repoRoot: '/tmp/approved-contract-manifest-unreachable',
      sprintDir: SPRINT_DIR,
      manifestDigest: APPROVED_DIGEST,
      prHeadSha: 'sha-current',
      manifestLoadError: new Error('approved manifest DB read failed'),
    })).resolves.toMatchObject({
      ok: false,
      reason: 'approved_contract_manifest_unreachable',
    });
    expect(mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-current', manifest_digest: APPROVED_DIGEST },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-current', manifest_digest: APPROVED_DIGEST },
      prHeadSha: 'sha-current',
      approvedManifestDigest: APPROVED_DIGEST,
      approvedManifestLoadError: new Error('approved manifest DB read failed'),
      reviewRequired: false,
      reviewApproved: false,
    })).toEqual({
      allow: false,
      reason: 'approved_contract_manifest_unreachable',
    });
  });

  it('generator and evaluator dispatch carry approved manifest digest and source sha', async () => {
    const { buildApprovedContractDispatchContext } = await subject();
    const approvedContract = {
      branch: 'cp-harness-propose-r6-51836fb2-a12',
      manifest_digest: APPROVED_DIGEST,
      source_commit_sha: APPROVED_SOURCE_SHA,
      approved_manifest: {
        manifest_digest: APPROVED_DIGEST,
        source_commit_sha: APPROVED_SOURCE_SHA,
        sprint_dir: SPRINT_DIR,
      },
    };

    const generatorContext = buildApprovedContractDispatchContext({
      role: 'generator',
      contract: approvedContract,
      currentPrSha: null,
    });
    expect(generatorContext.inputs.contract.manifest_digest).toBe(APPROVED_DIGEST);
    expect(generatorContext.inputs.contract.approved_manifest.manifest_digest).toBe(APPROVED_DIGEST);
    expect(generatorContext.env).toMatchObject({
      APPROVED_CONTRACT_MANIFEST_DIGEST: APPROVED_DIGEST,
      APPROVED_CONTRACT_SOURCE_SHA: APPROVED_SOURCE_SHA,
    });

    const evaluatorContext = buildApprovedContractDispatchContext({
      role: 'evaluator',
      contract: approvedContract,
      currentPrSha: 'sha-current',
    });
    expect(evaluatorContext.env).toMatchObject({
      APPROVED_CONTRACT_MANIFEST_DIGEST: APPROVED_DIGEST,
      APPROVED_CONTRACT_SOURCE_SHA: APPROVED_SOURCE_SHA,
      PR_HEAD_SHA: 'sha-current',
    });
  });

  it('dispatch preflight rejects missing manifest stale digest and stale pr_head_sha before launch', async () => {
    const {
      materializeApprovedContractManifest,
      verifyApprovedContractExecutionPreflight,
    } = await subject();
    const pool = new pg.Pool(DB_DEFAULTS);
    const client = await pool.connect();
    const initiativeId = randomUUID();
    const runId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE initiative_contracts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          initiative_id uuid NOT NULL,
          version integer NOT NULL,
          status text NOT NULL DEFAULT 'draft',
          prd_content text,
          contract_content text,
          review_rounds integer DEFAULT 0,
          approved_at timestamptz,
          branch text,
          source_commit_sha text,
          manifest_digest text,
          approved_manifest jsonb,
          reviewer_verdict jsonb,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now(),
          UNIQUE (initiative_id, version)
        ) ON COMMIT DROP;
        CREATE TEMP TABLE initiative_contract_approvals (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          initiative_id uuid NOT NULL,
          run_id uuid NOT NULL,
          contract_version integer NOT NULL,
          source_commit_sha text NOT NULL,
          sprint_dir text NOT NULL,
          manifest_digest text NOT NULL,
          approved_manifest jsonb NOT NULL,
          reviewer_verdict jsonb NOT NULL,
          approved_at timestamptz NOT NULL DEFAULT now(),
          supersedes_approval_id uuid,
          created_at timestamptz DEFAULT now(),
          UNIQUE (initiative_id, contract_version, manifest_digest)
        ) ON COMMIT DROP;
        CREATE TEMP TABLE initiative_runs (
          id uuid PRIMARY KEY,
          initiative_id uuid NOT NULL,
          contract_id uuid,
          updated_at timestamptz DEFAULT now()
        ) ON COMMIT DROP;
      `);
      await client.query(
        'INSERT INTO initiative_runs (id, initiative_id) VALUES ($1::uuid, $2::uuid)',
        [runId, initiativeId],
      );
      const manifest = {
        run_id: runId,
        contract_version: 6,
        source_commit_sha: APPROVED_SOURCE_SHA,
        sprint_dir: SPRINT_DIR,
        artifacts: [],
        manifest_digest: APPROVED_DIGEST,
        approved_at: '2026-07-27T00:00:00.000Z',
        reviewer_verdict: { verdict: 'APPROVED' },
      };
      await materializeApprovedContractManifest(client, {
        runId,
        version: 6,
        branch: 'cp-harness-propose-r6-51836fb2-a17',
        manifest,
        prdContent: '# PRD',
        contractContent: '# Contract',
      });
      const { rows } = await client.query(
        `SELECT branch, manifest_digest, source_commit_sha, approved_manifest
           FROM initiative_contracts
          WHERE initiative_id=$1::uuid AND version=6`,
        [initiativeId],
      );
      const approvedContract = rows[0];

      expect(verifyApprovedContractExecutionPreflight({
        role: 'generator',
        contract: null,
        expectedManifestDigest: APPROVED_DIGEST,
      })).toMatchObject({
        ok: false,
        reason: 'approved_contract_manifest_missing',
      });
      expect(verifyApprovedContractExecutionPreflight({
        role: 'generator',
        contract: approvedContract,
        expectedManifestDigest: STALE_DIGEST,
      })).toMatchObject({
        ok: false,
        reason: 'stale_manifest_digest',
      });
      expect(verifyApprovedContractExecutionPreflight({
        role: 'evaluator',
        contract: approvedContract,
        expectedManifestDigest: APPROVED_DIGEST,
        expectedPrHeadSha: 'sha-current',
        currentPrSha: null,
      })).toMatchObject({
        ok: false,
        reason: 'current_pr_sha_missing',
      });
      expect(verifyApprovedContractExecutionPreflight({
        role: 'evaluator',
        contract: approvedContract,
        expectedManifestDigest: APPROVED_DIGEST,
        expectedPrHeadSha: 'sha-current',
        currentPrSha: 'sha-old',
      })).toMatchObject({
        ok: false,
        reason: 'stale_pr_head_sha',
      });
      expect(verifyApprovedContractExecutionPreflight({
        role: 'evaluator',
        contract: approvedContract,
        expectedManifestDigest: APPROVED_DIGEST,
        expectedPrHeadSha: 'sha-current',
        currentPrSha: 'sha-current',
      })).toMatchObject({ ok: true });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('callback refuses stale manifest_digest before writing evaluator verdict', async () => {
    const { verifyAttemptCallbackApprovedContract } = await subject();
    const attempt = {
      id: 'attempt-evaluator-1',
      role: 'evaluator',
      task_bundle: {
        inputs: {
          contract: {
            manifest_digest: APPROVED_DIGEST,
            approved_manifest: { manifest_digest: APPROVED_DIGEST },
          },
          pull_request: { head_sha: 'sha-current' },
        },
      },
    };

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'PASS', manifest_digest: STALE_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-current' },
    })).toMatchObject({
      ok: false,
      reason: 'stale_evaluate_manifest_digest',
    });

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'PASS' },
      provider_metadata: { pr_head_sha: 'sha-current' },
    })).toMatchObject({
      ok: false,
      reason: 'approved_contract_manifest_digest_missing',
    });

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'PASS', manifest_digest: APPROVED_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-current' },
    })).toMatchObject({ ok: true });
  });

  it('evaluator callback refuses stale pr_head_sha before writing evaluator verdict', async () => {
    const { verifyAttemptCallbackApprovedContract } = await subject();
    const attempt = {
      id: 'attempt-evaluator-2',
      role: 'evaluator',
      task_bundle: {
        inputs: {
          contract: {
            manifest_digest: APPROVED_DIGEST,
            approved_manifest: { manifest_digest: APPROVED_DIGEST },
          },
          pull_request: { head_sha: 'sha-current' },
        },
      },
    };

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'PASS', manifest_digest: APPROVED_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-old' },
    })).toMatchObject({
      ok: false,
      reason: 'stale_evaluate_pr_head_sha',
    });

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'PASS', manifest_digest: APPROVED_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-current' },
    })).toMatchObject({ ok: true });
  });

  it('callback refuses stale pr_head_sha before writing generator verdict', async () => {
    const { verifyAttemptCallbackApprovedContract } = await subject();
    const attempt = {
      id: 'attempt-generator-1',
      role: 'generator',
      task_bundle: {
        inputs: {
          contract: {
            manifest_digest: APPROVED_DIGEST,
            approved_manifest: { manifest_digest: APPROVED_DIGEST },
          },
          pull_request: { head_sha: 'sha-current' },
        },
      },
    };

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'completed', manifest_digest: APPROVED_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-old' },
    })).toMatchObject({
      ok: false,
      reason: 'stale_generator_pr_head_sha',
    });

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'completed', manifest_digest: APPROVED_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-current' },
    })).toMatchObject({ ok: true });
  });

  it('generator callback refuses stale manifest_digest before writing generator verdict', async () => {
    const { verifyAttemptCallbackApprovedContract } = await subject();
    const attempt = {
      id: 'attempt-generator-2',
      role: 'generator',
      task_bundle: {
        inputs: {
          contract: {
            manifest_digest: APPROVED_DIGEST,
            approved_manifest: { manifest_digest: APPROVED_DIGEST },
          },
          pull_request: { head_sha: 'sha-current' },
        },
      },
    };

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'completed', manifest_digest: STALE_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-current' },
    })).toMatchObject({
      ok: false,
      reason: 'stale_generator_manifest_digest',
    });

    expect(verifyAttemptCallbackApprovedContract(attempt, {
      decision: { outcome: 'completed', manifest_digest: APPROVED_DIGEST },
      provider_metadata: { pr_head_sha: 'sha-current' },
    })).toMatchObject({ ok: true });
  });

  it('callback refuses missing pr_head_sha before writing evaluator or generator verdict', async () => {
    const { verifyAttemptCallbackApprovedContract } = await subject();
    const evaluatorAttempt = {
      id: 'attempt-evaluator-missing-sha',
      role: 'evaluator',
      task_bundle: {
        inputs: {
          contract: {
            manifest_digest: APPROVED_DIGEST,
            approved_manifest: { manifest_digest: APPROVED_DIGEST },
          },
          pull_request: { head_sha: 'sha-current' },
        },
      },
    };
    const generatorAttempt = {
      id: 'attempt-generator-missing-sha',
      role: 'generator',
      task_bundle: {
        inputs: {
          contract: {
            manifest_digest: APPROVED_DIGEST,
            approved_manifest: { manifest_digest: APPROVED_DIGEST },
          },
          pull_request: { head_sha: 'sha-current' },
        },
      },
    };

    expect(verifyAttemptCallbackApprovedContract(evaluatorAttempt, {
      decision: { outcome: 'PASS', manifest_digest: APPROVED_DIGEST },
      provider_metadata: {},
    })).toMatchObject({
      ok: false,
      reason: 'current_pr_sha_missing',
    });

    expect(verifyAttemptCallbackApprovedContract(generatorAttempt, {
      decision: { outcome: 'completed', manifest_digest: APPROVED_DIGEST },
      provider_metadata: {},
    })).toMatchObject({
      ok: false,
      reason: 'current_pr_sha_missing',
    });
  });

  it('CI required check rejects missing stale digest and stale pr_head_sha fail closed', async () => {
    const { buildApprovedContractManifest } = await subject();
    const { runApprovedContractProvenanceCheck } = await import('../../../scripts/ci/approved-contract-provenance-check.mjs');
    const { repo, approvedSha } = createApprovedRepo();
    const manifest = await buildApprovedContractManifest({
      repoRoot: repo,
      runId: RUN_ID,
      contractVersion: 6,
      sourceCommitSha: approvedSha,
      sprintDir: SPRINT_DIR,
      approvedAt: '2026-07-27T00:00:00.000Z',
      reviewerVerdict: { verdict: 'APPROVED' },
    });
    write(repo, 'README.md', 'implementation commit that does not touch approved artifacts\n');
    sh(repo, 'git add README.md && git commit -qm implementation-head');
    const currentHeadSha = sh(repo, 'git rev-parse HEAD');

    const pool = new pg.Pool(DB_DEFAULTS);
    const client = await pool.connect();
    const schema = `approved_contract_ci_${randomUUID().replace(/-/g, '')}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`
        CREATE TABLE ${schema}.initiative_contracts (
          id uuid,
          initiative_id uuid,
          version integer,
          contract_version integer,
          status text,
          sprint_dir text,
          source_commit_sha text,
          manifest_digest text,
          approved_manifest jsonb,
          reviewer_verdict jsonb,
          approved_at timestamptz,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        );
        CREATE TABLE ${schema}.initiative_contract_approvals (
          id uuid,
          initiative_id uuid,
          run_id uuid,
          contract_version integer,
          source_commit_sha text,
          sprint_dir text,
          manifest_digest text,
          approved_manifest jsonb,
          reviewer_verdict jsonb,
          approved_at timestamptz,
          supersedes_approval_id uuid,
          created_at timestamptz DEFAULT now()
        );
      `);
      await client.query(
        `INSERT INTO ${schema}.initiative_contracts
          (id, initiative_id, version, contract_version, status, sprint_dir, source_commit_sha, manifest_digest, approved_manifest, reviewer_verdict, approved_at)
         VALUES ($1::uuid, $2::uuid, $3, $3, 'approved', $4, $5, $6, $7::jsonb, $8::jsonb, now())`,
        [
          randomUUID(),
          INITIATIVE_ID,
          6,
          SPRINT_DIR,
          approvedSha,
          manifest.manifest_digest,
          JSON.stringify(manifest),
          JSON.stringify({ verdict: 'APPROVED', reviewer: 'harness-contract-reviewer' }),
        ],
      );
      await client.query(
        `INSERT INTO ${schema}.initiative_contract_approvals
          (id, initiative_id, run_id, contract_version, source_commit_sha, sprint_dir, manifest_digest, approved_manifest, reviewer_verdict, approved_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())`,
        [
          randomUUID(),
          INITIATIVE_ID,
          RUN_ID,
          6,
          approvedSha,
          SPRINT_DIR,
          manifest.manifest_digest,
          JSON.stringify(manifest),
          JSON.stringify({ verdict: 'APPROVED', reviewer: 'harness-contract-reviewer' }),
        ],
      );

      const dbConfig = {
        ...DB_DEFAULTS,
        options: `-c search_path=${schema},public`,
      };
      await expect(runApprovedContractProvenanceCheck({
        repoRoot: repo,
        sprintDir: SPRINT_DIR,
        manifestDigest: manifest.manifest_digest,
        prHeadSha: currentHeadSha,
        dbConfig,
      })).resolves.toMatchObject({
        ok: true,
        manifest_digest: manifest.manifest_digest,
      });
      await expect(runApprovedContractProvenanceCheck({
        repoRoot: repo,
        sprintDir: SPRINT_DIR,
        manifestDigest: STALE_DIGEST,
        prHeadSha: currentHeadSha,
        dbConfig,
      })).resolves.toMatchObject({
        ok: false,
        reason: 'stale_manifest_digest',
      });
      await expect(runApprovedContractProvenanceCheck({
        repoRoot: repo,
        sprintDir: SPRINT_DIR,
        manifestDigest: manifest.manifest_digest,
        prHeadSha: approvedSha,
        dbConfig,
      })).resolves.toMatchObject({
        ok: false,
        reason: 'stale_pr_head_sha',
      });
      await expect(runApprovedContractProvenanceCheck({
        repoRoot: repo,
        sprintDir: `${SPRINT_DIR}-missing`,
        manifestDigest: manifest.manifest_digest,
        prHeadSha: currentHeadSha,
        dbConfig,
      })).resolves.toMatchObject({
        ok: false,
        reason: 'approved_contract_manifest_missing',
      });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });

  it('mergeGate refuses PASS verdicts that do not carry the approved manifest_digest', async () => {
    const { mergeGate } = await import('../../../packages/brain/src/orchestrator/gates.js');
    const result = mergeGate({
      evaluateVerdict: {
        verdict: 'PASS',
        pr_head_sha: 'sha-current',
        manifest_digest: 'stale-digest',
      },
      judgeVerdict: {
        verdict: 'PASS',
        pr_head_sha: 'sha-current',
        manifest_digest: 'approved-digest',
      },
      prHeadSha: 'sha-current',
      approvedManifestDigest: 'approved-digest',
      reviewRequired: false,
      reviewApproved: false,
    });
    expect(result).toEqual({
      allow: false,
      reason: 'stale_evaluate_manifest_digest',
    });
  });

  it('mergeGate refuses missing approved manifest_digest and stale judge manifest_digest', async () => {
    const { mergeGate } = await import('../../../packages/brain/src/orchestrator/gates.js');
    expect(mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-current', manifest_digest: APPROVED_DIGEST },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-current', manifest_digest: APPROVED_DIGEST },
      prHeadSha: 'sha-current',
      reviewRequired: false,
      reviewApproved: false,
    })).toEqual({
      allow: false,
      reason: 'approved_contract_manifest_digest_missing',
    });

    expect(mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-current', manifest_digest: APPROVED_DIGEST },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-current', manifest_digest: STALE_DIGEST },
      prHeadSha: 'sha-current',
      approvedManifestDigest: APPROVED_DIGEST,
      reviewRequired: false,
      reviewApproved: false,
    })).toEqual({
      allow: false,
      reason: 'stale_judge_manifest_digest',
    });
  });

  it('approved_contract_drift routes to requires_re_gan and never generator-fix', async () => {
    const { derive } = await import('../../../packages/brain/src/orchestrator/derive.js');
    const result = derive(baseObserved({
      evaluateVerdict: {
        verdict: 'FAIL',
        pr_head_sha: 'sha-current',
        failure_class: 'approved_contract_drift',
        failure_signature: 'DoD.md:365-to-366',
      },
    }));

    expect(result).toMatchObject({
      phase: 'gan',
      action: 'spawn:proposer',
      reason: 'requires_re_gan',
    });
    expect(result.action).not.toBe('spawn:generator-fix');
  });

  it('judge dispatch handler and verdict persistence carry approved manifest_digest and current pr_head_sha', async () => {
    const { buildApprovedContractDispatchContext } = await subject();
    const { createKernelHandlers } = await import('../../../packages/brain/src/orchestrator/kernel-handlers.js');
    const approvedContract = {
      branch: 'cp-harness-propose-r6-51836fb2-a17',
      manifest_digest: APPROVED_DIGEST,
      source_commit_sha: APPROVED_SOURCE_SHA,
      approved_manifest: {
        manifest_digest: APPROVED_DIGEST,
        source_commit_sha: APPROVED_SOURCE_SHA,
        sprint_dir: SPRINT_DIR,
      },
    };

    const dispatchContext = buildApprovedContractDispatchContext({
      role: 'judge',
      contract: approvedContract,
      currentPrSha: 'sha-current',
    });
    expect(dispatchContext.inputs.contract.manifest_digest).toBe(APPROVED_DIGEST);
    expect(dispatchContext.env).toMatchObject({
      APPROVED_CONTRACT_MANIFEST_DIGEST: APPROVED_DIGEST,
      APPROVED_CONTRACT_SOURCE_SHA: APPROVED_SOURCE_SHA,
      PR_HEAD_SHA: 'sha-current',
    });

    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    const attemptStore = {
      complete: vi.fn(async () => {}),
    };
    const judgeGate = vi.fn(async () => ({
      verdict: 'PASS',
      feedback: 'grounded judge pass',
      judged: true,
    }));
    const handlers = createKernelHandlers({
      pool,
      attemptStore,
      judgeGate,
      promptDir: '/tmp/approved-contract-provenance-prompts',
    });

    await handlers['spawn:judge']({
      runId: RUN_ID,
      taskId: INITIATIVE_ID,
      attempt: { id: 'judge-attempt-1' },
      bundle: {
        inputs: {
          worktree_path: '/tmp/repo',
          sprint_dir: SPRINT_DIR,
          contract: approvedContract,
        },
      },
      observed: {
        pr: { head_sha: 'sha-current', state: 'OPEN', merged: false },
        contract: { row: approvedContract },
        evaluateVerdict: {
          verdict: 'PASS',
          pr_head_sha: 'sha-current',
          manifest_digest: APPROVED_DIGEST,
        },
        evaluateResult: {
          decision: { outcome: 'PASS', manifest_digest: APPROVED_DIGEST },
          checks: [],
        },
        callbackResult: null,
        reviewApproved: false,
      },
    });

    expect(judgeGate).toHaveBeenCalledWith(expect.objectContaining({
      approvedManifestDigest: APPROVED_DIGEST,
      currentPrHeadSha: 'sha-current',
    }), expect.anything());
    const verdictCall = pool.query.mock.calls.find(([sql]) => /verdict:judge/.test(sql));
    expect(verdictCall).toBeTruthy();
    const detail = JSON.parse(verdictCall[1][3]);
    expect(detail).toMatchObject({
      verdict: 'PASS',
      pr_head_sha: 'sha-current',
      manifest_digest: APPROVED_DIGEST,
    });
    expect(attemptStore.complete.mock.calls[0][1].decision).toMatchObject({
      outcome: 'PASS',
      manifest_digest: APPROVED_DIGEST,
    });
  });

  it('approved sprint PRD contract DoD task-plan tests fixture golden deletion rename and content edits are each rejected as approved_contract_drift', async () => {
    const { buildApprovedContractManifest, verifyApprovedContractManifest } = await subject();
    const cases = [
      {
        label: 'prd-content',
        path: `${SPRINT_DIR}/sprint-prd.md`,
        mutate: (repo: string) => {
          write(repo, `${SPRINT_DIR}/sprint-prd.md`, '# PRD\nGolden Path: approved manifest changed\n');
          sh(repo, `git add ${SPRINT_DIR}/sprint-prd.md`);
        },
      },
      {
        label: 'contract-draft-content',
        path: `${SPRINT_DIR}/contract-draft.md`,
        mutate: (repo: string) => {
          write(repo, `${SPRINT_DIR}/contract-draft.md`, '# Sprint Contract Draft\nStep 1 changed\n');
          sh(repo, `git add ${SPRINT_DIR}/contract-draft.md`);
        },
      },
      {
        label: 'contract-dod-content',
        path: `${SPRINT_DIR}/contract-dod.md`,
        mutate: (repo: string) => {
          write(repo, `${SPRINT_DIR}/contract-dod.md`, '- [ ] [BEHAVIOR] [L2] approved path changed\n  Test: manual:bash echo changed\n');
          sh(repo, `git add ${SPRINT_DIR}/contract-dod.md`);
        },
      },
      {
        label: 'task-plan-delete',
        path: `${SPRINT_DIR}/task-plan.json`,
        mutate: (repo: string) => {
          sh(repo, `git rm -q ${SPRINT_DIR}/task-plan.json`);
        },
      },
      {
        label: 'test-rename',
        path: `${SPRINT_DIR}/tests/approved.test.ts`,
        mutate: (repo: string) => {
          sh(repo, `git mv ${SPRINT_DIR}/tests/approved.test.ts ${SPRINT_DIR}/tests/renamed-approved.test.ts`);
        },
      },
      {
        label: 'fixture-golden-delete',
        path: 'sprints/fixtures/approved-contract/golden.json',
        mutate: (repo: string) => {
          sh(repo, 'git rm -q sprints/fixtures/approved-contract/golden.json');
        },
      },
    ];

    for (const c of cases) {
      const { repo, approvedSha } = createApprovedRepo();
      const manifest = await buildApprovedContractManifest({
        repoRoot: repo,
        runId: RUN_ID,
        contractVersion: 6,
        sourceCommitSha: approvedSha,
        sprintDir: SPRINT_DIR,
        approvedAt: '2026-07-27T00:00:00.000Z',
        reviewerVerdict: { verdict: 'APPROVED' },
      });
      c.mutate(repo);
      sh(repo, `git commit -qm contract-artifact-drift-${c.label}`);
      const driftSha = sh(repo, 'git rev-parse HEAD');

      await expect(verifyApprovedContractManifest({
        repoRoot: repo,
        manifest,
        currentCommitSha: driftSha,
      })).resolves.toMatchObject({
        ok: false,
        reason: 'approved_contract_drift',
        drift: expect.arrayContaining([
          expect.objectContaining({ path: c.path }),
        ]),
      });
    }
  });

  it('main migration conflict after approval returns requires_re_gan', async () => {
    const { detectApprovedContractMainConflict } = await subject();
    const result = await detectApprovedContractMainConflict({
      approvedSourceCommitSha: 'a'.repeat(40),
      currentMainSha: 'b'.repeat(40),
      approvedMigrationPath: 'packages/brain/migrations/366_approved_contract_provenance_manifest.sql',
      currentMainMigrationPaths: [
        'packages/brain/migrations/365_executor_kind_kernel_process.sql',
        'packages/brain/migrations/366_unrelated_main_change.sql',
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'requires_re_gan',
      conflict: 'migration_number',
      migration_number: 366,
    });
  });
});
