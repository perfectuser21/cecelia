import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BRANCH_PATTERN =
  /^(?!-)(?!.*(?:^|\/)\.\.?($|\/))(?!.*(?:\.\.|@\{))[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_NAME_PATTERN = /^cecelia-codex-review-[a-f0-9-]{36}$/;
const REVIEW_IMAGE_TAG = 'cecelia-brain:latest';
const REVIEW_CODEX_VERSION = 'codex-cli 0.145.0';
const CONTAINER_WORKTREE = '/workspace';
const CONTAINER_GIT_SOURCE = '/review-source-git';
const CONTAINER_AUTH_SOURCE = '/run/codex-auth';
const CONTAINER_EGRESS_ROOT = '/broker';
const CONTAINER_EGRESS_BRIDGE = '/usr/local/libexec/codex-review-uds-bridge.cjs';
const CONTAINER_HOME = '/home/cecelia';
const CONTAINER_CODEX_HOME = `${CONTAINER_HOME}/.codex`;
const CODEX_BOOTSTRAP = [
  'umask 077',
  `mkdir -p ${CONTAINER_CODEX_HOME}`,
  `cp ${CONTAINER_AUTH_SOURCE} ${CONTAINER_CODEX_HOME}/auth.json`,
  `chmod 600 ${CONTAINER_CODEX_HOME}/auth.json`,
  'test "$(/usr/local/bin/codex --version)" = "codex-cli 0.145.0"',
  `node ${CONTAINER_EGRESS_BRIDGE} & egress_bridge_pid=$!`,
  'trap \'kill "$egress_bridge_pid" 2>/dev/null || true\' EXIT',
  'egress_wait=0',
  'while [ ! -f /tmp/codex-review-egress.ready ] && [ "$egress_wait" -lt 100 ]; do egress_wait=$((egress_wait + 1)); sleep 0.05; done',
  'test -f /tmp/codex-review-egress.ready',
  `git --git-dir=${CONTAINER_GIT_SOURCE} cat-file -e "\${REVIEW_HEAD:?}^{commit}"`,
  `test "$(git --git-dir=${CONTAINER_GIT_SOURCE} ls-tree -r -z --full-tree "\${REVIEW_HEAD:?}" | sha256sum | awk '{print $1}')" = "\${REVIEW_SNAPSHOT_DIGEST:?}"`,
  `git --git-dir=${CONTAINER_GIT_SOURCE} archive --format=tar --output=/tmp/codex-review-snapshot.tar "\${REVIEW_HEAD:?}"`,
  `tar -xf /tmp/codex-review-snapshot.tar -C ${CONTAINER_WORKTREE}`,
  'rm -f /tmp/codex-review-snapshot.tar',
  `chmod -R a-w ${CONTAINER_WORKTREE}`,
  'if /usr/local/bin/codex "$@" > /tmp/codex-review.stdout; then review_status=0; else review_status=$?; fi',
  'if [ "$review_status" -ne 0 ]; then tail -c 65536 /tmp/codex-review.stdout >&2; exit "$review_status"; fi',
  'test -s /tmp/codex-review-verdict.json',
  'cat /tmp/codex-review-verdict.json',
].join('; ');

export class CodexReviewBoundaryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CodexReviewBoundaryError';
    this.code = code;
  }
}

function fail(code) {
  throw new CodexReviewBoundaryError(code);
}

function bounded(value, maximum = 4_096) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function inside(candidate, root) {
  return candidate.startsWith(`${root}${path.sep}`);
}

function assertMountSource(candidate, code) {
  if (
    !bounded(candidate)
    || !path.isAbsolute(candidate)
    || /[,\0\r\n]/.test(candidate)
  ) {
    fail(code);
  }
}

export function extractCodexReviewBranch(task = {}) {
  const candidates = [
    task.metadata?.branch,
    task.payload?.branch,
    task.payload?.head_branch,
    task.custom_props?.branch,
    task.branch,
    typeof task.title === 'string'
      ? task.title.replace(
        /^(?:Spec|Code|PRD|Initiative|Architecture|Arch|Decomp)?\s*Review:\s*/i,
        '',
      ).trim()
      : null,
  ];
  const branch = candidates.find((candidate) => bounded(candidate, 255));
  if (!branch || !BRANCH_PATTERN.test(branch)) {
    fail('review_branch_invalid');
  }
  return branch;
}

