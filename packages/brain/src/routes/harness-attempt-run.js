/**
 * harness-attempt-run.js —— V4 画布 Worker 的单角色 attempt 接线（第 51 批，决策 bc242b62）。
 *
 * 背景：coding 工作流迁到 OpenClaw×n8n V4 骨架后，阶段内的真实执行仍要用 Brain 的
 * fleet 派发（角色容器、凭据签发、attempt 回执）。此前不存在任何 HTTP 面能
 * 「派发一个角色 attempt 并取回 harness_attempts.result」——attempt-telemetry 刻意
 * 剔除 result。本路由是唯一接线：
 *   POST /api/brain/harness/attempt-run          异步派发（202），复用 buildRealDeps().dispatch
 *   GET  /api/brain/harness/attempt-run/:id      轮询结构化结果（含 result/failure_class）
 *
 * 关键设计：
 * - 鉴权 internalAuthOrLoopback：HK 的 V4 Worker 走 Bearer CECELIA_INTERNAL_TOKEN。
 * - observed.task 不带 task_type / payload.work_kind → assertDispatchRoutingReceipt
 *   直接放行（dispatcher.js:47 的既有口子），不牵扯 work_routing_receipts / impact contract。
 * - run 行按 attempt-store 的硬要求写 orchestrator_version='v2'（v1 会被
 *   「Kernel run is terminal or missing」拒掉——冒烟脚本里的 v1 写法照抄会翻车）。
 * - 允许复用 run_id（同一 V4 run 的多个阶段共享一条 initiative_runs 行）。
 */
import { Router } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { finalizeTask } from '../lib/task-terminal.js';

export const ALLOWED_ROLES = Object.freeze([
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
]);

const TERMINAL_ATTEMPT_STATUSES = new Set([
  'completed', 'completed_with_concerns', 'failed', 'cancelled', 'blocked', 'needs_context',
]);

const ATTEMPT_PROJECTION = Object.freeze([
  'id', 'run_id', 'role', 'status', 'result', 'failure_class', 'error_code',
  'error_message', 'provider', 'account_id', 'requested_machine_id',
  'actual_machine_id', 'execution_transport', 'machine_attestation_status',
  'started_at', 'completed_at', 'created_at', 'updated_at',
]);

const SHA40 = /^[a-f0-9]{40}$/;
const ATTEMPT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// V4 候选不推远端为设计（generate/evaluate/judge 全在 fleet 本地工作区）。publish 是唯一
// 允许仓库写终态的格子，推送因此归本端点：起一次性只读容器进 fleet 候选工作区
// （fleet-mounts/worktrees/<source_attempt_id>，judge 验过头的那份），容器内先验
// HEAD===head_sha 再推 <sha>:refs/heads/<cp-branch>——绝不 force、绝不推别的 ref。
const FLEET_WORKTREES_ROOT = process.env.CECELIA_FLEET_WORKTREES_ROOT
  || '/Users/Shared/cecelia-fleet-tmp/fleet-mounts/worktrees';

async function pushCandidateViaDocker({ sourceAttemptId, branch, headSha, repo, token }) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  const workspace = `${FLEET_WORKTREES_ROOT}/${sourceAttemptId}`;
  const script = 'set -e; '
    + 'ACTUAL=$(git -c safe.directory=/ws rev-parse HEAD); '
    + 'if [ "$ACTUAL" != "$HEAD_SHA" ]; then echo "CANDIDATE_HEAD_MISMATCH:$ACTUAL"; exit 42; fi; '
    + 'git -c safe.directory=/ws push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "$HEAD_SHA:refs/heads/$BRANCH"';
  try {
    await execFileP('docker', [
      'run', '--rm',
      '-v', `${workspace}:/ws:ro`,
      '-w', '/ws',
      '-e', `HEAD_SHA=${headSha}`,
      '-e', `BRANCH=${branch}`,
      '-e', `REPO=${repo}`,
      '-e', `GH_TOKEN=${token}`,
      '--entrypoint', '/bin/sh',
      'cecelia/runner:latest',
      '-c', script,
    ], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true };
  } catch (error) {
    const output = `${error?.stderr ?? ''}\n${error?.stdout ?? ''}`;
    const sanitized = output.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@').slice(0, 500);
    if (/bind source path does not exist|no such file or directory.*fleet-mounts/i.test(output)) {
      return { ok: false, error: 'candidate_workspace_unavailable', detail: sanitized };
    }
    if (/CANDIDATE_HEAD_MISMATCH/.test(output)) {
      return { ok: false, error: 'candidate_head_mismatch', detail: sanitized };
    }
    return { ok: false, error: 'candidate_push_failed', detail: sanitized };
  }
}

