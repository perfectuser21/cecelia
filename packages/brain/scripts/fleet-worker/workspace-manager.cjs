#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BRANCH_PATTERN = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;
const SPEC_FIELDS = new Set([
  'repo',
  'base_sha',
  'branch',
  'expected_head_sha',
  'mode',
  'run_id',
  'attempt_id',
  'frozen_baseline',
]);

async function defaultRunCommand(command, args, options = {}) {
  const { stdout = '' } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim() };
}

function assertRoot(value, name) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value === path.parse(value).root) {
    throw new Error(`workspace_invalid_${name}`);
  }
  return path.resolve(value);
}

function validateSpec(value, repoAllowlist) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('workspace_spec_invalid');
  }
  for (const field of Object.keys(value)) {
    if (!SPEC_FIELDS.has(field)) {
      throw new Error(`workspace_spec_unknown_field:${field}`);
    }
  }
  if (!Object.hasOwn(repoAllowlist, value.repo)) {
    throw new Error('workspace_repo_not_allowed');
  }
  if (!SHA_PATTERN.test(value.base_sha)) {
    throw new Error('workspace_base_sha_invalid');
  }
  if (value.expected_head_sha !== null && !SHA_PATTERN.test(value.expected_head_sha)) {
    throw new Error('workspace_expected_head_sha_invalid');
  }
  if (
    !BRANCH_PATTERN.test(value.branch)
    || value.branch.includes('..')
    || value.branch.endsWith('.lock')
  ) {
    throw new Error('workspace_branch_invalid');
  }
  if (value.mode !== 'read-only' && value.mode !== 'read-write') {
    throw new Error('workspace_mode_invalid');
  }
  if (!UUID_PATTERN.test(value.run_id)) {
    throw new Error('workspace_run_id_invalid');
  }
  if (!UUID_PATTERN.test(value.attempt_id)) {
    throw new Error('workspace_attempt_id_invalid');
  }
  if (
    value.frozen_baseline !== undefined
    && typeof value.frozen_baseline !== 'boolean'
  ) {
    throw new Error('workspace_frozen_baseline_invalid');
  }
  return Object.freeze({
    ...value,
    frozen_baseline: value.frozen_baseline === true,
  });
}

function mirrorName(repo) {
  return `${repo.replace('/', '__')}.git`;
}

function commandOutput(result) {
  return typeof result?.stdout === 'string' ? result.stdout.trim() : '';
}

const RECOVERABLE_WORKTREE_CLEANUP_ERROR = /(?:validation failed[\s\S]*not a \.git file|failed to delete[\s\S]*Directory not empty|ENOTEMPTY)/i;

