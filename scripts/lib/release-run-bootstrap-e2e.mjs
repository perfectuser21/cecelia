#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import pg from 'pg';

import { sameArtifactVersions } from '../../packages/brain/src/orchestrator/release-run-contract.js';
import { resolveReleaseArtifactVersions } from '../../packages/brain/src/orchestrator/release-run-artifacts.js';
import {
  executeBootstrapE2EManifest,
  loadBootstrapE2EManifest,
  materializeBootstrapE2EManifest,
} from '../../packages/brain/src/orchestrator/release-run-bootstrap-e2e.js';

const action = process.argv[2];
const databaseUrl = process.env.KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL;
const bootstrapRunId = process.env.KERNEL_RELEASE_BOOTSTRAP_RUN_ID;
const repository = process.env.KERNEL_RELEASE_REPOSITORY;
const sourceHeadSha = process.env.KERNEL_RELEASE_SOURCE_HEAD_SHA;
const mergeSha = process.env.KERNEL_RELEASE_MERGE_SHA;
const deployRoot = process.env.KERNEL_RELEASE_BOOTSTRAP_DEPLOY_ROOT;
const outputFile = process.env.KERNEL_RELEASE_BOOTSTRAP_E2E_OUTPUT_FILE;

function required(value, code) {
  if (!value) throw new Error(code);
  return value;
}

function writePrivate(value) {
  required(outputFile, 'bootstrap_e2e_output_file_missing');
  writeFileSync(outputFile, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    flag: 'w',
    mode: 0o600,
  });
  chmodSync(outputFile, 0o600);
}

async function json(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`bootstrap_e2e_http_${response.status}`);
  return response.json();
}

async function loadLiveReadback(manifest, environment) {
  if (manifest.artifact_versions.some((artifact) => artifact.name !== 'brain')) {
    throw new Error('bootstrap_e2e_runtime_route_unavailable');
  }
  const baseUrl = environment === 'staging'
    ? (process.env.BRAIN_STAGING_URL || 'http://localhost:5222')
    : (process.env.BRAIN_URL || 'http://localhost:5221');
  const [health, full] = await Promise.all([
    json(`${baseUrl}/api/brain/health`),
    json(`${baseUrl}/api/brain/status/full`),
  ]);
  const brain = manifest.artifact_versions.find((artifact) => artifact.name === 'brain');
  if (
    health.status !== 'healthy'
    || health.git_sha !== manifest.merge_sha
    || health.version !== brain.version
    || full == null
    || full.error != null
  ) {
    throw new Error('bootstrap_e2e_live_readback_mismatch');
  }
  if (environment === 'production') {
    const status = await json(`${baseUrl}/api/brain/deploy/status`);
    if (
      status.status !== 'success'
      || status.release_run_id !== bootstrapRunId
      || status.merge_sha !== manifest.merge_sha
      || !sameArtifactVersions(status.deployed_artifact_versions, manifest.artifact_versions)
      || !/^sha256:[0-9a-f]{64}$/.test(status.deployed_image_digest || '')
      || !/^sha256:[0-9a-f]{64}$/.test(status.rollback_image_digest || '')
      || status.deployed_image_digest === status.rollback_image_digest
      || status.rollback_image_reference !== status.rollback_image_digest
      || !/^cecelia-brain:rollback-[0-9a-f]{12}$/.test(status.rollback_image_tag || '')
      || status.rollback_image_exists !== true
      || status.rollback_probe !== 'pass'
      || typeof status.rollback_command !== 'string'
      || !status.rollback_command.includes(
        status.rollback_image_tag.replace('cecelia-brain:', ''),
      )
    ) {
      throw new Error('bootstrap_e2e_production_readback_mismatch');
    }
  }
  return manifest.artifact_versions;
}

const pool = new pg.Pool({
  connectionString: required(databaseUrl, 'bootstrap_e2e_database_missing'),
  max: 1,
});