export function extractCodexReviewExpectedRevisions(task = {}) {
  const payload = task.payload ?? {};
  const bundle = payload.task_bundle
    ?? payload.kernel_task_bundle
    ?? task.task_bundle
    ?? null;
  const prior = payload.codex_review_evidence
    ?? payload.review_evidence
    ?? payload.workspace
    ?? null;
  const pullRequest = bundle?.inputs?.pull_request
    ?? bundle?.pull_request
    ?? null;
  const workspace = bundle?.inputs?.workspace
    ?? bundle?.workspace
    ?? null;
  const ci = bundle?.inputs?.ci ?? bundle?.ci ?? null;

  const heads = [
    prior?.head_sha,
    prior?.expected_head_sha,
    pullRequest?.head_sha,
    workspace?.expected_head_sha,
    ci?.head_sha,
  ].filter((value) => value !== null && value !== undefined);
  const bases = [
    prior?.base_sha,
    workspace?.base_sha,
    pullRequest?.base_sha,
  ].filter((value) => value !== null && value !== undefined);
  if (
    heads.some((value) => !/^[a-f0-9]{40}$/.test(value))
    || bases.some((value) => !/^[a-f0-9]{40}$/.test(value))
    || new Set(heads).size > 1
    || new Set(bases).size > 1
  ) {
    fail('review_revision_evidence_conflict');
  }
  return Object.freeze({
    headSha: heads[0] ?? null,
    baseSha: bases[0] ?? null,
  });
}

function defaultAllowedRoots(repoRoot) {
  return [
    path.join(repoRoot, '.claude', 'worktrees'),
    path.join(repoRoot, '.worktrees'),
    path.join(os.homedir(), 'worktrees'),
  ];
}