export function createHarnessAttemptRunRouter({
  pool,
  attemptStoreFactory = null,
  sealDepsFactory = null,
  publishDepsFactory = null,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createHarnessAttemptRunRouter requires a pool');
  }
  const router = Router();
  let sealDepsPromise = null;
  const getSealDeps = () => {
    sealDepsPromise ??= (async () => {
      if (sealDepsFactory) return sealDepsFactory();
      const { collectApprovedContractArtifacts } = await import('../orchestrator/contract-artifacts.js');
      const { materializeApprovedContract } = await import('../orchestrator/contract-store.js');
      const { readGitArtifact, listGitArtifacts } = await import('../orchestrator/git-artifact-reader.js');
      const repoRoot = process.env.REPO_ROOT || process.cwd();
      return {
        collectArtifacts: (params) => collectApprovedContractArtifacts({
          ...params,
          readGitFile: (sha, filePath, opts = {}) => readGitArtifact(sha, filePath, {
            cwd: repoRoot, repo: opts.repo ?? null,
          }),
          listGitFiles: (sha, prefix, opts = {}) => listGitArtifacts(sha, prefix, {
            cwd: repoRoot, repo: opts.repo ?? null,
          }),
        }),
        materialize: materializeApprovedContract,
      };
    })();
    return sealDepsPromise;
  };
  let publishDepsPromise = null;
  const getPublishDeps = () => {
    publishDepsPromise ??= (async () => {
      if (publishDepsFactory) return publishDepsFactory();
      const { resolveGitHubToken } = await import('../harness-credentials.js');
      return {
        resolveToken: resolveGitHubToken,
        fetchFn: globalThis.fetch,
        pushCandidateFn: pushCandidateViaDocker,
      };
    })();
    return publishDepsPromise;
  };
  let storePromise = null;
  const getStore = () => {
    storePromise ??= (async () => {
      if (attemptStoreFactory) return attemptStoreFactory();
      const { createAttemptStore } = await import('../orchestrator/attempt-store.js');
      return createAttemptStore(pool);
    })();
    return storePromise;
  };

  router.post('/attempt-run', internalAuthOrLoopback, async (_req, res) => {
    return res.status(410).json({error:'kernel_runtime_retired',migration:'common-runner fixed workflow/profile required'});
  });

  // 第 57 批：V4 seal 阶段工具面。Worker（HK，无仓库 checkout）只给坐标，Brain 按
  // approved_sha 从 git 读回合同产物（sprint-prd / contract-draft / contract-dod / tests）
  // 并走 materializeApprovedContract 机械封印——Test Contract 可解析、artifact projection、
  // 防篡改守卫、幂等，全部沿用 kernel 的原子函数。校验拒绝回 409 结构化（Worker 据此
  // blocked 或带原因打回 proposer），不吞成 500。
  router.post('/attempt-run/contract-seal', internalAuthOrLoopback, async (req, res) => {
    try {
      const body = req.body ?? {};
      const runId = String(body.run_id ?? '');
      const sprintDir = String(body.sprint_dir ?? '').replace(/\/$/, '');
      const branch = String(body.branch ?? '');
      const approvedSha = String(body.approved_sha ?? '');
      if (!runId) return res.status(400).json({ error: 'run_id_required' });
      if (!sprintDir) return res.status(400).json({ error: 'sprint_dir_required' });
      if (!branch) return res.status(400).json({ error: 'branch_required' });
      if (!SHA40.test(approvedSha)) return res.status(400).json({ error: 'approved_sha_invalid' });
      const version = Number.isInteger(body.version) && body.version >= 1 ? body.version : 1;
      const sealDeps = await getSealDeps();
      let collected;
      try {
        collected = await sealDeps.collectArtifacts({
          sourceRevision: approvedSha,
          sprintDir,
          repo: typeof body.repo === 'string' && body.repo ? body.repo : null,
        });
      } catch (error) {
        return res.status(409).json({ error: 'contract_seal_rejected', detail: String(error?.message ?? error) });
      }
      // 第 77 批（r51 案卷）：引用完备性——合同/PRD 正文引用的 sprint 内**合同期管理文件**
      //（contract-draft/dod、sprint-prd、task-plan、tests/**）必须已在封印集。r51 的合同把
      // task-plan.json 列进范围白名单却从未提交，seal 照封，40 分钟后 generate 才按
      // CONTRACT IS LAW 拦停。fail-fast 到这里：打回 contract 格重试只要 5 分钟。
      // generator 自产文件（red-evidence.md 等）不在管理家族，引用不受限（零误伤）。
      {
        const managedRe = /^(?:contract-draft\.md|contract-dod\.md|sprint-prd\.md|task-plan\.json|tests\/[A-Za-z0-9._/-]+)$/;
        const sealedPaths = new Set((collected.artifacts ?? []).map((a) => a?.path));
        const refText = `${collected.contractContent ?? ''}\n${collected.prdContent ?? ''}`;
        const escaped = sprintDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const refRe = new RegExp(`${escaped}/([A-Za-z0-9._/-]+)`, 'g');
        const missing = new Set();
        let refMatch;
        while ((refMatch = refRe.exec(refText)) !== null) {
          const rel = refMatch[1].replace(/[.]+$/, '');
          if (!managedRe.test(rel)) continue;
          const full = `${sprintDir}/${rel}`;
          if (!sealedPaths.has(full)) missing.add(full);
        }
        if (missing.size > 0) {
          return res.status(409).json({
            error: 'contract_references_missing_artifact',
            missing: [...missing],
          });
        }
      }
      try {
        const sealed = await sealDeps.materialize(pool, {
          runId,
          version,
          branch,
          prdContent: collected.prdContent,
          contractContent: collected.contractContent,
          artifacts: collected.artifacts,
          approvalProvenance: typeof body.approval_provenance === 'string'
            ? body.approval_provenance : null,
        });
        return res.json({ ok: true, run_id: runId, version, sealed: sealed ?? null });
      } catch (error) {
        return res.status(409).json({ error: 'contract_seal_rejected', detail: String(error?.message ?? error) });
      }
    } catch (error) {
      return res.status(500).json({ error: 'contract_seal_failed', detail: String(error?.message ?? error) });
    }
  });

  // 第 66 批：V4 publish 阶段工具面。开 PR 可逆可自动，三条硬规矩：①开 PR 前核对远端
  // 分支头===head_sha（防漂移候选被发布）；②幂等（同分支已有 open PR → 返回既有）；
  // ③绝不启用 auto-merge——merge 公章属于画布人审线。
  router.post('/attempt-run/publish-pr', internalAuthOrLoopback, async (req, res) => {
    try {
      const body = req.body ?? {};
      const repo = typeof body.repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.repo)
        ? body.repo : 'perfectuser21/cecelia';
      const branch = String(body.branch ?? '');
      const headSha = String(body.head_sha ?? '');
      const title = String(body.title ?? '').trim();
      const base = typeof body.base === 'string' && body.base ? body.base : 'main';
      if (!branch.startsWith('cp-')) return res.status(400).json({ error: 'branch_must_be_cp' });
      if (!SHA40.test(headSha)) return res.status(400).json({ error: 'head_sha_invalid' });
      if (!title) return res.status(400).json({ error: 'title_required' });
      const { resolveToken, fetchFn, pushCandidateFn } = await getPublishDeps();
      const token = await resolveToken();
      const gh = (url, opts = {}) => fetchFn(`https://api.github.com/repos/${repo}${url}`, {
        ...opts,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
      let sourceAttemptId = typeof body.source_attempt_id === 'string'
        && ATTEMPT_UUID.test(body.source_attempt_id) ? body.source_attempt_id : null;
      // 第 78 批（r53 案卷）：Commander 台账的 candidate_coordinates 曾只记四字段，
      // publish 工人递不出 source_attempt_id → 端点没尝试 FF 推送就报 mismatch。
      // 服务端自给：按 git_candidate.branch===branch 反查最新 completed generator
      //（74 批同源权威模式），工人带不带字段都能推。
      if (!sourceAttemptId) {
        const { rows: genRows } = await pool.query(
          `SELECT id, result FROM harness_attempts
            WHERE role IN ('generator','generator-fix') AND status IN ('completed','completed_with_concerns')
              AND result::text LIKE '%git_candidate%'
            ORDER BY created_at DESC LIMIT 20`,
        );
        for (const row of genRows) {
          const cand = Array.isArray(row.result?.artifacts)
            ? row.result.artifacts.find((a) => a && typeof a === 'object' && a.type === 'git_candidate')
            : null;
          if (cand?.branch === branch) {
            sourceAttemptId = cand.source_attempt_id ?? row.id;
            break;
          }
        }
      }
      const refResp = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
      let remoteSha = null;
      let pushed = false;
      if (refResp.ok) {
        const refJson = await refResp.json();
        remoteSha = refJson?.object?.sha ?? null;
      } else if (refResp.status === 404 && sourceAttemptId && typeof pushCandidateFn === 'function') {
        // V4：候选从未推远端（设计），ref 404 是常态——从 fleet 候选工作区验头后推送。
        // ref 非 404 的失败（限流/鉴权/网络）不推送，如实报 unavailable。
        const pushResult = await pushCandidateFn({ sourceAttemptId, branch, headSha, repo, token });
        if (!pushResult?.ok) {
          return res.status(409).json({
            error: pushResult?.error ?? 'candidate_push_failed',
            ...(pushResult?.detail ? { detail: pushResult.detail } : {}),
          });
        }
        remoteSha = headSha;
        pushed = true;
      } else {
        return res.status(409).json({ error: 'publish_branch_unavailable', status: refResp.status });
      }
      if (remoteSha !== headSha) {
        // 第 76 批（r47 案卷）：候选分支与 planner 预推的提案分支同名，远端头=旧 PRD
        // commit——判过的候选是它的后代。尝试非强制推送：git 原生 fast-forward-only
        // 即安全栏（非 FF 推送必败），推败才如实报 mismatch。
        if (sourceAttemptId && typeof pushCandidateFn === 'function') {
          const pushResult = await pushCandidateFn({ sourceAttemptId, branch, headSha, repo, token });
          if (pushResult?.ok) {
            remoteSha = headSha;
            pushed = true;
          } else {
            return res.status(409).json({
              error: 'publish_head_mismatch',
              remote_sha: remoteSha,
              expected: headSha,
              push_error: pushResult?.error ?? 'candidate_push_failed',
              ...(pushResult?.detail ? { detail: pushResult.detail } : {}),
            });
          }
        } else {
          return res.status(409).json({ error: 'publish_head_mismatch', remote_sha: remoteSha, expected: headSha });
        }
      }
      const createResp = await gh('/pulls', {
        method: 'POST',
        body: JSON.stringify({
          title,
          head: branch,
          base,
          body: typeof body.body === 'string' ? body.body : '',
          draft: false,
        }),
      });
      if (createResp.status === 201 || createResp.ok) {
        const pr = await createResp.json();
        return res.json({ ok: true, pr_url: pr.html_url, pr_number: pr.number, ...(pushed ? { pushed: true } : {}) });
      }
      if (createResp.status === 422) {
        const listResp = await gh(`/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}`);
        if (listResp.ok) {
          const prs = await listResp.json();
          if (Array.isArray(prs) && prs[0]) {
            return res.json({ ok: true, pr_url: prs[0].html_url, pr_number: prs[0].number, existing: true });
          }
        }
        return res.status(409).json({ error: 'publish_pr_conflict' });
      }
      return res.status(502).json({ error: 'publish_pr_failed', status: createResp.status });
    } catch (error) {
      return res.status(500).json({ error: 'publish_pr_failed', detail: String(error?.message ?? error) });
    }
  });

  // 第 67 批（决策 3d7d64e1，封版唯一例外）：执行已获人审批准的合并。公章语义：
  // Alex 点人审卡片=批准，本端点=执行已批决定（画布只有人审通过才到 merge 格；
  // 这类 PR 标题在 CI auto-merge 豁免名单里，本端点是全系统唯一合并路径）。
  // 防线：①PR 当前头===head_sha（批哪个头合哪个头）②merge 带 sha 双保险
  // ③只合 cp-*→main ④幂等。
  router.post('/attempt-run/merge-pr', internalAuthOrLoopback, async (req, res) => {
    try {
      const body = req.body ?? {};
      const repo = typeof body.repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.repo)
        ? body.repo : 'perfectuser21/cecelia';
      const prNumber = body.pr_number;
      const headSha = String(body.head_sha ?? '');
      if (!Number.isInteger(prNumber) || prNumber < 1) return res.status(400).json({ error: 'pr_number_invalid' });
      if (!SHA40.test(headSha)) return res.status(400).json({ error: 'head_sha_invalid' });
      const { resolveToken, fetchFn } = await getPublishDeps();
      const token = await resolveToken();
      const gh = (url, opts = {}) => fetchFn(`https://api.github.com/repos/${repo}${url}`, {
        ...opts,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      const prResp = await gh(`/pulls/${prNumber}`);
      if (!prResp.ok) return res.status(409).json({ error: 'merge_pr_unavailable', status: prResp.status });
      const pr = await prResp.json();
      if (pr.merged === true) {
        return res.json({ ok: true, merged: true, existing: true, merge_commit_sha: pr.merge_commit_sha ?? null });
      }
      if (pr.state !== 'open') return res.status(409).json({ error: 'merge_pr_not_open', state: pr.state });
      if (pr.base?.ref !== 'main' || !String(pr.head?.ref ?? '').startsWith('cp-')) {
        return res.status(409).json({ error: 'merge_branch_not_allowed', head: pr.head?.ref, base: pr.base?.ref });
      }
      if (pr.head?.sha !== headSha) {
        return res.status(409).json({ error: 'merge_head_mismatch', current_head: pr.head?.sha, approved_head: headSha });
      }
      const mergeResp = await gh(`/pulls/${prNumber}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: 'squash', sha: headSha }),
      });
      if (!mergeResp.ok) {
        return res.status(mergeResp.status === 405 || mergeResp.status === 409 ? 409 : 502)
          .json({ error: 'merge_failed', status: mergeResp.status });
      }
      const merged = await mergeResp.json();
      return res.json({ ok: true, merged: merged.merged === true, merge_commit_sha: merged.sha ?? null });
    } catch (error) {
      return res.status(500).json({ error: 'merge_pr_failed', detail: String(error?.message ?? error) });
    }
  });

  // 第 54 批：显式收尾口——共享 run（keep_open）由调用方在阶段结束时关闭；普通 run 也可提前关。
  router.post('/attempt-run/close', internalAuthOrLoopback, async (req, res) => {
    try {
      const runId = String(req.body?.run_id ?? '');
      if (!runId) return res.status(400).json({ error: 'run_id_required' });
      const { rowCount: runClosed } = await pool.query(
        `UPDATE initiative_runs SET phase='done', completed_at=COALESCE(completed_at, NOW())
          WHERE id = $1::uuid AND orchestrator_host IN ('v4-bridge','v4-bridge-shared')
            AND phase NOT IN ('done','failed')`,
        [runId],
      );
      await pool.query(
        `UPDATE kernel_controller_sessions SET status='closed'
          WHERE run_id = $1::uuid AND source = 'v4-bridge' AND status = 'active'`,
        [runId],
      );
      await finalizeTask(pool, null, 'completed', {
        where: { sql: `id = (SELECT current_task_id FROM initiative_runs WHERE id = $1::uuid) AND trigger_source = 'v4_bridge'`, params: [runId] },
        onlyIfStatus: 'in_progress',
      });
      return res.json({ ok: true, run_id: runId, run_closed: runClosed > 0 });
    } catch (error) {
      return res.status(500).json({ error: 'attempt_run_close_failed', detail: String(error?.message ?? error) });
    }
  });

  router.get('/attempt-run/:attemptId', internalAuthOrLoopback, async (req, res) => {
    try {
      const store = await getStore();
      const row = await store.getById(req.params.attemptId);
      if (!row) return res.status(404).json({ error: 'attempt_not_found' });
      // attempt 终态即收尾桥接 run（只动 orchestrator_host='v4-bridge' 的行；created_source 是封闭枚举，取 foreground_handoff）：run→done、
      // session→closed。不留永活 run 干扰监工停摆扫描与「在途禁合 PR」计数。
      // 第 59 批（金丝雀 #13 案卷）：共享 run（keep_open）的收尾必须整体跳过——此前只有
      // run 行带 host 守卫，session/锚 task 没带：proposer 终态被 GET 一碰锚 task 即
      // completed，relay-watchdog house-keeping 按「task 完了」把活跃共享 run 收割为
      // done，级联 cancel 刚起跑的 reviewer（parent_run_terminal）。共享 run 只由显式
      // close 口收尾。
      let terminalRunHost = null;
      if (TERMINAL_ATTEMPT_STATUSES.has(row.status) && row.run_id) {
        const { rows: hostRows } = await pool.query(
          'SELECT orchestrator_host FROM initiative_runs WHERE id = $1::uuid',
          [row.run_id],
        );
        terminalRunHost = hostRows[0]?.orchestrator_host ?? null;
      }
      if (terminalRunHost === 'v4-bridge') {
        await pool.query(
          `UPDATE initiative_runs SET phase='done', completed_at=COALESCE(completed_at, NOW())
            WHERE id = $1::uuid AND orchestrator_host = 'v4-bridge' AND phase NOT IN ('done','failed')`,
          [row.run_id],
        );
        await pool.query(
          `UPDATE kernel_controller_sessions SET status='closed'
            WHERE run_id = $1::uuid AND source = 'v4-bridge' AND status = 'active'`,
          [row.run_id],
        );
        // 锚 task 一并闭合（52 批漏了这步，data 型 in_progress 锚会永久堆积）。
        // 第 55 批：tasks 表没有 source_id 列，必须经 run.current_task_id 定位。
        await finalizeTask(pool, null, 'completed', {
          where: { sql: `id = (SELECT current_task_id FROM initiative_runs WHERE id = $1::uuid) AND trigger_source = 'v4_bridge'`, params: [row.run_id] },
          onlyIfStatus: 'in_progress',
        });
      }
      const out = {};
      for (const key of ATTEMPT_PROJECTION) out[key] = row[key] ?? null;
      // 第 58 批：暴露首次派发冻结的基线（金丝雀 #8：同 run 两次派发各自现解析 main 头，
      // 中间 main 前进 → 合同基线与 reviewer 权威基线必然冲突）。Worker 取此值传给同一
      // workflow run 的所有后续派发（payload.base_sha 显式基线）。bundle 其余内容不泄。
      out.workspace_base_sha = row.task_bundle?.inputs?.workspace_spec?.base_sha ?? null;
      return res.json(out);
    } catch (error) {
      return res.status(500).json({ error: 'attempt_lookup_failed', detail: String(error?.message ?? error) });
    }
  });

  return router;
}

export default createHarnessAttemptRunRouter;
