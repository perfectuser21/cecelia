import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { createDockerAdapter } = require('../../scripts/fleet-worker/attempt-runner.cjs');
const execFileAsync = promisify(execFile);
const repoRoot = new URL('../../../..', import.meta.url).pathname.replace(/\/$/, '');
const image = process.env.CECELIA_REAL_RUNNER_IMAGE?.trim() || 'cecelia/runner:latest';
const model = process.env.CECELIA_REAL_RUNNER_MODEL?.trim() || 'gpt-5.6-sol';
const authPath = process.env.CODEX_AUTH_JSON_PATH?.trim();

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

async function listenForCallbacks(attemptId, callbackToken) {
  let terminalBody = null;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (request.headers.authorization !== `Bearer ${callbackToken}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.url?.endsWith('/heartbeat')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
        return;
      }
      if (request.url === `/attempts/${attemptId}/callback`) {
        terminalBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(204).end();
        return;
      }
      response.writeHead(404).end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  return {
    port: server.address().port,
    terminalBody: () => terminalBody,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

invariant(authPath, 'CODEX_AUTH_JSON_PATH is required for the real Runner smoke');
const authJson = await readFile(authPath, 'utf8');
invariant(authJson.length > 0, 'Codex credential file is empty');

const localEntrypoint = await readFile(
  path.join(repoRoot, 'docker/cecelia-runner/entrypoint.sh'),
);
const expectedEntrypointHash = createHash('sha256').update(localEntrypoint).digest('hex');
const observedEntrypointHash = execFileSync(
  'docker',
  ['run', '--rm', '--entrypoint', 'sha256sum', image, '/usr/local/bin/entrypoint.sh'],
  { encoding: 'utf8' },
).split(/\s+/)[0];
invariant(observedEntrypointHash === expectedEntrypointHash,
  `Runner image entrypoint drift: ${observedEntrypointHash} != ${expectedEntrypointHash}`);

const root = await mkdtemp(path.join(tmpdir(), 'uwr-real-runner-'));
const workspace = path.join(root, 'workspace');
const remote = path.join(root, 'remote.git');
const runtime = path.join(root, 'runtime');
const runId = randomUUID();
const attemptId = randomUUID();
const taskId = randomUUID();
const receiptId = randomUUID();
const credentialRef = randomUUID();
const branch = `cp-real-runner-${attemptId.slice(0, 8)}`;
const callbackToken = `runner-smoke-${randomUUID()}`;
const callback = await listenForCallbacks(attemptId, callbackToken);
const containerName = `cecelia-fleet-${attemptId}`;
const docker = createDockerAdapter({ runtimeRoot: runtime });

try {
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  execFileSync('git', ['init', '-b', branch, workspace], { stdio: 'ignore' });
  git(workspace, 'config', 'user.name', 'Cecelia Real Runner Smoke');
  git(workspace, 'config', 'user.email', 'runner-smoke@example.invalid');
  git(workspace, 'config', 'core.hooksPath', '/dev/null');
  execFileSync('/bin/sh', ['-c', 'printf "base\\n" > base.txt'], { cwd: workspace });
  git(workspace, 'add', 'base.txt');
  git(workspace, 'commit', '-m', 'test: seed real runner smoke');
  git(workspace, 'remote', 'add', 'origin', `file://${remote}`);
  const baseSha = git(workspace, 'rev-parse', 'HEAD');
  await chmod(workspace, 0o777);
  await chmod(path.join(workspace, '.git'), 0o777);

  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + 300_000);
  const taskBundle = {
    instruction: 'Execute the bounded Generator proof and return the required JSON object.',
    task_bundle: {
      contract_version: '1.0', run_id: runId, attempt_id: attemptId,
      hop: 1, phase: 'generate', role: 'generator',
      objective: [
        'In the current repository, use shell commands to create real-runner-proof.json.',
        'Its exact keys are uid, cap_eff, brain_url_present, callback_url_present,',
        'callback_token_present, lease_owner_present, lease_generation_present,',
        'gh_token_present, github_token_present, and push_exit.',
        'uid is the string from id -u. cap_eff is the string after CapEff: in /proc/self/status.',
        'Every *_present value is a JSON boolean determined from whether that exact environment',
        'variable is set, not a guess. push_exit is the numeric exit code from attempting',
        'git push origin HEAD:refs/heads/provider-must-not-publish.',
        'Then git add and commit only real-runner-proof.json. Do not alter any other file.',
        'Finally return status completed with a concise summary and empty artifacts/checks.',
      ].join(' '),
      inputs: {
        task_id: taskId,
        sprint_dir: 'sprints/08121555-unified-work-router',
        artifacts: [], contract_artifacts: [],
        pipeline_started_at: startedAt.toISOString(),
        deadline_at: deadlineAt.toISOString(),
        workspace_spec: {
          repo: 'perfectuser21/cecelia', base_sha: baseSha, branch,
          expected_head_sha: null, mode: 'read-write', run_id: runId,
          attempt_id: attemptId, frozen_baseline: true,
        },
        routing_identity: {
          routing_receipt_id: receiptId, repo: 'cecelia', branch, base_sha: baseSha,
        },
      },
      constraints: { read_only: false, fresh_session: true, timeout_seconds: 300 },
      expected_output: 'harness-result/generator-v1',
    },
    continuation: null,
  };
  const prepared = await docker.prepare({
    attemptId, runId, workerId: 'us-mac-m4', image,
    providerSpec: {
      provider: 'codex', command: 'codex', args: ['exec', '--json'],
      stdin: JSON.stringify(taskBundle), output: { format: 'jsonl' },
    },
    taskId, role: 'generator', model, timeoutSeconds: 300,
    workspaceStartSha: baseSha, frozenBaseline: true,
    workspaceMount: { source: workspace, target: '/workspace', readOnly: false },
    workspaceAdminMount: {
      source: path.join(workspace, '.git'),
      target: path.join(workspace, '.git'), readOnly: false,
    },
    labels: {
      'cecelia.fleet.attempt_id': attemptId,
      'cecelia.fleet.run_id': runId,
      'cecelia.fleet.worker_id': 'us-mac-m4',
    },
    callback: {
      url: `http://host.docker.internal:${callback.port}/attempts/${attemptId}/callback`,
      token: callbackToken,
    },
    lease: { owner: 'uwr-real-runner-smoke', generation: 0 },
    credential: { credentialRef, authJson },
    roleEnv: {
      CECELIA_ROUTING_RECEIPT_ID: receiptId, CECELIA_RUN_ID: runId,
      CECELIA_REPO: 'cecelia', CECELIA_ROUTING_REPO: 'cecelia',
      CECELIA_BRANCH: branch, CECELIA_BASE_SHA: baseSha,
      CECELIA_ROUTING_BASE_SHA: baseSha,
    },
  });
  await docker.start({
    attemptId, containerId: prepared.containerId,
    credentialFifo: prepared.credentialFifo,
    credential: { credentialRef, authJson },
  });
  const { stdout: waitOutput } = await execFileAsync('docker', ['wait', containerName], {
    timeout: 360_000, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  const exitCode = Number.parseInt(waitOutput.trim(), 10);
  const { stdout: logs } = await execFileAsync('docker', ['logs', containerName], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  invariant(exitCode === 0, `real Runner exited ${exitCode}: ${logs.slice(-2000)}`);
  invariant(logs.includes('Provider constrained to UID 5999 without capabilities'),
    'real Runner did not enter the untrusted Provider identity');
  invariant(!logs.includes(callbackToken), 'callback token leaked into Runner logs');

  const proof = JSON.parse(await readFile(path.join(workspace, 'real-runner-proof.json'), 'utf8'));
  invariant(String(proof.uid) === '5999', `Provider uid=${proof.uid}`);
  invariant(String(proof.cap_eff) === '0000000000000000', `Provider CapEff=${proof.cap_eff}`);
  for (const field of [
    'brain_url_present', 'callback_url_present', 'callback_token_present',
    'lease_owner_present', 'lease_generation_present', 'gh_token_present',
    'github_token_present',
  ]) invariant(proof[field] === false, `${field}=true inside Provider`);
  invariant(Number(proof.push_exit) !== 0, 'Provider unexpectedly pushed a remote ref');
  invariant(git(workspace, 'status', '--porcelain') === '?? .dev-lock.' + branch,
    'Generator workspace contains uncommitted Provider output');
  let published = false;
  try {
    execFileSync('git', ['--git-dir', remote, 'rev-parse', `refs/heads/${branch}`], {
      stdio: 'ignore',
    });
    published = true;
  } catch {}
  invariant(!published, 'Generator published a remote ref before Judge');
  const callbackBody = callback.terminalBody();
  const candidate = callbackBody?.artifacts?.find((artifact) => artifact.type === 'git_candidate');
  invariant(callbackBody?.status === 'completed', 'real callback was not completed');
  invariant(candidate?.verification_status === 'verified', 'real callback lacks verified candidate');
  invariant(candidate?.head_sha === git(workspace, 'rev-parse', 'HEAD'),
    'callback candidate SHA differs from the real commit');

  process.stdout.write(`${JSON.stringify({
    status: 'PASS', image, attempt_id: attemptId,
    provider_uid: proof.uid, cap_eff: proof.cap_eff,
    provider_push_blocked: true, callback_verified_candidate: true,
    candidate_head_sha: candidate.head_sha,
  }, null, 2)}\n`);
} finally {
  await execFileAsync('docker', ['rm', '-f', '--', containerName]).catch(() => {});
  await callback.close();
  await rm(root, { recursive: true, force: true });
}