export function resolveCodexReviewWorktree({
  branch,
  repoRoot,
  allowedRoots = null,
  execute = execFileSync,
  resolveRealPath = realpathSync,
} = {}) {
  if (
    !bounded(branch, 255)
    || !BRANCH_PATTERN.test(branch)
    || !bounded(repoRoot)
    || !path.isAbsolute(repoRoot)
    || typeof execute !== 'function'
    || typeof resolveRealPath !== 'function'
  ) {
    fail('review_worktree_request_invalid');
  }

  let trustedRepoRoot;
  let output;
  try {
    trustedRepoRoot = resolveRealPath(repoRoot);
    output = execute(
      'git',
      ['-C', trustedRepoRoot, 'worktree', 'list', '--porcelain'],
      {
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
        timeout: 10_000,
      },
    );
  } catch {
    fail('review_worktree_unavailable');
  }

  let candidate = null;
  let currentPath = null;
  for (const line of String(output).split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
    } else if (line === `branch refs/heads/${branch}`) {
      candidate = currentPath;
      break;
    }
  }
  if (!bounded(candidate) || !path.isAbsolute(candidate)) {
    fail('review_worktree_unavailable');
  }

  let trustedCandidate;
  let gitTopLevel;
  try {
    trustedCandidate = resolveRealPath(candidate);
    gitTopLevel = String(execute(
      'git',
      ['-C', trustedCandidate, 'rev-parse', '--show-toplevel'],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    )).trim();
    gitTopLevel = resolveRealPath(gitTopLevel);
  } catch {
    fail('review_worktree_unavailable');
  }

  const roots = (allowedRoots ?? defaultAllowedRoots(trustedRepoRoot))
    .map((root) => {
      try {
        return resolveRealPath(root);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (
    trustedCandidate === trustedRepoRoot
    || trustedCandidate !== gitTopLevel
    || roots.length === 0
    || !roots.some((root) => inside(trustedCandidate, root))
  ) {
    fail('review_worktree_outside_boundary');
  }
  assertMountSource(trustedCandidate, 'review_worktree_path_unsafe');
  return trustedCandidate;
}

export function resolveCodexReviewAuthFile({
  codexHome,
  resolveRealPath = realpathSync,
  inspect = lstatSync,
} = {}) {
  if (
    !bounded(codexHome)
    || !path.isAbsolute(codexHome)
    || typeof resolveRealPath !== 'function'
    || typeof inspect !== 'function'
  ) {
    fail('review_auth_home_invalid');
  }
  try {
    const trustedHome = resolveRealPath(codexHome);
    if (!/^\.codex-team[1-5]$/.test(path.basename(trustedHome))) {
      fail('review_auth_home_outside_boundary');
    }
    const candidate = path.join(trustedHome, 'auth.json');
    const metadata = inspect(candidate);
    if (
      metadata.isSymbolicLink()
      || !metadata.isFile()
      || metadata.nlink !== 1
      || (metadata.mode & 0o077) !== 0
    ) {
      fail('review_auth_file_unsafe');
    }
    const trustedAuth = resolveRealPath(candidate);
    if (path.dirname(trustedAuth) !== trustedHome) {
      fail('review_auth_file_unsafe');
    }
    assertMountSource(trustedAuth, 'review_auth_file_unsafe');
    return trustedAuth;
  } catch (error) {
    if (error instanceof CodexReviewBoundaryError) throw error;
    fail('review_auth_file_unavailable');
  }
}

export function readCodexReviewAuthSnapshot({
  authFilePath,
  open = openSync,
  inspect = fstatSync,
  read = readFileSync,
  close = closeSync,
} = {}) {
  assertMountSource(authFilePath, 'review_auth_file_unsafe');
  let descriptor;
  try {
    descriptor = open(
      authFilePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const before = inspect(descriptor);
    if (
      !before.isFile()
      || before.nlink !== 1
      || (before.mode & 0o077) !== 0
      || !Number.isSafeInteger(before.size)
      || before.size <= 0
      || before.size > 1024 * 1024
    ) {
      fail('review_auth_file_unsafe');
    }
    const content = read(descriptor);
    const snapshot = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const after = inspect(descriptor);
    if (
      snapshot.length > 1024 * 1024
      || !after.isFile()
      || after.nlink !== 1
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
    ) {
      fail('review_auth_file_unsafe');
    }
    JSON.parse(snapshot.toString('utf8'));
    return Buffer.from(snapshot);
  } catch (error) {
    if (error instanceof CodexReviewBoundaryError) throw error;
    fail('review_auth_file_unavailable');
  } finally {
    if (descriptor !== undefined) {
      try {
        close(descriptor);
      } catch {
        // The immutable in-memory snapshot is already complete.
      }
    }
  }
}

export function readCodexReviewFile({
  worktreePath,
  fileName,
  open = openSync,
  inspect = fstatSync,
  read = readFileSync,
  close = closeSync,
} = {}) {
  assertMountSource(worktreePath, 'review_worktree_path_unsafe');
  if (
    !bounded(fileName, 300)
    || path.basename(fileName) !== fileName
    || !/^\.task-[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.md$/.test(fileName)
  ) {
    fail('review_file_name_invalid');
  }
  let descriptor;
  try {
    descriptor = open(
      path.join(worktreePath, fileName),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const metadata = inspect(descriptor);
    if (
      !metadata.isFile()
      || metadata.nlink !== 1
      || !Number.isSafeInteger(metadata.size)
      || metadata.size < 0
      || metadata.size > 512 * 1024
    ) {
      fail('review_file_unsafe');
    }
    const content = String(read(descriptor, 'utf-8'));
    const metadataAfterRead = inspect(descriptor);
    if (
      Buffer.byteLength(content, 'utf8') > 512 * 1024
      || !metadataAfterRead.isFile()
      || metadataAfterRead.nlink !== 1
      || metadataAfterRead.size !== metadata.size
    ) {
      fail('review_file_unsafe');
    }
    return content;
  } catch (error) {
    if (error instanceof CodexReviewBoundaryError) throw error;
    fail('review_file_unavailable');
  } finally {
    if (descriptor !== undefined) {
      try {
        close(descriptor);
      } catch {
        // Read access was already bounded; close errors cannot widen it.
      }
    }
  }
}

export function resolveCodexReviewGitMetadata({
  worktreePath,
  repoRoot,
  expectedHeadSha = null,
  expectedBaseSha = null,
  execute = execFileSync,
  resolveRealPath = realpathSync,
} = {}) {
  assertMountSource(worktreePath, 'review_worktree_path_unsafe');
  if (
    !bounded(repoRoot)
    || !path.isAbsolute(repoRoot)
    || typeof execute !== 'function'
    || typeof resolveRealPath !== 'function'
  ) {
    fail('review_git_metadata_request_invalid');
  }
  try {
    const trustedRepoRoot = resolveRealPath(repoRoot);
    const expectedCommonDir = resolveRealPath(path.join(trustedRepoRoot, '.git'));
    const gitDirRaw = String(execute(
      'git',
      ['-C', worktreePath, 'rev-parse', '--absolute-git-dir'],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    )).trim();
    const commonDirRaw = String(execute(
      'git',
      ['-C', worktreePath, 'rev-parse', '--git-common-dir'],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    )).trim();
    const trustedGitDir = resolveRealPath(
      path.isAbsolute(gitDirRaw)
        ? gitDirRaw
        : path.resolve(worktreePath, gitDirRaw),
    );
    const trustedCommonDir = resolveRealPath(
      path.isAbsolute(commonDirRaw)
        ? commonDirRaw
        : path.resolve(worktreePath, commonDirRaw),
    );
    if (
      trustedCommonDir !== expectedCommonDir
      || !inside(trustedGitDir, path.join(expectedCommonDir, 'worktrees'))
    ) {
      fail('review_git_metadata_outside_boundary');
    }
    const worktreeGitDirName = path.basename(trustedGitDir);
    if (!/^[A-Za-z0-9._-]{1,255}$/.test(worktreeGitDirName)) {
      fail('review_git_metadata_outside_boundary');
    }
    const headSha = String(execute(
      'git',
      ['-C', worktreePath, 'rev-parse', '--verify', 'HEAD^{commit}'],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    )).trim();
    const targetBaseSha = String(execute(
      'git',
      ['-C', worktreePath, 'rev-parse', '--verify', 'origin/main^{commit}'],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    )).trim();
    if (
      !/^[a-f0-9]{40}$/.test(headSha)
      || !/^[a-f0-9]{40}$/.test(targetBaseSha)
      || (expectedHeadSha !== null && !/^[a-f0-9]{40}$/.test(expectedHeadSha))
      || (expectedBaseSha !== null && !/^[a-f0-9]{40}$/.test(expectedBaseSha))
      || (expectedHeadSha !== null && expectedHeadSha !== headSha)
    ) {
      fail('review_git_revision_untrusted');
    }
    const admittedTargetBaseSha = expectedBaseSha ?? targetBaseSha;
    // A moving base ref is never used directly for the review diff. Bind the
    // immutable snapshot to HEAD and review from the exact common ancestor.
    const baseSha = String(execute(
      'git',
      ['-C', worktreePath, 'merge-base', admittedTargetBaseSha, headSha],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    )).trim();
    if (!/^[a-f0-9]{40}$/.test(baseSha)) {
      fail('review_git_revision_untrusted');
    }
    execute(
      'git',
      ['-C', worktreePath, 'merge-base', '--is-ancestor', baseSha, headSha],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
      },
    );
    const dirtyState = String(execute(
      'git',
      [
        '-C',
        worktreePath,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--no-renames',
      ],
      {
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
        timeout: 10_000,
      },
    ));
    if (dirtyState.length !== 0) {
      fail('review_worktree_dirty');
    }
    const canonicalTree = execute(
      'git',
      ['-C', worktreePath, 'ls-tree', '-r', '-z', '--full-tree', headSha],
      {
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 15_000,
      },
    );
    const snapshotDigest = createHash('sha256')
      .update(Buffer.isBuffer(canonicalTree) ? canonicalTree : Buffer.from(canonicalTree))
      .digest('hex');
    assertMountSource(trustedCommonDir, 'review_git_metadata_path_unsafe');
    return Object.freeze({
      commonDir: trustedCommonDir,
      worktreeGitDirName,
      headSha,
      baseSha,
      targetBaseSha: admittedTargetBaseSha,
      snapshotDigest,
    });
  } catch (error) {
    if (error instanceof CodexReviewBoundaryError) throw error;
    fail('review_git_metadata_unavailable');
  }
}

export function resolveCodexReviewImage({
  dockerBin,
  execute = execFileSync,
} = {}) {
  if (
    !bounded(dockerBin)
    || !path.isAbsolute(dockerBin)
    || typeof execute !== 'function'
  ) {
    fail('review_container_runtime_invalid');
  }
  try {
    const imageId = String(execute(
      dockerBin,
      ['image', 'inspect', '--format', '{{.Id}}', REVIEW_IMAGE_TAG],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 10_000,
        env: buildCodexReviewDockerEnvironment(process.env),
      },
    )).trim();
    if (!IMAGE_ID_PATTERN.test(imageId)) {
      fail('review_container_image_untrusted');
    }
    const version = String(execute(
      dockerBin,
      [
        'run',
        '--rm',
        '--network', 'none',
        '--entrypoint', '/usr/local/bin/codex',
        imageId,
        '--version',
      ],
      {
        encoding: 'utf8',
        maxBuffer: 4_096,
        timeout: 30_000,
        env: buildCodexReviewDockerEnvironment(process.env),
      },
    )).trim();
    if (version !== REVIEW_CODEX_VERSION) {
      fail('review_container_codex_version_untrusted');
    }
    return imageId;
  } catch (error) {
    if (error instanceof CodexReviewBoundaryError) throw error;
    fail('review_container_image_unavailable');
  }
}

export function buildCodexReviewArguments({ gitMetadata } = {}) {
  if (
    gitMetadata === null
    || typeof gitMetadata !== 'object'
    || !/^[A-Za-z0-9._-]{1,255}$/.test(gitMetadata.worktreeGitDirName ?? '')
  ) {
    fail('review_git_metadata_invalid');
  }
  return Object.freeze([
    'exec',
    '--model',
    'gpt-5.4',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--disable', 'apps',
    '--disable', 'browser_use',
    '--disable', 'browser_use_external',
    '--disable', 'browser_use_full_cdp_access',
    '--disable', 'image_generation',
    '--disable', 'standalone_web_search',
    '-c', 'web_search="disabled"',
    '-c', 'mcp_servers={}',
    '-c', 'features.network_proxy=false',
    '-c', 'default_permissions="review"',
    '-c', `permissions.review.filesystem={ ":minimal" = "read", "${CONTAINER_WORKTREE}" = "read", "${CONTAINER_GIT_SOURCE}" = "deny", "${CONTAINER_CODEX_HOME}" = "deny", "${CONTAINER_AUTH_SOURCE}" = "deny", "${CONTAINER_EGRESS_ROOT}" = "deny", "/app" = "deny" }`,
    '-c', 'permissions.review.network.enabled=false',
    '-c', 'shell_environment_policy.inherit="none"',
    '-c', 'shell_environment_policy.set={ PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME="/nonexistent" }',
    '--ephemeral',
    '--output-last-message',
    '/tmp/codex-review-verdict.json',
    '-c',
    'approval_policy="never"',
    '-',
  ]);
}

export function parseCodexReviewVerdict(output) {
  if (
    typeof output !== 'string'
    || output.length === 0
    || output.length > 64 * 1024
  ) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return null;
  }
  if (
    parsed === null
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || !['PASS', 'FAIL'].includes(parsed.verdict)
    || !bounded(parsed.summary, 4_000)
    || (
      parsed.issues !== undefined
      && (
        !Array.isArray(parsed.issues)
        || parsed.issues.length > 100
        || parsed.issues.some((issue) => (
          issue === null
          || typeof issue !== 'object'
          || Array.isArray(issue)
          || JSON.stringify(issue).length > 8_192
        ))
      )
    )
  ) {
    return null;
  }
  return Object.freeze({
    verdict: parsed.verdict,
    ...(parsed.issues !== undefined ? { issues: parsed.issues } : {}),
    summary: parsed.summary,
    ...(parsed.stats !== undefined ? { stats: parsed.stats } : {}),
  });
}

export function buildCodexReviewDockerEnvironment(source = {}) {
  const result = Object.create(null);
  result.PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  if (
    bounded(source.DOCKER_HOST)
    && /^(?:unix:\/\/\/|npipe:\/\/\/)[^\0\r\n]{1,1000}$/.test(source.DOCKER_HOST)
  ) {
    result.DOCKER_HOST = source.DOCKER_HOST;
  }
  result.HOME = '/nonexistent';
  result.TMPDIR = '/tmp';
  return Object.freeze(result);
}

export function buildCodexReviewDockerArguments({
  worktreePath,
  gitMetadata,
  authFilePath,
  egressVolumeName,
  egressOwnerNonce,
  egressExpiresAt,
  imageId,
  containerName,
} = {}) {
  assertMountSource(worktreePath, 'review_worktree_path_unsafe');
  if (
    gitMetadata === null
    || typeof gitMetadata !== 'object'
    || !/^[A-Za-z0-9._-]{1,255}$/.test(gitMetadata.worktreeGitDirName ?? '')
    || !/^[a-f0-9]{40}$/.test(gitMetadata.headSha ?? '')
    || !/^[a-f0-9]{40}$/.test(gitMetadata.baseSha ?? '')
    || !/^[a-f0-9]{40}$/.test(gitMetadata.targetBaseSha ?? '')
    || !/^[a-f0-9]{64}$/.test(gitMetadata.snapshotDigest ?? '')
  ) {
    fail('review_git_metadata_invalid');
  }
  assertMountSource(gitMetadata.commonDir, 'review_git_metadata_path_unsafe');
  assertMountSource(authFilePath, 'review_auth_file_unsafe');
  if (
    !/^cecelia-codex-review-egress-[a-f0-9-]{36}$/.test(
      egressVolumeName ?? '',
    )
  ) {
    fail('review_egress_volume_name_unsafe');
  }
  const reviewRunId = containerName?.replace(
    /^cecelia-codex-review-([a-f0-9-]{36})$/,
    '$1',
  );
  if (
    reviewRunId === containerName
    || egressVolumeName !== `cecelia-codex-review-egress-${reviewRunId}`
    || !/^[a-f0-9]{32}$/.test(egressOwnerNonce ?? '')
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      egressExpiresAt ?? '',
    )
  ) {
    fail('review_egress_identity_invalid');
  }
  if (!IMAGE_ID_PATTERN.test(imageId ?? '')) {
    fail('review_container_image_untrusted');
  }
  if (!CONTAINER_NAME_PATTERN.test(containerName ?? '')) {
    fail('review_container_name_invalid');
  }
  return Object.freeze([
    'run',
    '--rm',
    '--name', containerName,
    '--label', 'cecelia.kind=codex-reviewer',
    '--label', `cecelia.run_id=${reviewRunId}`,
    '--label', `cecelia.owner_nonce=${egressOwnerNonce}`,
    '--label', `cecelia.expires_at=${egressExpiresAt}`,
    '--init',
    '--no-healthcheck',
    '--interactive',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    // Codex's permission-profile tool runner creates its own Landlock/user
    // namespace. Docker's default seccomp blocks that syscall path; the
    // surrounding container remains non-root, cap-drop=ALL, no-new-privileges,
    // read-only, network-none, and mount-minimal.
    '--security-opt', 'seccomp=unconfined',
    '--pids-limit', '128',
    '--memory', '1g',
    '--cpus', '1',
    '--user', '1001:1001',
    '--network', 'none',
    '--workdir', CONTAINER_WORKTREE,
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
    '--tmpfs', `${CONTAINER_HOME}:rw,noexec,nosuid,nodev,size=64m,mode=700,uid=1001,gid=1001`,
    '--tmpfs', `${CONTAINER_WORKTREE}:rw,noexec,nosuid,nodev,size=512m,mode=700,uid=1001,gid=1001`,
    '--mount', `type=bind,src=${gitMetadata.commonDir},dst=${CONTAINER_GIT_SOURCE},readonly`,
    '--mount', `type=bind,src=${authFilePath},dst=${CONTAINER_AUTH_SOURCE},readonly`,
    '--mount', `type=volume,src=${egressVolumeName},dst=${CONTAINER_EGRESS_ROOT},readonly`,
    '--env', `HOME=${CONTAINER_HOME}`,
    '--env', `CODEX_HOME=${CONTAINER_CODEX_HOME}`,
    '--env', `REVIEW_HEAD=${gitMetadata.headSha}`,
    '--env', `REVIEW_SNAPSHOT_DIGEST=${gitMetadata.snapshotDigest}`,
    '--env', 'HTTP_PROXY=http://127.0.0.1:3128',
    '--env', 'HTTPS_PROXY=http://127.0.0.1:3128',
    '--env', 'ALL_PROXY=http://127.0.0.1:3128',
    '--env', 'NO_PROXY=',
    '--entrypoint', '/bin/sh',
    imageId,
    '-ceu',
    CODEX_BOOTSTRAP,
    'codex-review',
    ...buildCodexReviewArguments({ gitMetadata }),
  ]);
}