function createWorkspaceManager({
  mirrorRoot,
  worktreeRoot,
  quarantineRoot,
  repoAllowlist,
  runCommand = defaultRunCommand,
} = {}) {
  const mirrors = assertRoot(mirrorRoot, 'mirror_root');
  const worktrees = assertRoot(worktreeRoot, 'worktree_root');
  const quarantine = assertRoot(quarantineRoot, 'quarantine_root');
  if (
    !repoAllowlist
    || typeof repoAllowlist !== 'object'
    || Array.isArray(repoAllowlist)
    || Object.keys(repoAllowlist).length === 0
  ) {
    throw new Error('workspace_invalid_repo_allowlist');
  }
  if (typeof runCommand !== 'function') {
    throw new Error('workspace_invalid_command_runner');
  }

  const allowedRepos = Object.freeze({ ...repoAllowlist });
  const ownershipRoot = path.join(worktrees, '.ownership');
  const adminRoot = path.join(worktrees, '.admin');
  const allowedMirrorPaths = new Set(
    Object.keys(allowedRepos).map((repo) => path.join(mirrors, mirrorName(repo))),
  );
  let mirrorQueue = Promise.resolve();

  async function git(args, options) {
    return runCommand('git', args, options);
  }

  async function mirrorHasCommit(mirrorPath, sha) {
    try {
      await git(['--git-dir', mirrorPath, 'cat-file', '-e', `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  async function updateMirror(spec) {
    const mirrorPath = path.join(mirrors, mirrorName(spec.repo));
    const source = allowedRepos[spec.repo];
    const operation = mirrorQueue.then(async () => {
      fs.mkdirSync(mirrors, { recursive: true, mode: 0o700 });
      if (!fs.existsSync(mirrorPath)) {
        await git(['clone', '--mirror', '--', source, mirrorPath]);
      } else {
        const requiredCommits = [
          spec.base_sha,
          spec.expected_head_sha,
        ].filter(Boolean);
        const present = await Promise.all(
          requiredCommits.map((sha) => mirrorHasCommit(mirrorPath, sha)),
        );
        if (!present.every(Boolean)) {
          await git([
            '--git-dir',
            mirrorPath,
            'fetch',
            '--prune',
            'origin',
            '+refs/heads/*:refs/heads/*',
          ]);
        }
      }
      return mirrorPath;
    });
    mirrorQueue = operation.catch(() => {});
    return operation;
  }

  async function requireCommit(mirrorPath, sha, errorCode) {
    try {
      await git(['--git-dir', mirrorPath, 'cat-file', '-e', `${sha}^{commit}`]);
    } catch {
      throw new Error(errorCode);
    }
  }

  async function verifyExpectedHead(mirrorPath, spec) {
    if (spec.expected_head_sha === null) return;
    await requireCommit(
      mirrorPath,
      spec.expected_head_sha,
      'workspace_expected_head_unavailable',
    );
    let branchHead;
    try {
      branchHead = commandOutput(await git([
        '--git-dir',
        mirrorPath,
        'rev-parse',
        `refs/heads/${spec.branch}`,
      ]));
    } catch {
      throw new Error('workspace_expected_head_unavailable');
    }
    if (branchHead !== spec.expected_head_sha) {
      throw new Error('workspace_expected_head_mismatch');
    }
  }

  function assertOwnedWorkspace(workspace) {
    const attemptId = workspace?.owner?.attempt_id;
    if (!UUID_PATTERN.test(attemptId ?? '')) {
      throw new Error('workspace_owner_invalid');
    }
    const expectedPath = path.join(worktrees, attemptId);
    const expectedAdminPath = path.join(adminRoot, `${attemptId}.git`);
    if (path.resolve(workspace.path ?? '') !== expectedPath) {
      throw new Error('workspace_path_not_owned');
    }
    if (path.resolve(workspace.admin_path ?? '') !== expectedAdminPath) {
      throw new Error('workspace_admin_path_not_owned');
    }
    return { attemptId, expectedPath, expectedAdminPath };
  }

  function ownershipPath(attemptId) {
    return path.join(ownershipRoot, `${attemptId}.json`);
  }

  function saveOwnership(workspace) {
    fs.mkdirSync(ownershipRoot, { recursive: true, mode: 0o700 });
    const target = ownershipPath(workspace.owner.attempt_id);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(workspace)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, target);
  }

  function deleteOwnership(attemptId) {
    fs.rmSync(ownershipPath(attemptId), { force: true });
  }

  function readOwnedWorkspace(attemptId) {
    try {
      const serialized = fs.readFileSync(ownershipPath(attemptId), 'utf8');
      if (Buffer.byteLength(serialized, 'utf8') > 16_384) return null;
      const workspace = JSON.parse(serialized);
      const { expectedPath, expectedAdminPath } = assertOwnedWorkspace(workspace);
      if (
        workspace.repo == null
        || !Object.hasOwn(allowedRepos, workspace.repo)
        || workspace.mirror_path !== path.join(mirrors, mirrorName(workspace.repo))
        || !allowedMirrorPaths.has(workspace.mirror_path)
        || workspace.path !== expectedPath
        || workspace.admin_path !== expectedAdminPath
      ) {
        return null;
      }
      return workspace;
    } catch {
      return null;
    }
  }

  return Object.freeze({
    async prepare(input) {
      const spec = validateSpec(input, allowedRepos);
      const mirrorPath = await updateMirror(spec);
      await requireCommit(
        mirrorPath,
        spec.base_sha,
        'workspace_base_sha_unavailable',
      );
      await verifyExpectedHead(mirrorPath, spec);

      fs.mkdirSync(worktrees, { recursive: true, mode: 0o700 });
      fs.mkdirSync(adminRoot, { recursive: true, mode: 0o700 });
      const workspacePath = path.join(worktrees, spec.attempt_id);
      const adminPath = path.join(adminRoot, `${spec.attempt_id}.git`);
      if (fs.existsSync(workspacePath) || fs.existsSync(adminPath)) {
        throw new Error('workspace_attempt_already_exists');
      }
      const checkoutSha = spec.expected_head_sha ?? spec.base_sha;
      const workspace = {
        repo: spec.repo,
        branch: spec.branch,
        base_sha: spec.base_sha,
        expected_head_sha: spec.expected_head_sha,
        head_sha: checkoutSha,
        // head_sha is the only server-observed proof of where this Attempt
        // started. Pairing it with the invariant is what makes a push-time
        // lineage guard possible inside the container.
        frozen_baseline: spec.frozen_baseline === true,
        mode: spec.mode,
        path: workspacePath,
        mirror_path: mirrorPath,
        admin_path: adminPath,
        owner: {
          run_id: spec.run_id,
          attempt_id: spec.attempt_id,
        },
      };
      saveOwnership(workspace);
      try {
        await git([
          'clone',
          '--bare',
          '--no-hardlinks',
          '--',
          mirrorPath,
          adminPath,
        ]);
        await git([
          '--git-dir',
          adminPath,
          'remote',
          'set-url',
          'origin',
          allowedRepos[spec.repo],
        ]);
        await git([
          '--git-dir',
          adminPath,
          'worktree',
          'add',
          '--detach',
          workspacePath,
          checkoutSha,
        ]);
        if (spec.mode === 'read-write') {
          // The per-Attempt bare admin clone can already contain a verified
          // remote writer branch. Reset only this isolated clone's ref to the
          // server-approved checkout SHA instead of failing on `switch -c`.
          await git(
            ['switch', '-C', spec.branch, checkoutSha],
            { cwd: workspacePath },
          );
        }
      } catch (error) {
        await git([
          '--git-dir',
          adminPath,
          'worktree',
          'remove',
          '--force',
          workspacePath,
        ]).catch(() => {});
        fs.rmSync(adminPath, { recursive: true, force: true });
        deleteOwnership(spec.attempt_id);
        throw error;
      }

      return Object.freeze({
        ...workspace,
        owner: Object.freeze({
          run_id: spec.run_id,
          attempt_id: spec.attempt_id,
        }),
      });
    },

    async verify(workspace) {
      const { expectedPath } = assertOwnedWorkspace(workspace);
      if (!fs.existsSync(expectedPath)) {
        throw new Error('workspace_missing');
      }
      const head = commandOutput(await git(['rev-parse', 'HEAD'], { cwd: expectedPath }));
      if (head !== workspace.head_sha) {
        throw new Error('workspace_head_mismatch');
      }
      return Object.freeze({ status: 'verified', head_sha: head });
    },

    async quarantine(workspace, reason) {
      const { attemptId, expectedPath, expectedAdminPath } = assertOwnedWorkspace(workspace);
      fs.mkdirSync(quarantine, { recursive: true, mode: 0o700 });
      const quarantinePath = path.join(
        quarantine,
        `${attemptId}-${Date.now()}`,
      );
      if (fs.existsSync(expectedPath)) {
        fs.renameSync(expectedPath, quarantinePath);
      }
      const quarantineAdminPath = `${quarantinePath}.git-admin`;
      if (fs.existsSync(expectedAdminPath)) {
        fs.renameSync(expectedAdminPath, quarantineAdminPath);
      }
      const message = String(reason?.message ?? reason ?? 'workspace_cleanup_failed')
        .slice(0, 1024);
      fs.writeFileSync(
        `${quarantinePath}.json`,
        `${JSON.stringify({
          attempt_id: attemptId,
          run_id: workspace.owner.run_id,
          quarantined_at: new Date().toISOString(),
          reason: message,
        })}\n`,
        { mode: 0o600 },
      );
      deleteOwnership(attemptId);
      return Object.freeze({
        status: 'quarantined',
        attempt_id: attemptId,
        path: quarantinePath,
        admin_path: quarantineAdminPath,
        reason: message,
      });
    },

    async cleanup(workspace) {
      const { attemptId, expectedPath, expectedAdminPath } = assertOwnedWorkspace(workspace);
      if (!fs.existsSync(expectedPath)) {
        fs.rmSync(expectedAdminPath, { recursive: true, force: true });
        deleteOwnership(attemptId);
        return Object.freeze({
          status: 'already_clean',
          attempt_id: attemptId,
        });
      }
      try {
        await git([
          '--git-dir',
          expectedAdminPath,
          'worktree',
          'remove',
          '--force',
          expectedPath,
        ]);
        fs.rmSync(expectedAdminPath, { recursive: true, force: true });
        deleteOwnership(attemptId);
        return Object.freeze({
          status: 'cleaned',
          attempt_id: attemptId,
        });
      } catch (error) {
        if (RECOVERABLE_WORKTREE_CLEANUP_ERROR.test(String(error?.message ?? error))) {
          try {
            fs.rmSync(expectedPath, { recursive: true, force: true });
            fs.rmSync(expectedAdminPath, { recursive: true, force: true });
            deleteOwnership(attemptId);
            return Object.freeze({
              status: 'cleaned',
              attempt_id: attemptId,
              forced: true,
            });
          } catch (forcedCleanupError) {
            return this.quarantine(workspace, forcedCleanupError);
          }
        }
        return this.quarantine(workspace, error);
      }
    },

    async reconcile({ retainedAttemptIds = [] } = {}) {
      if (
        !Array.isArray(retainedAttemptIds)
        || retainedAttemptIds.some((attemptId) => !UUID_PATTERN.test(attemptId))
      ) {
        throw new Error('workspace_reconcile_retained_attempts_invalid');
      }
      const retained = new Set(retainedAttemptIds);
      if (!fs.existsSync(ownershipRoot)) {
        return Object.freeze({ cleaned_attempts: Object.freeze([]) });
      }
      const cleaned = [];
      for (const entry of fs.readdirSync(ownershipRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const attemptId = entry.name.slice(0, -5);
        if (!UUID_PATTERN.test(attemptId) || retained.has(attemptId)) continue;
        const workspace = readOwnedWorkspace(attemptId);
        if (!workspace) continue;
        const result = await this.cleanup(workspace);
        if (['cleaned', 'already_clean'].includes(result.status)) {
          cleaned.push(attemptId);
        }
      }
      return Object.freeze({
        cleaned_attempts: Object.freeze(cleaned),
      });
    },

    roots: Object.freeze({
      mirrors,
      worktrees,
      quarantine,
      ownership: ownershipRoot,
      admin: adminRoot,
    }),
  });
}

module.exports = {
  createWorkspaceManager,
};
