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
  'source_attempt_id',
]);
// F7（复审）：npm ci 独立超时预算——180s prepare 总预算里留至少 60s 给 git
// clone/worktree/verify 等其余步骤，npm ci 本身封顶 120s；超时按失败处理
// （被下面的 try/catch 吸收成 nodeDepsResult.status='failed'，不炸 prepare）。
const NODE_DEPS_INSTALL_TIMEOUT_MS = 120_000;
// F7：8MiB——npm ci 在大依赖树上的 stdout/stderr 体量比 git 命令大得多，
// 默认 execFile maxBuffer(1MB) 在真实 monorepo 依赖树上容易溢出报
// ERR_CHILD_PROCESS_STDIO_MAXBUFFER，把"依赖装成功但日志读不完整"误判成失败。
const NODE_DEPS_INSTALL_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

async function defaultRunCommand(command, args, options = {}) {
  const { stdout = '' } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    // env/timeout 只在调用方显式给出时才透传（git 调用从不给，行为不变）。
    // 调用方负责自己决定要不要带 process.env——workspace-manager 不在这里
    // 偷偷帮它合并，避免对已有调用方产生意外副作用。
    ...(options.env ? { env: options.env } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {}),
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
  if (
    value.source_attempt_id !== undefined
    && (
      !UUID_PATTERN.test(value.source_attempt_id)
      || value.source_attempt_id === value.attempt_id
    )
  ) {
    throw new Error('workspace_source_attempt_invalid');
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
  // F4（复审）：npm 缓存目录——机器级、跨 attempt 复用（同 mirrors 的复用思路，
  // 不是每 attempt 一份）。worktrees 根目录已有的建法是"用到时 mkdirSync
  // {recursive:true, mode:0o700}"（见 prepare() 里的 fs.mkdirSync(worktrees,...)），
  // 这里照抄同一权限模式，只是位置挪到 worktrees 的上一级、单独一个
  // 'npm-cache' 兄弟目录，不跟任何单个 attempt 的 worktree 绑定生命周期。
  const npmCacheRoot = path.join(path.dirname(worktrees), 'npm-cache');
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
    async prepare(input, { nodeDeps = false } = {}) {
      const spec = validateSpec(input, allowedRepos);
      const sourceWorkspace = spec.source_attempt_id
        ? readOwnedWorkspace(spec.source_attempt_id)
        : null;
      if (
        spec.source_attempt_id
        && (
          !sourceWorkspace
          || sourceWorkspace.repo !== spec.repo
          || sourceWorkspace.owner.run_id !== spec.run_id
        )
      ) {
        throw new Error('workspace_source_attempt_unavailable');
      }
      const mirrorPath = sourceWorkspace?.mirror_path ?? await updateMirror(spec);
      const cloneSourcePath = sourceWorkspace?.admin_path ?? mirrorPath;
      await requireCommit(
        cloneSourcePath,
        spec.base_sha,
        'workspace_base_sha_unavailable',
      );
      await verifyExpectedHead(cloneSourcePath, spec);

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
        ...(spec.source_attempt_id
          ? { source_attempt_id: spec.source_attempt_id }
          : {}),
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
          cloneSourcePath,
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

      // 运行时依赖预装（design doc §运行时依赖，r17 实证）：clone 后的裸 worktree
      // 默认不装 npm 依赖，proposer 的 product-map:check 因缺 ajv 每轮红——
      // ajv 本在 workspace package.json 里。dispatcher 对 proposer/reviewer
      // 默认开 node_deps；这里只在 checkout 成功、且确实有 package.json 时才
      // 跑 `npm ci`。失败不炸 prepare（设计明确要求）——attempt 照常跑，
      // product-map check 会像今天一样自己红，只是不再因为"根本没装依赖"
      // 而必然红。用注入的 runCommand（同 git 一样可测试替身），不直接碰
      // child_process，方便单测 mock 掉真实 npm 执行。
      let nodeDepsResult;
      if (nodeDeps === true) {
        const packageJsonPath = path.join(workspacePath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          try {
            // F5（复审实测坐实）：npm ci 在 fleet-worker **宿主**上跑（这一步
            // 发生在 provider 容器创建之前，checkout 出来的代码此刻还没有任何
            // 容器沙箱包着）。如果不加 --ignore-scripts，package.json 里的
            // pre/postinstall 生命周期脚本会以宿主进程权限直接执行——宿主对
            // docker.sock 有访问权，等于给了任意仓库内容一条现成的沙箱穿透
            // 路径（起同权限的兄弟容器/挂主机盘）。--ignore-scripts 对 ajv
            // 这类纯 JS 依赖（本次要解决的 product-map:check 场景）没有任何
            // 影响——它们不依赖 install-time 编译/脚本。
            //
            // F4：显式钉死 npm 缓存目录到机器级 npmCacheRoot（而不是让 npm
            // 落到宿主进程默认 HOME 下的全局缓存），避免多 attempt 并发写
            // 同一个隐式缓存位置时产生跨 attempt 的隐性依赖/权限纠缠；env
            // 必须基于 process.env 展开，直接传 {npm_config_cache} 会把 PATH
            // 等继承环境全部丢掉，导致 npm/node 本身都起不来。
            fs.mkdirSync(npmCacheRoot, { recursive: true, mode: 0o700 });
            await runCommand(
              'npm',
              ['ci', '--no-audit', '--no-fund', '--ignore-scripts'],
              {
                cwd: workspacePath,
                // workspace 随后 bind-mount 到 canonical Linux ARM64/glibc
                // runner。Fleet 宿主是 macOS ARM64；若让 npm 按宿主平台筛选
                // optionalDependencies，会漏装 @rollup/rollup-linux-arm64-gnu
                // 等容器执行期原生包，即使 npm ci 本身返回 0。
                env: {
                  ...process.env,
                  npm_config_cache: npmCacheRoot,
                  npm_config_os: 'linux',
                  npm_config_cpu: 'arm64',
                  npm_config_libc: 'glibc',
                },
                // F7：120s 封顶 + 8MiB 输出缓冲（见文件顶部常量注释）；超时被
                // execFile 的 timeout 机制杀掉进程后作为 reject 落进下面的
                // catch，按普通失败处理，不特殊短路、不炸 prepare。
                timeout: NODE_DEPS_INSTALL_TIMEOUT_MS,
                maxBuffer: NODE_DEPS_INSTALL_MAX_BUFFER_BYTES,
              },
            );
            nodeDepsResult = Object.freeze({ status: 'installed' });
          } catch (error) {
            nodeDepsResult = Object.freeze({
              status: 'failed',
              warning: String(error?.message ?? error).slice(0, 1024),
            });
          }
        } else {
          nodeDepsResult = Object.freeze({ status: 'skipped_no_package_json' });
        }
      }

      return Object.freeze({
        ...workspace,
        owner: Object.freeze({
          run_id: spec.run_id,
          attempt_id: spec.attempt_id,
        }),
        ...(nodeDepsResult ? { node_deps: nodeDepsResult } : {}),
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
      npmCache: npmCacheRoot,
    }),
  });
}

module.exports = {
  createWorkspaceManager,
};
