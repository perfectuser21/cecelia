#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_PATTERN = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const ARTIFACT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PURPOSE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const INPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN_INPUT_KEY = /(secret|token|password|credential|authorization)/i;
const EXTRACTOR_PATH = path.join(__dirname, 'github-evidence-extract.py');
const DEFAULT_CAPSULE_LIMITS = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxExtractedBytes: 1024 * 1024 * 1024,
  maxExtractedFiles: 4096,
});

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validateDispatchInputs(inputs) {
  if (inputs == null) return {};
  if (!isPlainObject(inputs) || Object.keys(inputs).length > 16) {
    fail('github_evidence_request_invalid');
  }
  const normalized = {};
  for (const [key, rawValue] of Object.entries(inputs)) {
    if (!INPUT_KEY_PATTERN.test(key) || FORBIDDEN_INPUT_KEY.test(key)) {
      fail('github_evidence_request_invalid');
    }
    const value = String(rawValue);
    if (value.length > 512 || /[\0\r\n]/.test(value)) {
      fail('github_evidence_request_invalid');
    }
    normalized[key] = value;
  }
  return normalized;
}

function validateEvidenceRequest(envelope) {
  const bundle = envelope?.task_bundle;
  const inputs = bundle?.inputs;
  const request = inputs?.github_evidence_request;
  if (bundle?.role !== 'evaluator' || !isPlainObject(inputs) || !isPlainObject(request)) {
    fail('github_evidence_request_invalid');
  }
  if (
    request.contract_version !== 'github-evidence-request/v1'
    || !REPO_PATTERN.test(request.repo ?? '')
    || request.repo.split('/').some((part) => part === '.' || part === '..')
    || !Number.isSafeInteger(request.pr_number)
    || request.pr_number <= 0
    || !SHA_PATTERN.test(request.expected_head_sha ?? '')
    || !Array.isArray(request.runs)
    || request.runs.length === 0
    || request.runs.length > 8
  ) {
    fail('github_evidence_request_invalid');
  }
  if (
    request.repo !== inputs.workspace_spec?.repo
    || request.pr_number !== inputs.pull_request?.number
    || request.expected_head_sha !== inputs.pr_head_sha
  ) {
    fail('github_evidence_identity_mismatch');
  }

  const runs = request.runs.map((run) => {
    if (
      !isPlainObject(run)
      || !PURPOSE_PATTERN.test(run.purpose ?? '')
      || !['existing', 'dispatch'].includes(run.mode)
      || !WORKFLOW_PATTERN.test(run.workflow ?? '')
      || !Array.isArray(run.artifacts)
      || run.artifacts.length === 0
      || run.artifacts.length > 16
      || !run.artifacts.every((name) => ARTIFACT_PATTERN.test(name))
      || new Set(run.artifacts).size !== run.artifacts.length
    ) {
      fail('github_evidence_request_invalid');
    }
    if (run.mode === 'existing') {
      if (!Number.isSafeInteger(run.run_id) || run.run_id <= 0 || run.inputs != null) {
        fail('github_evidence_request_invalid');
      }
      return {
        purpose: run.purpose,
        mode: run.mode,
        run_id: run.run_id,
        workflow: run.workflow,
        artifacts: [...run.artifacts],
      };
    }
    if (
      typeof run.ref !== 'string'
      || run.ref !== inputs.pr_branch
      || run.ref.length > 255
      || run.ref.startsWith('-')
      || /[\0\r\n~^:?*[\\]/.test(run.ref)
      || run.ref.includes('..')
    ) {
      fail('github_evidence_identity_mismatch');
    }
    const dispatchInputs = validateDispatchInputs(run.inputs);
    if (
      !INPUT_KEY_PATTERN.test(run.correlation_input ?? '')
      || FORBIDDEN_INPUT_KEY.test(run.correlation_input)
      || Object.prototype.hasOwnProperty.call(dispatchInputs, run.correlation_input)
    ) {
      fail('github_evidence_request_invalid');
    }
    return {
      purpose: run.purpose,
      mode: run.mode,
      workflow: run.workflow,
      ref: run.ref,
      correlation_input: run.correlation_input,
      inputs: dispatchInputs,
      artifacts: [...run.artifacts],
    };
  });
  if (new Set(runs.map((run) => run.purpose)).size !== runs.length) {
    fail('github_evidence_request_invalid');
  }
  return { ...request, runs };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeCapsuleDir(capsuleDir) {
  const absolute = path.resolve(capsuleDir);
  if (!path.isAbsolute(capsuleDir) || absolute === path.parse(absolute).root) {
    fail('github_evidence_capsule_path_invalid');
  }
  return absolute;
}

function canonicalWorkflowPath(value) {
  return String(value ?? '').replace(/^\//, '');
}

async function resolveRun({ github, request, runRequest }) {
  if (runRequest.mode === 'existing') {
    return github.getRun(request.repo, runRequest.run_id);
  }
  return github.dispatchAndWait({
    repo: request.repo,
    workflow: runRequest.workflow,
    ref: runRequest.ref,
    inputs: runRequest.inputs,
    correlationInput: runRequest.correlation_input,
    expectedHeadSha: request.expected_head_sha,
  });
}

function extractDownloadedArtifact({
  archivePath,
  capsuleDir,
  purpose,
  artifactName,
  extractorPath = EXTRACTOR_PATH,
}) {
  const result = spawnSync('python3', [
    extractorPath,
    archivePath,
    capsuleDir,
    purpose,
    artifactName,
  ], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
  if (result.status !== 0) fail('github_evidence_archive_rejected');
  try {
    const files = JSON.parse(result.stdout);
    if (!Array.isArray(files) || files.length === 0) {
      fail('github_evidence_archive_rejected');
    }
    return files;
  } catch {
    fail('github_evidence_archive_rejected');
  }
}

async function collectEvidenceCapsule({
  envelope,
  capsuleDir,
  github,
  collectedAt = new Date().toISOString(),
  capsuleLimits = DEFAULT_CAPSULE_LIMITS,
}) {
  if (!isPlainObject(capsuleLimits)
      || !['maxArchiveBytes', 'maxExtractedBytes', 'maxExtractedFiles']
        .every((key) => Number.isSafeInteger(capsuleLimits[key])
          && capsuleLimits[key] > 0)) {
    fail('github_evidence_capsule_budget_invalid');
  }
  const request = validateEvidenceRequest(envelope);
  const absoluteCapsuleDir = safeCapsuleDir(capsuleDir);
  fs.mkdirSync(absoluteCapsuleDir, { recursive: true, mode: 0o700 });
  const pullRequest = await github.getPullRequest(request.repo, request.pr_number);
  if (pullRequest?.number !== request.pr_number
      || pullRequest?.state !== 'open'
      || pullRequest?.head?.sha !== request.expected_head_sha) {
    fail('github_evidence_pr_head_mismatch');
  }

  const manifestRuns = [];
  const capsuleTotals = {
    archive_bytes: 0,
    extracted_bytes: 0,
    extracted_files: 0,
  };
  for (const runRequest of request.runs) {
    const run = await resolveRun({ github, request, runRequest });
    if (run?.head_sha !== request.expected_head_sha) {
      fail('github_evidence_run_head_mismatch');
    }
    if (run?.status !== 'completed' || run?.conclusion !== 'success') {
      fail('github_evidence_run_not_successful');
    }
    if (canonicalWorkflowPath(run.path) !== runRequest.workflow) {
      fail('github_evidence_workflow_mismatch');
    }
    if (runRequest.mode === 'dispatch' && (
      run.cecelia_correlation?.input !== runRequest.correlation_input
      || run.cecelia_correlation?.run_name !== run.display_title
    )) {
      fail('github_evidence_dispatch_correlation_mismatch');
    }
    const availableArtifacts = await github.listArtifacts(request.repo, run.id);
    const artifacts = [];
    for (const expectedName of runRequest.artifacts) {
      const matches = availableArtifacts.filter((item) => item.name === expectedName);
      if (matches.length !== 1 || matches[0].expired) {
        fail('github_evidence_artifact_missing');
      }
      const bytes = await github.downloadArtifact(request.repo, matches[0].id);
      capsuleTotals.archive_bytes += bytes.length;
      if (capsuleTotals.archive_bytes > capsuleLimits.maxArchiveBytes) {
        fail('github_evidence_capsule_budget_exceeded');
      }
      const relativePath = path.posix.join(
        runRequest.purpose,
        `${expectedName}.zip`,
      );
      const outputPath = path.join(absoluteCapsuleDir, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(outputPath, bytes, { mode: 0o400 });
      const extractedFiles = extractDownloadedArtifact({
        archivePath: outputPath,
        capsuleDir: absoluteCapsuleDir,
        purpose: runRequest.purpose,
        artifactName: expectedName,
      });
      capsuleTotals.extracted_bytes += extractedFiles.reduce(
        (total, file) => total + file.size,
        0,
      );
      capsuleTotals.extracted_files += extractedFiles.length;
      if (capsuleTotals.extracted_bytes > capsuleLimits.maxExtractedBytes
          || capsuleTotals.extracted_files > capsuleLimits.maxExtractedFiles) {
        fail('github_evidence_capsule_budget_exceeded');
      }
      artifacts.push({
        id: matches[0].id,
        name: expectedName,
        path: relativePath,
        size: bytes.length,
        sha256: sha256(bytes),
        extracted_files: extractedFiles,
      });
    }
    manifestRuns.push({
      purpose: runRequest.purpose,
      mode: runRequest.mode,
      run_id: run.id,
      workflow: runRequest.workflow,
      head_sha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url ?? null,
      correlation: runRequest.mode === 'dispatch'
        ? run.cecelia_correlation
        : null,
      artifacts,
    });
  }

  const finalPullRequest = await github.getPullRequest(
    request.repo,
    request.pr_number,
  );
  if (finalPullRequest?.number !== request.pr_number
      || finalPullRequest?.state !== 'open'
      || finalPullRequest?.head?.sha !== request.expected_head_sha) {
    fail('github_evidence_pr_head_mismatch');
  }

  const manifest = {
    contract_version: 'github-evidence-capsule/v1',
    repo: request.repo,
    pr_number: request.pr_number,
    expected_head_sha: request.expected_head_sha,
    collected_at: collectedAt,
    budget: {
      limits: {
        archive_bytes: capsuleLimits.maxArchiveBytes,
        extracted_bytes: capsuleLimits.maxExtractedBytes,
        extracted_files: capsuleLimits.maxExtractedFiles,
      },
      totals: capsuleTotals,
    },
    runs: manifestRuns,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestPath = path.join(absoluteCapsuleDir, 'manifest.json');
  fs.writeFileSync(manifestPath, manifestBytes, { mode: 0o400 });
  return {
    manifest,
    manifestPath,
    manifestDigest: sha256(manifestBytes),
  };
}

function verifyEvidenceCapsule({ capsuleDir, expectedManifestDigest }) {
  const absoluteCapsuleDir = safeCapsuleDir(capsuleDir);
  if (!/^[a-f0-9]{64}$/.test(expectedManifestDigest ?? '')) {
    fail('github_evidence_capsule_tampered');
  }
  const manifestPath = path.join(absoluteCapsuleDir, 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  if (sha256(manifestBytes) !== expectedManifestDigest) {
    fail('github_evidence_capsule_tampered');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const verifiedTotals = {
    archive_bytes: 0,
    extracted_bytes: 0,
    extracted_files: 0,
  };
  const seenPaths = new Set();
  for (const run of manifest.runs ?? []) {
    for (const artifact of run.artifacts ?? []) {
      if (!ARTIFACT_PATTERN.test(artifact.name ?? '')) {
        fail('github_evidence_capsule_tampered');
      }
      const artifactPath = path.resolve(absoluteCapsuleDir, artifact.path ?? '');
      if (!artifactPath.startsWith(`${absoluteCapsuleDir}${path.sep}`)) {
        fail('github_evidence_capsule_tampered');
      }
      const bytes = fs.readFileSync(artifactPath);
      verifiedTotals.archive_bytes += bytes.length;
      if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) {
        fail('github_evidence_capsule_tampered');
      }
      if (!Array.isArray(artifact.extracted_files)
          || artifact.extracted_files.length === 0) {
        fail('github_evidence_capsule_tampered');
      }
      const expectedPrefix = path.posix.join(
        'extracted',
        run.purpose,
        artifact.name,
      );
      for (const extracted of artifact.extracted_files) {
        if (typeof extracted.path !== 'string'
            || !extracted.path.startsWith(`${expectedPrefix}/`)
            || !Number.isSafeInteger(extracted.size)
            || extracted.size < 0
            || !/^[a-f0-9]{64}$/.test(extracted.sha256 ?? '')
            || seenPaths.has(extracted.path)) {
          fail('github_evidence_capsule_tampered');
        }
        seenPaths.add(extracted.path);
        const extractedPath = path.resolve(
          absoluteCapsuleDir,
          ...extracted.path.split('/'),
        );
        if (!extractedPath.startsWith(`${absoluteCapsuleDir}${path.sep}`)) {
          fail('github_evidence_capsule_tampered');
        }
        const extractedBytes = fs.readFileSync(extractedPath);
        verifiedTotals.extracted_bytes += extractedBytes.length;
        verifiedTotals.extracted_files += 1;
        if (extractedBytes.length !== extracted.size
            || sha256(extractedBytes) !== extracted.sha256) {
          fail('github_evidence_capsule_tampered');
        }
      }
    }
  }
  const budget = manifest.budget;
  if (!isPlainObject(budget?.limits)
      || !isPlainObject(budget?.totals)
      || !Object.entries(verifiedTotals).every(([key, value]) => (
        budget.totals[key] === value
        && Number.isSafeInteger(budget.limits[key])
        && budget.limits[key] > 0
        && value <= budget.limits[key]
      ))) {
    fail('github_evidence_capsule_tampered');
  }
  return true;
}

function runGh(args, { binary = false } = {}) {
  const result = spawnSync('gh', args, {
    encoding: binary ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  if (result.status !== 0) fail('github_evidence_github_api_failed');
  return result.stdout;
}

function ghJson(endpoint) {
  return JSON.parse(runGh(['api', endpoint]));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createGhClient({
  timeoutSeconds = 3600,
  pollMilliseconds = 5000,
  ghJsonFn = ghJson,
  runGhFn = runGh,
  nonceFactory = () => crypto.randomBytes(24).toString('hex'),
} = {}) {
  return {
    async getPullRequest(repo, number) {
      return ghJsonFn(`repos/${repo}/pulls/${number}`);
    },
    async getRun(repo, runId) {
      return ghJsonFn(`repos/${repo}/actions/runs/${runId}`);
    },
    async listArtifacts(repo, runId) {
      return ghJsonFn(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`).artifacts ?? [];
    },
    async downloadArtifact(repo, artifactId) {
      return runGhFn([
        'api',
        `repos/${repo}/actions/artifacts/${artifactId}/zip`,
        '-H',
        'Accept: application/vnd.github+json',
      ], { binary: true });
    },
    async dispatchAndWait({
      repo,
      workflow,
      ref,
      inputs,
      correlationInput,
      expectedHeadSha,
    }) {
      const workflowName = path.posix.basename(workflow);
      const listEndpoint = `repos/${repo}/actions/workflows/${workflowName}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=30`;
      const nonce = nonceFactory();
      if (!/^[a-f0-9]{48}$/.test(nonce)
          || !INPUT_KEY_PATTERN.test(correlationInput ?? '')) {
        fail('github_evidence_dispatch_correlation_invalid');
      }
      const runName = `cecelia-${nonce}`;
      const previousIds = new Set((ghJsonFn(listEndpoint).workflow_runs ?? []).map((run) => run.id));
      const args = ['workflow', 'run', workflowName, '--repo', repo, '--ref', ref];
      for (const [key, value] of Object.entries({
        ...inputs,
        [correlationInput]: runName,
      })) args.push('-f', `${key}=${value}`);
      runGhFn(args);
      const deadline = Date.now() + timeoutSeconds * 1000;
      let selected = null;
      while (Date.now() < deadline) {
        const candidates = (ghJsonFn(listEndpoint).workflow_runs ?? []).filter(
          (run) => !previousIds.has(run.id)
            && run.head_sha === expectedHeadSha
            && run.display_title === runName,
        );
        if (candidates.length > 1) fail('github_evidence_dispatch_ambiguous');
        if (candidates.length === 1) {
          selected = candidates[0];
          break;
        }
        await sleep(pollMilliseconds);
      }
      if (!selected) fail('github_evidence_dispatch_not_found');
      while (Date.now() < deadline) {
        const current = ghJsonFn(`repos/${repo}/actions/runs/${selected.id}`);
        if (current.display_title !== runName) {
          fail('github_evidence_dispatch_correlation_mismatch');
        }
        if (current.status === 'completed') {
          return {
            ...current,
            cecelia_correlation: {
              input: correlationInput,
              run_name: runName,
            },
          };
        }
        await sleep(pollMilliseconds);
      }
      fail('github_evidence_dispatch_timeout');
    },
  };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith('--') || rest[index + 1] == null) {
      fail('github_evidence_cli_invalid');
    }
    options[rest[index].slice(2)] = rest[index + 1];
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));
  if (command === 'collect') {
    if (!options.bundle || !options.capsule) fail('github_evidence_cli_invalid');
    const envelope = JSON.parse(fs.readFileSync(options.bundle, 'utf8'));
    const result = await collectEvidenceCapsule({
      envelope,
      capsuleDir: options.capsule,
      github: createGhClient(),
    });
    process.stdout.write(`${result.manifestDigest}\n`);
    return;
  }
  if (command === 'verify') {
    verifyEvidenceCapsule({
      capsuleDir: options.capsule,
      expectedManifestDigest: options['expected-digest'],
    });
    return;
  }
  fail('github_evidence_cli_invalid');
}

module.exports = {
  collectEvidenceCapsule,
  createGhClient,
  extractDownloadedArtifact,
  validateEvidenceRequest,
  verifyEvidenceCapsule,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[github-evidence-preflight] ${error.message}\n`);
    process.exitCode = 1;
  });
}
