#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import pg from 'pg';

import { readBootstrapPrivateConfig } from './bootstrap-private-config.mjs';
import { sameArtifactVersions } from '../../packages/brain/src/orchestrator/release-run-contract.js';
import { resolveReleaseArtifactVersions } from '../../packages/brain/src/orchestrator/release-run-artifacts.js';
import {
  executeBootstrapE2EManifest,
  loadBootstrapE2EManifest,
  materializeBootstrapE2EManifest,
} from '../../packages/brain/src/orchestrator/release-run-bootstrap-e2e.js';

const action = process.argv[2];
const privateConfigFile =
  process.env.KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE;
const { database_url: databaseUrl } =
  readBootstrapPrivateConfig(privateConfigFile);
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

function exactReceiptAuthority(row) {
  return {
    effect_attempt_id: String(row.effect_attempt_id),
    receipt_status: row.receipt_status,
    observed_merge_sha: row.observed_merge_sha,
    observed_artifact_versions: row.observed_artifact_versions,
    e2e_manifest_id: row.e2e_manifest_id,
    e2e_manifest_digest: row.e2e_manifest_digest,
    e2e_scenarios_total: Number(row.e2e_scenarios_total),
    e2e_scenarios_passed: Number(row.e2e_scenarios_passed),
    e2e_environment: row.e2e_environment,
    e2e_scenario_results: row.e2e_scenario_results,
    e2e_probe_results: row.e2e_probe_results,
    e2e_started_at: new Date(row.e2e_started_at).toISOString(),
    e2e_finished_at: new Date(row.e2e_finished_at).toISOString(),
    evidence: row.evidence,
  };
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
  let productionStatus = null;
  if (environment === 'production') {
    productionStatus = await json(`${baseUrl}/api/brain/deploy/status`);
    if (
      productionStatus.status !== 'success'
      || productionStatus.release_run_id !== bootstrapRunId
      || productionStatus.merge_sha !== manifest.merge_sha
      || !sameArtifactVersions(
        productionStatus.deployed_artifact_versions,
        manifest.artifact_versions,
      )
      || !/^sha256:[0-9a-f]{64}$/.test(productionStatus.deployed_image_digest || '')
      || !/^sha256:[0-9a-f]{64}$/.test(productionStatus.rollback_image_digest || '')
      || productionStatus.deployed_image_digest === productionStatus.rollback_image_digest
      || productionStatus.rollback_image_reference
        !== productionStatus.rollback_image_digest
      || !/^cecelia-brain:rollback-[0-9a-f]{12}$/.test(
        productionStatus.rollback_image_tag || '',
      )
      || productionStatus.rollback_image_exists !== true
      || productionStatus.rollback_probe !== 'pass'
      || typeof productionStatus.rollback_command !== 'string'
      || !productionStatus.rollback_command.includes(
        productionStatus.rollback_image_tag.replace('cecelia-brain:', ''),
      )
    ) {
      throw new Error('bootstrap_e2e_production_readback_mismatch');
    }
  }
  return {
    artifactReadback: manifest.artifact_versions,
    productionStatus,
  };
}

