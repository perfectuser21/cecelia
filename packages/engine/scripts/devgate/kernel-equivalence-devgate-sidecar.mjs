import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Canonical } from '../../../brain/src/lib/kernel-equivalence-receipts.js';

const SEAM_ID = 'kernel.quality.devgate';
const TDD_SCRIPT = fileURLToPath(
  new URL('./check-tdd-commit-order.sh', import.meta.url),
);
const DOD_SCRIPT = fileURLToPath(
  new URL('./check-dod-purity.cjs', import.meta.url),
);
const OUTPUT_LIMIT = 64 * 1024;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const EFFECTS = Object.freeze({
  normal: Object.freeze({
    expected_pass: true,
    observed_outcome: 'confirmed',
    effect_code: 'devgate_admission_confirmed',
  }),
  violation: Object.freeze({
    expected_pass: false,
    observed_outcome: 'denied',
    effect_code: 'devgate_invalid_evidence_denied',
  }),
  recovery: Object.freeze({
    expected_pass: true,
    observed_outcome: 'recovered',
    effect_code: 'corrected_devgate_admission_confirmed',
  }),
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeRef(value) {
  return (
    typeof value === 'string'
    && REF_PATTERN.test(value)
    && !value.includes('..')
  );
}

function targetWithinWorkspace(target) {
  const workspacePath = target?.workspace_path;
  const dodPath = target?.dod_path;
  if (
    typeof workspacePath !== 'string'
    || !isAbsolute(workspacePath)
    || typeof dodPath !== 'string'
    || !isAbsolute(dodPath)
    || !safeRef(target?.base_ref)
    || !safeRef(target?.head_ref)
  ) {
    return false;
  }
  const workspace = resolve(workspacePath);
  const relativeDod = relative(workspace, resolve(dodPath));
  return (
    relativeDod.length > 0
    && !relativeDod.startsWith('..')
    && !isAbsolute(relativeDod)
    && /^contract-dod-ws[0-9]+\.md$/.test(basename(relativeDod))
  );
}

function targetMatchesGrant(target, grant) {
  return (
    target?.run_id === grant?.run_id
    && target?.attempt_id === grant?.attempt_id
    && target?.resource_id === grant?.resource_id
    && target?.resource_ref === grant?.resource_ref
  );
}

function boundedAppend(current, chunk) {
  const next = current + String(chunk);
  return next.length > OUTPUT_LIMIT
    ? next.slice(next.length - OUTPUT_LIMIT)
    : next;
}

function abortError() {
  return Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function defaultSpawnGuarded({
  executable,
  args,
  cwd,
  env,
  signal,
}) {
  throwIfAborted(signal);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let aborted = false;
    child.stdout.on('data', (chunk) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = boundedAppend(stderr, chunk);
    });
    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => {
      signal?.removeEventListener('abort', onAbort);
      rejectPromise(aborted ? abortError() : error);
    });
    child.once('close', (code, childSignal) => {
      signal?.removeEventListener('abort', onAbort);
      if (aborted) {
        rejectPromise(abortError());
        return;
      }
      resolvePromise({
        exit_code: Number.isInteger(code) ? code : 1,
        stdout,
        stderr,
        signal: childSignal ?? null,
      });
    });
  });
}

function childEnvironment(target) {
  return Object.freeze({
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    BASE_REF: target.base_ref,
    HEAD_REF: target.head_ref,
  });
}

async function invokeChild(spawnGuarded, command) {
  const result = await spawnGuarded(command);
  throwIfAborted(command.signal);
  if (
    !result
    || !Number.isInteger(result.exit_code)
    || typeof result.stdout !== 'string'
    || typeof result.stderr !== 'string'
  ) {
    fail('devgate_sidecar_result_invalid');
  }
  return result;
}

async function gitHead(spawnGuarded, target, signal) {
  const result = await invokeChild(spawnGuarded, {
    executable: 'git',
    args: ['rev-parse', '--verify', 'HEAD'],
    cwd: target.workspace_path,
    env: childEnvironment(target),
    signal,
  });
  if (result.exit_code !== 0) fail('devgate_snapshot_unavailable');
  return result.stdout.trim();
}

