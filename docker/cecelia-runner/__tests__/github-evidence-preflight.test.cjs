const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  collectEvidenceCapsule,
  createGhClient,
  extractDownloadedArtifact,
  validateEvidenceRequest,
  verifyEvidenceCapsule,
} = require('../github-evidence-preflight.cjs');

const HEAD_SHA = 'b8be843d8a35064690a40e885eb235fc8523ea62';

function zipBytes(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-evidence-zip-'));
  const archive = path.join(root, 'artifact.zip');
  const result = spawnSync('python3', [
    '-c',
    'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:\n  for name, content in json.loads(sys.argv[2]).items(): z.writestr(name, content.encode())',
    archive,
    JSON.stringify(entries),
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
  const bytes = fs.readFileSync(archive);
  fs.rmSync(root, { recursive: true, force: true });
  return bytes;
}

function request(overrides = {}) {
  return {
    contract_version: 'github-evidence-request/v1',
    repo: 'perfectuser21/zenithjoy-workspace',
    pr_number: 1571,
    expected_head_sha: HEAD_SHA,
    runs: [{
      purpose: 'windows_cancel',
      mode: 'existing',
      run_id: 30694126825,
      workflow: '.github/workflows/e2e-orphan-consolidation-windows.yml',
      artifacts: ['windows-cancel-evidence-30694126825-1'],
    }],
    ...overrides,
  };
}

const envelope = (evidenceRequest = request()) => ({
  task_bundle: {
    role: 'evaluator',
    inputs: {
      pr_head_sha: HEAD_SHA,
      pr_branch: 'cp-android-cancel',
      pull_request: { number: 1571 },
      workspace_spec: { repo: 'perfectuser21/zenithjoy-workspace' },
      github_evidence_request: evidenceRequest,
    },
  },
});

async function main() {
  assert.deepEqual(
    validateEvidenceRequest(envelope()),
    request(),
    'valid request should survive canonical validation',
  );

  for (const invalid of [
    request({ expected_head_sha: 'a'.repeat(40) }),
    request({ repo: 'attacker/repo' }),
    request({ pr_number: 1572 }),
    request({ runs: [{ ...request().runs[0], artifacts: ['../token'] }] }),
    request({ runs: [{ ...request().runs[0], inputs: { api_token: 'secret' } }] }),
  ]) {
    assert.throws(
      () => validateEvidenceRequest(envelope(invalid)),
      /github_evidence_request_invalid|github_evidence_identity_mismatch/,
    );
  }

  const dispatchRun = {
    purpose: 'android_cancel',
    mode: 'dispatch',
    workflow: '.github/workflows/e2e-line02-android-collect.yml',
    ref: 'cp-android-cancel',
    correlation_input: 'attempt_marker',
    inputs: { scenario: 'cancel', repeat: '2' },
    artifacts: ['android-cancel-evidence'],
  };
  assert.equal(
    validateEvidenceRequest(envelope(request({ runs: [dispatchRun] })))
      .runs[0].correlation_input,
    'attempt_marker',
  );
  assert.throws(
    () => validateEvidenceRequest(envelope(request({
      runs: [{ ...dispatchRun, correlation_input: undefined }],
    }))),
    /github_evidence_request_invalid/,
  );

  let listCalls = 0;
  const ghCalls = [];
  const correlatedClient = createGhClient({
    timeoutSeconds: 1,
    pollMilliseconds: 0,
    nonceFactory: () => '0123456789abcdef0123456789abcdef0123456789abcdef',
    runGhFn: (args) => {
      ghCalls.push(args);
      return '';
    },
    ghJsonFn: (endpoint) => {
      if (endpoint.includes('/runs?')) {
        listCalls += 1;
        if (listCalls === 1) return { workflow_runs: [{ id: 1 }] };
        return {
          workflow_runs: [
            { id: 2, head_sha: HEAD_SHA, display_title: 'attacker-run' },
            {
              id: 3,
              head_sha: HEAD_SHA,
              display_title: 'cecelia-0123456789abcdef0123456789abcdef0123456789abcdef',
            },
          ],
        };
      }
      if (endpoint.endsWith('/actions/runs/3')) {
        return {
          id: 3,
          head_sha: HEAD_SHA,
          display_title: 'cecelia-0123456789abcdef0123456789abcdef0123456789abcdef',
          status: 'completed',
          conclusion: 'success',
        };
      }
      throw new Error(`unexpected endpoint ${endpoint}`);
    },
  });
  const correlatedRun = await correlatedClient.dispatchAndWait({
    repo: 'perfectuser21/zenithjoy-workspace',
    workflow: dispatchRun.workflow,
    ref: dispatchRun.ref,
    inputs: dispatchRun.inputs,
    correlationInput: dispatchRun.correlation_input,
    expectedHeadSha: HEAD_SHA,
  });
  assert.equal(correlatedRun.id, 3, 'must ignore an uncorrelated concurrent run');
  assert.ok(ghCalls[0].includes('attempt_marker=cecelia-0123456789abcdef0123456789abcdef0123456789abcdef'));

  const capsuleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-evidence-capsule-'));
  const calls = [];
  const github = {
    async getPullRequest(repo, number) {
      calls.push(['pr', repo, number]);
      return { number, state: 'open', head: { sha: HEAD_SHA } };
    },
    async getRun(repo, runId) {
      calls.push(['run', repo, runId]);
      return {
        id: runId,
        head_sha: HEAD_SHA,
        status: 'completed',
        conclusion: 'success',
        path: '.github/workflows/e2e-orphan-consolidation-windows.yml',
        html_url: `https://github.com/${repo}/actions/runs/${runId}`,
      };
    },
    async listArtifacts(repo, runId) {
      calls.push(['artifacts', repo, runId]);
      return [{
        id: 9001,
        name: 'windows-cancel-evidence-30694126825-1',
        expired: false,
      }];
    },
    async downloadArtifact(repo, artifactId) {
      calls.push(['download', repo, artifactId]);
      return zipBytes({
        'screens/01-result.png': 'real-image-evidence',
        'result.json': '{"status":"cancelled"}',
      });
    },
  };

  const collected = await collectEvidenceCapsule({
    envelope: envelope(),
    capsuleDir,
    github,
    collectedAt: '2026-08-01T00:00:00.000Z',
  });
  assert.match(collected.manifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(collected.manifest.expected_head_sha, HEAD_SHA);
  assert.equal(collected.manifest.runs[0].head_sha, HEAD_SHA);
  assert.equal(collected.manifest.runs[0].artifacts[0].name,
    'windows-cancel-evidence-30694126825-1');
  assert.equal(collected.manifest.runs[0].artifacts[0].extracted_files.length, 2);
  const extractedPath = path.join(
    capsuleDir,
    collected.manifest.runs[0].artifacts[0].extracted_files[0].path,
  );
  assert.equal(fs.readFileSync(extractedPath, 'utf8'), 'real-image-evidence');
  assert.equal(calls.filter(([kind]) => kind === 'download').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'pr').length, 2,
    'PR exact head must be rechecked after long-running evidence collection');
  assert.equal(
    verifyEvidenceCapsule({ capsuleDir, expectedManifestDigest: collected.manifestDigest }),
    true,
  );

  const budgetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-evidence-budget-'));
  await assert.rejects(
    collectEvidenceCapsule({
      envelope: envelope(),
      capsuleDir: budgetDir,
      github,
      capsuleLimits: {
        maxArchiveBytes: 1,
        maxExtractedBytes: 1024,
        maxExtractedFiles: 10,
      },
    }),
    /github_evidence_capsule_budget_exceeded/,
  );

  fs.chmodSync(extractedPath, 0o600);
  fs.appendFileSync(extractedPath, 'tampered');
  assert.throws(
    () => verifyEvidenceCapsule({
      capsuleDir,
      expectedManifestDigest: collected.manifestDigest,
    }),
    /github_evidence_capsule_tampered/,
  );
  fs.writeFileSync(extractedPath, 'real-image-evidence', { mode: 0o400 });

  const artifactPath = path.join(
    capsuleDir,
    collected.manifest.runs[0].artifacts[0].path,
  );
  fs.chmodSync(artifactPath, 0o600);
  fs.appendFileSync(artifactPath, 'tampered');
  assert.throws(
    () => verifyEvidenceCapsule({
      capsuleDir,
      expectedManifestDigest: collected.manifestDigest,
    }),
    /github_evidence_capsule_tampered/,
  );

  const escapedZip = zipBytes({ '../other-purpose/forged.png': 'forged' });
  const escapedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'github-evidence-escape-'));
  const escapedArchive = path.join(escapedRoot, 'escape.zip');
  fs.writeFileSync(escapedArchive, escapedZip);
  assert.throws(
    () => extractDownloadedArtifact({
      archivePath: escapedArchive,
      capsuleDir: escapedRoot,
      purpose: 'android_cancel',
      artifactName: 'android-cancel-evidence',
    }),
    /github_evidence_archive_rejected/,
  );

  const bombZip = zipBytes({ 'compressed-bomb.txt': 'A'.repeat(128 * 1024) });
  const bombRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'github-evidence-bomb-'));
  const bombArchive = path.join(bombRoot, 'bomb.zip');
  fs.writeFileSync(bombArchive, bombZip);
  assert.throws(
    () => extractDownloadedArtifact({
      archivePath: bombArchive,
      capsuleDir: bombRoot,
      purpose: 'android_cancel',
      artifactName: 'android-cancel-evidence',
    }),
    /github_evidence_archive_rejected/,
  );

  const wrongHeadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-evidence-wrong-head-'));
  await assert.rejects(
    collectEvidenceCapsule({
      envelope: envelope(),
      capsuleDir: wrongHeadDir,
      github: { ...github, getRun: async () => ({
        id: 30694126825,
        head_sha: 'a'.repeat(40),
        status: 'completed',
        conclusion: 'success',
        path: '.github/workflows/e2e-orphan-consolidation-windows.yml',
      }) },
    }),
    /github_evidence_run_head_mismatch/,
  );
}

main().then(
  () => console.log('GitHub evidence preflight tests passed'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