async function appendBootstrapArtifactReceipts(client, {
  bootstrapRunId: runId,
  effectReceiptId,
  rollbackArtifacts,
}) {
  if (!Array.isArray(rollbackArtifacts)) return [];
  await client.query(
    `INSERT INTO kernel_release_bootstrap_rollback_artifact_receipts
       (rollback_artifact_intent_id, effect_receipt_id, observed_anchor,
        observed_previous_version, observed_previous_digest, rollback_metadata)
     SELECT intent.id, $2, observed.anchor, observed.previous_version,
            observed.previous_digest, observed.rollback_metadata
       FROM kernel_release_bootstrap_rollback_artifact_intents intent
       JOIN jsonb_to_recordset($3::jsonb) AS observed(
         artifact_name text,
         anchor text,
         previous_version text,
         previous_digest text,
         rollback_metadata jsonb
       ) ON observed.artifact_name = intent.artifact_name
      WHERE intent.bootstrap_run_id = $1
     ON CONFLICT (rollback_artifact_intent_id) DO NOTHING`,
    [runId, effectReceiptId, JSON.stringify(rollbackArtifacts)],
  );
  return (await client.query(
    `SELECT receipt.id
       FROM kernel_release_bootstrap_rollback_artifact_intents intent
       JOIN kernel_release_bootstrap_rollback_artifact_receipts receipt
         ON receipt.rollback_artifact_intent_id = intent.id
      WHERE intent.bootstrap_run_id = $1
        AND receipt.effect_receipt_id = $2
      ORDER BY intent.artifact_name`,
    [runId, effectReceiptId],
  )).rows.map((row) => String(row.id));
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
    } else if (action === 'prepare-rollback') {
      const manifest = await loadBootstrapE2EManifest(client, {
        bootstrap_run_id: required(bootstrapRunId, 'bootstrap_e2e_run_missing'),
        repository: required(repository, 'bootstrap_e2e_repository_missing'),
        merge_sha: required(mergeSha, 'bootstrap_e2e_merge_sha_missing'),
      });
      if (
        manifest.artifact_versions.length !== 1
        || manifest.artifact_versions[0].name !== 'brain'
      ) {
        throw new Error('bootstrap_rollback_runtime_route_unavailable');
      }
      const status = await json(
        `${process.env.BRAIN_URL || 'http://localhost:5221'}/api/brain/deploy/status`,
      );
      if (!/^sha256:[0-9a-f]{64}$/.test(status.deployed_image_digest ?? '')) {
        throw new Error('bootstrap_rollback_previous_digest_invalid');
      }
      const artifact = manifest.artifact_versions[0];
      await client.query(
        `INSERT INTO kernel_release_bootstrap_rollback_artifact_intents
           (bootstrap_run_id, artifact_name, expected_current_version,
            expected_current_digest, expected_anchor,
            expected_previous_version, expected_previous_digest)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (bootstrap_run_id, artifact_name) DO NOTHING`,
        [
          bootstrapRunId,
          artifact.name,
          artifact.version,
          artifact.digest,
          `${artifact.name}:${artifact.digest}`,
          `brain-image:${status.deployed_image_digest}`,
          status.deployed_image_digest,
        ],
      );
      const intents = (await client.query(
        `SELECT id
           FROM kernel_release_bootstrap_rollback_artifact_intents
          WHERE bootstrap_run_id = $1
          ORDER BY artifact_name`,
        [bootstrapRunId],
      )).rows;
      if (intents.length !== manifest.artifact_versions.length) {
        throw new Error('bootstrap_rollback_artifact_intents_incomplete');
      }
      writePrivate({
        artifact_rollback_intent_ids: intents.map((intent) => String(intent.id)),
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
        `SELECT receipt.id, receipt.observed_artifact_versions,
                receipt.e2e_manifest_digest,
                receipt.e2e_scenarios_total, receipt.e2e_scenarios_passed,
                receipt.e2e_environment, receipt.evidence
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
        const artifactReceiptIds = await appendBootstrapArtifactReceipts(client, {
          bootstrapRunId,
          effectReceiptId: existing.id,
          rollbackArtifacts: existing.evidence?.rollback_artifacts,
        });
        writePrivate({
          receipt_id: String(existing.id),
          manifest_id: manifest.id,
          manifest_digest: existing.e2e_manifest_digest,
          scenarios_total: Number(existing.e2e_scenarios_total),
          scenarios_passed: Number(existing.e2e_scenarios_passed),
          environment: existing.e2e_environment,
          artifact_versions: existing.observed_artifact_versions,
          receipt_evidence: existing.evidence,
          artifact_rollback_receipt_ids: artifactReceiptIds,
        });
        break actionBlock;
      }
      const { artifactReadback, productionStatus } =
        await loadLiveReadback(manifest, environment);
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
      let rollbackArtifacts = null;
      if (environment === 'production') {
        const intents = (await client.query(
          `SELECT *
             FROM kernel_release_bootstrap_rollback_artifact_intents
            WHERE bootstrap_run_id = $1
            ORDER BY artifact_name`,
          [bootstrapRunId],
        )).rows;
        if (
          intents.length !== 1
          || intents[0].artifact_name !== 'brain'
          || intents[0].expected_previous_digest
            !== productionStatus.rollback_image_digest
        ) {
          throw new Error('bootstrap_rollback_readback_mismatch');
        }
        const brain = manifest.artifact_versions[0];
        rollbackArtifacts = [{
          artifact_name: 'brain',
          current_version: brain.version,
          current_digest: brain.digest,
          anchor: `brain:${brain.digest}`,
          previous_version:
            `brain-image:${productionStatus.rollback_image_digest}`,
          previous_digest: productionStatus.rollback_image_digest,
          rollback_metadata: {
            image_reference: productionStatus.rollback_image_reference,
            image_tag: productionStatus.rollback_image_tag,
            rollback_command: productionStatus.rollback_command,
            probe: productionStatus.rollback_probe,
          },
        }];
      }
      const receiptEvidence = {
        required_e2e: 'pass',
        merge_sha: receipt.merge_sha,
        artifact_readback: receipt.artifact_readback,
        e2e_probe_results: receipt.probe_results,
        ...(rollbackArtifacts == null ? {} : { rollback_artifacts: rollbackArtifacts }),
      };
      await client.query(
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
          JSON.stringify(receiptEvidence),
        ],
      );
      const persistedReceipt = (await client.query(
        `SELECT id, effect_attempt_id, receipt_status, observed_merge_sha,
                observed_artifact_versions, e2e_manifest_id,
                e2e_manifest_digest, e2e_scenarios_total,
                e2e_scenarios_passed, e2e_environment,
                e2e_scenario_results, e2e_probe_results,
                e2e_started_at, e2e_finished_at, evidence
           FROM kernel_release_bootstrap_effect_receipts
          WHERE effect_attempt_id = $1
            AND receipt_status = 'confirmed'`,
        [attemptId],
      )).rows[0];
      if (!persistedReceipt) throw new Error('bootstrap_e2e_receipt_missing');
      const expectedAuthority = {
        effect_attempt_id: String(attemptId),
        receipt_status: 'confirmed',
        observed_merge_sha: receipt.merge_sha,
        observed_artifact_versions: receipt.artifact_readback,
        e2e_manifest_id: manifest.id,
        e2e_manifest_digest: receipt.manifest_digest,
        e2e_scenarios_total: receipt.scenarios_total,
        e2e_scenarios_passed: receipt.scenarios_passed,
        e2e_environment: receipt.environment,
        e2e_scenario_results: receipt.scenario_results,
        e2e_probe_results: receipt.probe_results,
        e2e_started_at: new Date(receipt.started_at).toISOString(),
        e2e_finished_at: new Date(receipt.finished_at).toISOString(),
        evidence: receiptEvidence,
      };
      if (!isDeepStrictEqual(
        exactReceiptAuthority(persistedReceipt),
        expectedAuthority,
      )) {
        throw new Error('bootstrap_e2e_receipt_conflict');
      }
      const receiptId = persistedReceipt.id;
      const artifactReceiptIds = await appendBootstrapArtifactReceipts(client, {
        bootstrapRunId,
        effectReceiptId: receiptId,
        rollbackArtifacts: persistedReceipt.evidence?.rollback_artifacts,
      });
      writePrivate({
        receipt_id: String(receiptId),
        manifest_id: manifest.id,
        manifest_digest: receipt.manifest_digest,
        scenarios_total: receipt.scenarios_total,
        scenarios_passed: receipt.scenarios_passed,
        environment,
        artifact_versions: persistedReceipt.observed_artifact_versions,
        receipt_evidence: persistedReceipt.evidence,
        artifact_rollback_receipt_ids: artifactReceiptIds,
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