try {
  const client = await pool.connect();
  try {
    actionBlock: {
    if (action === 'materialize') {
      const artifactVersions = await resolveReleaseArtifactVersions(
        { merge_sha: required(mergeSha, 'bootstrap_e2e_merge_sha_missing') },
        {
          gitExecFile: (args) => execFileSync(
            'git',
            ['-C', required(deployRoot, 'bootstrap_e2e_deploy_root_missing'), ...args],
            { encoding: 'utf8' },
          ),
        },
      );
      const manifest = await materializeBootstrapE2EManifest(client, {
        bootstrap_run_id: required(bootstrapRunId, 'bootstrap_e2e_run_missing'),
        repository: required(repository, 'bootstrap_e2e_repository_missing'),
        source_head_sha: required(sourceHeadSha, 'bootstrap_e2e_source_sha_missing'),
        merge_sha: mergeSha,
        artifact_versions: artifactVersions,
      });
      writePrivate({
        manifest_id: manifest.id,
        manifest_digest: manifest.manifest_digest,
        scenarios_total: manifest.scenarios_total,
        artifact_versions: manifest.artifact_versions,
      });
    } else if (action === 'execute') {
      const environment = process.env.KERNEL_RELEASE_BOOTSTRAP_E2E_ENVIRONMENT;
      if (!['staging', 'production'].includes(environment)) {
        throw new Error('bootstrap_e2e_environment_invalid');
      }
      const attemptId = Number(process.env.KERNEL_RELEASE_BOOTSTRAP_EFFECT_ATTEMPT_ID);
      if (!Number.isSafeInteger(attemptId) || attemptId < 1) {
        throw new Error('bootstrap_e2e_attempt_invalid');
      }
      const manifest = await loadBootstrapE2EManifest(client, {
        bootstrap_run_id: required(bootstrapRunId, 'bootstrap_e2e_run_missing'),
        repository: required(repository, 'bootstrap_e2e_repository_missing'),
        merge_sha: required(mergeSha, 'bootstrap_e2e_merge_sha_missing'),
      });
      const existing = (await client.query(
        `SELECT receipt.id, receipt.e2e_manifest_digest,
                receipt.e2e_scenarios_total, receipt.e2e_scenarios_passed,
                receipt.e2e_environment
           FROM kernel_release_bootstrap_effect_receipts receipt
           JOIN kernel_release_bootstrap_effect_attempts attempt
             ON attempt.id = receipt.effect_attempt_id
          WHERE receipt.effect_attempt_id = $1
            AND receipt.receipt_status = 'confirmed'
            AND attempt.bootstrap_run_id = $2
            AND attempt.effect_kind = $3
            AND receipt.e2e_manifest_id = $4
            AND receipt.e2e_manifest_digest = $5`,
        [
          attemptId,
          bootstrapRunId,
          environment,
          manifest.id,
          manifest.manifest_digest,
        ],
      )).rows[0];
      if (existing) {
        writePrivate({
          receipt_id: String(existing.id),
          manifest_id: manifest.id,
          manifest_digest: existing.e2e_manifest_digest,
          scenarios_total: Number(existing.e2e_scenarios_total),
          scenarios_passed: Number(existing.e2e_scenarios_passed),
          environment: existing.e2e_environment,
        });
        break actionBlock;
      }
      const artifactReadback = await loadLiveReadback(manifest, environment);
      const receipt = await executeBootstrapE2EManifest(manifest, {
        environment,
        artifact_readback: artifactReadback,
        fetchFn: fetch,
        endpoints: {
          brain: environment === 'staging'
            ? (process.env.BRAIN_STAGING_URL || 'http://localhost:5222')
            : (process.env.BRAIN_URL || 'http://localhost:5221'),
          dashboard: environment === 'staging'
            ? (process.env.DASHBOARD_STAGING_URL || 'http://localhost:5212')
            : (process.env.DASHBOARD_URL || 'http://localhost:5211'),
        },
      });
      const inserted = await client.query(
        `INSERT INTO kernel_release_bootstrap_effect_receipts
           (effect_attempt_id, receipt_status, observed_merge_sha,
            observed_artifact_versions, e2e_manifest_id, e2e_manifest_digest,
            e2e_scenarios_total, e2e_scenarios_passed, e2e_environment,
            e2e_scenario_results, e2e_probe_results,
            e2e_started_at, e2e_finished_at, evidence)
         VALUES ($1, 'confirmed', $2, $3::jsonb, $4, $5, $6, $7, $8,
                 $9::jsonb, $10::jsonb, $11, $12, $13::jsonb)
         ON CONFLICT (effect_attempt_id)
           WHERE receipt_status = 'confirmed' DO NOTHING
         RETURNING id`,
        [
          attemptId,
          receipt.merge_sha,
          JSON.stringify(receipt.artifact_readback),
          manifest.id,
          receipt.manifest_digest,
          receipt.scenarios_total,
          receipt.scenarios_passed,
          receipt.environment,
          JSON.stringify(receipt.scenario_results),
          JSON.stringify(receipt.probe_results),
          receipt.started_at,
          receipt.finished_at,
          JSON.stringify({
            required_e2e: 'pass',
            merge_sha: receipt.merge_sha,
            artifact_readback: receipt.artifact_readback,
            e2e_probe_results: receipt.probe_results,
          }),
        ],
      );
      const receiptId = inserted.rows[0]?.id ?? (await client.query(
        `SELECT id
           FROM kernel_release_bootstrap_effect_receipts
          WHERE effect_attempt_id = $1
            AND receipt_status = 'confirmed'`,
        [attemptId],
      )).rows[0]?.id;
      if (!receiptId) throw new Error('bootstrap_e2e_receipt_missing');
      writePrivate({
        receipt_id: String(receiptId),
        manifest_id: manifest.id,
        manifest_digest: receipt.manifest_digest,
        scenarios_total: receipt.scenarios_total,
        scenarios_passed: receipt.scenarios_passed,
        environment,
      });
    } else {
      throw new Error('bootstrap_e2e_action_invalid');
    }
    }
  } finally {
    client.release();
  }
} catch (error) {
  process.stderr.write(`Kernel ReleaseRun bootstrap E2E denied: ${error?.code || error?.message || 'unknown'}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