function assertPredecessor(scenario, predecessor) {
  if (scenario !== 'recovery') {
    if (predecessor !== null) fail('devgate_predecessor_invalid');
    return;
  }
  if (
    !predecessor?.grant?.grant_id
    || !predecessor?.receipt?.receipt_id
  ) {
    fail('devgate_predecessor_invalid');
  }
}

export function createDevGateEquivalenceSeam({
  effectSigner,
  devgateAuthority,
  spawnGuarded = defaultSpawnGuarded,
} = {}) {
  if (typeof effectSigner?.signEffectResult !== 'function') {
    fail('seam_effect_signer_unavailable');
  }
  if (
    devgateAuthority?.owner_service !== SEAM_ID
    || typeof devgateAuthority?.loadTarget !== 'function'
  ) {
    fail('devgate_authority_port_unavailable');
  }
  if (typeof spawnGuarded !== 'function') {
    fail('devgate_sidecar_port_unavailable');
  }

  return Object.freeze({
    owner_service: SEAM_ID,

    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    }) {
      throwIfAborted(signal);
      if (
        cell?.seam_id !== SEAM_ID
        || resource?.resource_id !== grant?.resource_id
        || resource?.resource_ref !== grant?.resource_ref
      ) {
        fail('devgate_equivalence_resource_invalid');
      }
      const effect = EFFECTS[cell.scenario];
      if (!effect) fail('devgate_equivalence_scenario_invalid');
      assertPredecessor(cell.scenario, predecessor);

      const authorityResource = Object.freeze({
        resource_id: resource.resource_id,
        resource_ref: resource.resource_ref,
      });
      const target = await devgateAuthority.loadTarget({
        cell,
        grant,
        resource: authorityResource,
        signal,
      });
      throwIfAborted(signal);
      if (!targetMatchesGrant(target, grant)) {
        fail('devgate_equivalence_authority_binding_invalid');
      }
      if (!targetWithinWorkspace(target)) {
        fail('devgate_equivalence_resource_invalid');
      }

      const beforeHead = await gitHead(spawnGuarded, target, signal);
      if (beforeHead !== grant.artifact_sha) {
        fail('devgate_equivalence_artifact_mismatch');
      }
      const env = childEnvironment(target);
      const tdd = await invokeChild(spawnGuarded, {
        executable: '/bin/bash',
        args: [TDD_SCRIPT],
        cwd: target.workspace_path,
        env,
        signal,
      });
      const dod = await invokeChild(spawnGuarded, {
        executable: process.execPath,
        args: [DOD_SCRIPT, target.dod_path],
        cwd: target.workspace_path,
        env,
        signal,
      });
      const dodSource = await readFile(target.dod_path, 'utf8');
      throwIfAborted(signal);
      const dodComplete = !/^\s*-\s+\[\s\]/m.test(dodSource);
      const passed = (
        tdd.exit_code === 0
        && dod.exit_code === 0
        && dodComplete
      );
      if (passed !== effect.expected_pass) {
        fail('devgate_equivalence_outcome_unexpected');
      }
      const afterHead = await gitHead(spawnGuarded, target, signal);
      throwIfAborted(signal);
      if (afterHead !== grant.artifact_sha) {
        fail('devgate_equivalence_artifact_mismatch');
      }

      return effectSigner.signEffectResult({
        cell,
        grant,
        observation: {
          observed_outcome: effect.observed_outcome,
          effect_code: effect.effect_code,
          before_hash: sha256Canonical({
            head: beforeHead,
            base_ref: target.base_ref,
          }),
          after_hash: sha256Canonical({
            head: afterHead,
            tdd_exit_code: tdd.exit_code,
            dod_exit_code: dod.exit_code,
            dod_complete: dodComplete,
          }),
        },
        predecessor,
      });
    },

    async cancel({ signal } = {}) {
      return { confirmed: signal?.aborted === true };
    },

    async cleanup() {
      return { confirmed: true };
    },
  });
}
