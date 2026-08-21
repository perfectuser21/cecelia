import { normalizeFailureSignature } from './convergence-signatures.js';
import { SingletonConflictError } from './decision-log.js';
import { writeHeartbeat } from './heartbeat.js';
import { finalizeKernelRun } from './kernel-run-store.js';
import { normalizeEvaluatorBrainResult } from './evaluator-brain-result.js';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function prNumber(prUrl) {
  const value = String(prUrl ?? '').match(/\/pull\/(\d+)(?:\/|$)/)?.[1];
  return value ? Number(value) : null;
}

async function appendJudgeVerdict(
  pool,
  ctx,
  verdict,
  feedback,
  judgeFailureClass,
  judgeFailureSignature,
  judgeCoverage,
) {
  const evaluateVerdict = ctx.observed.evaluateVerdict ?? {};
  const evaluatorFailureClass = evaluateVerdict.failure_class ?? null;
  // Judge classification is an independent contract field. Missing means
  // unknown and must not be silently filled from the evaluator verdict.
  const failureClass = judgeFailureClass ?? null;
  const failureSignature = normalizeFailureSignature(judgeFailureSignature);
  const contractIdentity = ctx.bundle.inputs.contract_identity ?? null;
  const targetHeadSha = ctx.observed.pr?.head_sha
    ?? ctx.observed.candidate?.head_sha
    ?? ctx.bundle.inputs.candidate?.head_sha
    ?? null;

  await pool.query(
    `INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1,
            COALESCE(MAX(hop), 0) + 1,
            $2::jsonb,
            'evaluate',
            $3,
            'verdict:judge',
            $4::jsonb
       FROM orchestrator_decision_log
      WHERE run_id = $1`,
    [
      ctx.runId,
      JSON.stringify({
        [ctx.observed.pr ? 'pr' : 'candidate']: { head_sha: targetHeadSha },
      }),
      verdict === 'PASS' ? 'allow' : 'deny:judge_fail',
      JSON.stringify({
        verdict,
        pr_head_sha: targetHeadSha,
        feedback: feedback ?? null,
        failure_class: failureClass,
        ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
        ...(Array.isArray(judgeCoverage) ? { coverage: judgeCoverage } : {}),
        ...(contractIdentity == null ? {} : { contract_identity: contractIdentity }),
        evaluator_failure_class: evaluatorFailureClass,
      }),
    ],
  );
}

export function createKernelHandlers(deps) {
  return Object.freeze({
    async 'spawn:judge'(ctx) {
      const evaluator = ctx.observed.evaluateVerdict ?? {};
      const evaluateResult = ctx.observed.evaluateResult ?? null;
      const brainResult = normalizeEvaluatorBrainResult(evaluateResult)
        ?? ctx.observed.callbackResult;
      const contract = ctx.bundle.inputs.contract ?? {};
      const candidateHeadSha = ctx.observed.candidate?.head_sha
        ?? ctx.bundle.inputs.candidate?.head_sha
        ?? null;
      const targetHeadSha = ctx.observed.pr?.head_sha ?? candidateHeadSha;
      const result = await deps.judgeGate({
        agentVerdict: evaluator.verdict ?? evaluateResult?.decision?.outcome,
        agentFeedback: evaluator.feedback ?? evaluateResult?.decision?.reason ?? null,
        brainResult,
        transcript: evaluateResult?.transcript ?? ctx.observed.callbackResult?.transcript,
        worktreePath: ctx.bundle.inputs.worktree_path,
        sprintDir: ctx.bundle.inputs.sprint_dir,
        contractText: contract.contract_content ?? null,
        prdText: contract.prd_content ?? null,
        frozenContractArtifacts: ctx.bundle.inputs.artifacts,
        requiredCommandEvidence: ctx.bundle.inputs.required_command_evidence,
        taskId: ctx.taskId,
        instanceLabel: `kernel-${String(ctx.attempt.id).slice(0, 8)}`,
        promptDir: deps.promptDir,
        stageFacts: {
          current_stage: ctx.observed.pr ? 'independent_judge' : 'local_candidate',
          pr_state: ctx.observed.pr?.state ?? null,
          pr_merged: ctx.observed.pr?.merged === true,
          head_sha: targetHeadSha,
          merge_gate_approved: ctx.observed.reviewApproved === true,
        },
      }, { strict: true, dbPool: deps.pool });

      if (result.judged !== true) {
        await deps.attemptStore.complete(ctx.attempt.id, {
          contract_version: '1.0',
          attempt_id: ctx.attempt.id,
          status: 'needs_context',
          summary: 'Independent judge could not produce a grounded verdict.',
          artifacts: [],
          checks: [],
          decision: { outcome: 'needs_context', reason: result.judgeError ?? 'independent evidence unavailable' },
          error: null,
          provider_metadata: { provider: 'independent-judge', session_id: null },
        });
        return { status: 'NEEDS_CONTEXT', detail: 'independent judge did not run' };
      }

      await appendJudgeVerdict(
        deps.pool,
        ctx,
        result.verdict,
        result.feedback,
        result.failure_class ?? null,
        result.failure_signature ?? null,
        result.coverage,
      );
      const failureSignature = normalizeFailureSignature(result.failure_signature);
      await deps.attemptStore.complete(ctx.attempt.id, {
        contract_version: '1.0',
        attempt_id: ctx.attempt.id,
        status: 'completed',
        summary: result.feedback ?? `Independent judge: ${result.verdict}`,
        artifacts: [],
        checks: [],
        decision: {
          outcome: result.verdict,
          reason: 'independent judge verdict',
          ...(result.failure_class == null ? {} : { failure_class: result.failure_class }),
          ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
          ...(Array.isArray(result.coverage) ? { coverage: result.coverage } : {}),
          ...(ctx.bundle.inputs.contract_identity == null
            ? {}
            : { contract_identity: ctx.bundle.inputs.contract_identity }),
        },
        error: null,
        provider_metadata: { provider: 'independent-judge', session_id: null },
      });
      return { status: 'DONE', detail: `judge:${result.verdict}` };
    },

    async 'wait:human_review'(ctx) {
      const url = ctx.observed.pr?.url;
      const number = prNumber(url);
      // 本地候选流程（Kernel 常态）没有远端 PR，只有 Runner 冻结过的候选分支 + head_sha。
      // 人审是 Judge FAIL 后的正常出口，不能因为"拿不到 PR URL"就变成死路：
      // 2026-08-18 run c4339041 实证 —— BLOCKED 重复后被 blocked_same_state 判死。
      // 有 PR 时行为不变（预览环境按 PR 号起）；只有候选时通知带分支+SHA，请人直接看候选。
      const candidate = ctx.observed.candidate ?? null;
      if (!number) {
        const candidateSha = candidate?.head_sha ?? null;
        const candidateBranch = candidate?.branch ?? null;
        if (!candidateSha || !candidateBranch) {
          return { status: 'BLOCKED', detail: 'human review requires a PR URL or a frozen candidate' };
        }
        await deps.notifyReview({
          task_id: ctx.taskId,
          title: ctx.observed.task?.title,
          pr_url: null,
          candidate_branch: candidateBranch,
          preview_url: null,
          run_id: ctx.runId,
          pr_head_sha: candidateSha,
        });
        return {
          status: 'DONE',
          detail: `human review requested (local candidate ${candidateBranch}@${candidateSha.slice(0, 9)})`,
        };
      }
      const payload = ctx.observed.task?.payload ?? {};
      const branch = payload.pr_branch ?? payload.branch_name ?? `pr-${number}`;
      const port = await deps.allocatePort(number, branch, payload.base_repo, deps.pool);
      const preview = deps.spawnReviewPreview(port, number);
      if (preview?.status !== 0) {
        return { status: 'BLOCKED', detail: `review preview failed: ${preview?.stderr ?? preview?.status}` };
      }
      const previewUrl = `${deps.previewOrigin ?? 'http://38.23.47.81'}:${port}`;
      // run_id/pr_head_sha 让通知能带一条可直接执行的审批 curl 模板（案卷 task
      // 31b93fd4）——不传 review_request_hop：该 hop 在这条 decision-log 行 append
      // 之前还不存在，approve 端点已改为按 run_id+head_sha 自动解析最新待审请求。
      await deps.notifyReview({
        task_id: ctx.taskId,
        title: ctx.observed.task?.title,
        pr_url: url,
        preview_url: previewUrl,
        run_id: ctx.runId,
        pr_head_sha: ctx.observed.pr?.head_sha ?? null,
      });
      return { status: 'DONE', detail: `human review requested: ${previewUrl}` };
    },

    async merge_pr(ctx) {
      const pr = ctx.observed.pr;
      if (!pr?.url) return { status: 'BLOCKED', detail: 'merge requires PR URL' };
      if (pr.merged || pr.state === 'MERGED') return { status: 'DONE', detail: 'already merged' };
      // run 08b3b2b5 案卷：GitHub GraphQL mergeStateStatus 的冲突枚举值是
      // 'DIRTY'（'CONFLICTING' 属于 `mergeable` 字段的枚举）。只判 CONFLICTING
      // 时 DIRTY 漏网直接 `gh pr merge` → "not mergeable" throw →
      // kernel_process_fatal 烧掉整条 run。两个值都拦，fail-closed。
      if (pr.mergeStateStatus === 'DIRTY' || pr.mergeStateStatus === 'CONFLICTING') {
        return { status: 'BLOCKED', detail: 'PR has merge conflicts' };
      }
      if (pr.mergeStateStatus === 'BEHIND') {
        const priorRebases = (ctx.observed.decisionLog ?? []).filter(
          (row) => row.action === 'merge_pr' && row.observed?.pr?.mergeStateStatus === 'BEHIND',
        ).length;
        if (priorRebases >= 3) return { status: 'BLOCKED', detail: 'rebase attempt cap reached' };
        // run 986a51d3 案卷：`gh pr update-branch` 是 gh 2.46+ 才有的子命令，生产
        // Brain 容器 gh 2.45 报 unknown command → kernel_process_fatal 整 run 收死。
        // 改走版本无关的 REST API（PUT /repos/{owner}/{repo}/pulls/{n}/update-branch）。
        const prPath = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pr.url ?? '');
        if (!prPath) return { status: 'BLOCKED', detail: 'unparseable PR URL for update-branch' };
        deps.execCmd(
          `gh api ${shellQuote(`repos/${prPath[1]}/${prPath[2]}/pulls/${prPath[3]}/update-branch`)} -X PUT`,
        );
        return { status: 'DONE_WITH_CONCERNS', detail: 'updated PR branch; rechecking gates' };
      }
      if (ctx.impactGateReceipt?.contract_hash && deps.verifyImpactMerge) {
        const fence = await deps.verifyImpactMerge({
          taskId: ctx.impactGateReceipt.source_task_id ?? ctx.taskId,
          runId: ctx.runId,
          headRevision: pr.head_sha,
          expectedContractHash: ctx.impactGateReceipt.contract_hash,
        });
        if (fence.gate !== 'pass') {
          return { status: 'BLOCKED', detail: fence.reason ?? 'impact merge fence failed' };
        }
      }
      // merge 命令失败（观测与 GitHub 实况的竞态：刚变 DIRTY/BEHIND、head 刚动）
      // 是可观测、可重试的外部状态，不是进程性 fatal——降级 BLOCKED 让下一轮
      // 重新观测路由，绝不因一条 gh 命令烧掉整条 run（run 08b3b2b5 案卷）。
      try {
        deps.execCmd(
          `gh pr merge ${shellQuote(pr.url)} --squash --delete-branch `
          + `--match-head-commit ${shellQuote(pr.head_sha)}`,
        );
      } catch (error) {
        return {
          status: 'BLOCKED',
          detail: `merge command failed: ${String(error?.message ?? error).slice(0, 200)}`,
        };
      }
      return { status: 'DONE', detail: 'merge requested' };
    },

    async report(ctx) {
      const { observed } = ctx;
      const payload = observed.task?.payload ?? {};
      const proveControllerOwnership = deps.proveControllerOwnership ?? writeHeartbeat;
      try {
        await proveControllerOwnership(deps.pool, {
          runId: ctx.runId,
          controllerSessionId: ctx.controllerSessionId,
          controllerGeneration: ctx.controllerGeneration,
          host: observed.run?.orchestrator_host ?? 'kernel-v1',
          pid: observed.run?.orchestrator_pid ?? process.pid,
          now: deps.now?.() ?? new Date(),
        });
      } catch (error) {
        if (['controller_lease_renewal_lost', 'controller_lease_identity_missing']
          .includes(error?.message)) {
          throw new SingletonConflictError(ctx.runId, 'controller-ownership', error);
        }
        throw error;
      }
      await deps.promote(ctx.taskId, { merged: true, pr_url: observed.pr?.url }, observed.pr?.url, deps.pool);
      const handoff = deps.buildHandoff({
        task_id: ctx.taskId,
        initiative_id: observed.run?.initiative_id,
        journey_id: payload.journey_id,
        title: observed.task?.title,
        verdict: 'PASS',
        done: ['Provider-neutral Harness gates passed and PR merged.'],
        next_steps: ['完成，无下一步'],
        artifacts: {
          pr_urls: observed.pr?.url ? [observed.pr.url] : [],
          sprint_dir: payload.sprint_dir,
          branch: payload.pr_branch,
        },
      });
      await deps.saveHandoff({ pool: deps.pool }, handoff);
      await deps.syncOkr(deps.pool, ctx.taskId, 'done');
      await deps.spawnStaging({
        pr_url: observed.pr?.url,
        pr_branch: payload.pr_branch,
        sub_task_id: ctx.taskId,
        initiative_id: observed.run?.initiative_id,
        journey_id: payload.journey_id,
        base_repo: payload.base_repo,
        project_id: payload.project_id,
      });
      await deps.cleanup(ctx.runId);

      const finalizeRun = deps.finalizeRun ?? finalizeKernelRun;
      const finalization = {
        runId: ctx.runId,
        expectedTaskId: ctx.taskId,
        expectedControllerSessionId: ctx.controllerSessionId,
        expectedControllerGeneration: ctx.controllerGeneration,
        requireActiveControllerAuthority: true,
        outcome: 'done',
      };
      if (payload.harness_gap_id) {
        if (typeof deps.resolveCompletedRepairGaps !== 'function') {
          throw new Error('repair gap resolution authority is unavailable');
        }
        finalization.afterTaskFinalized = (client) => deps.resolveCompletedRepairGaps(client, {
          repairTaskId: ctx.taskId,
          runId: ctx.runId,
        });
      }
      const finalized = await finalizeRun(deps.pool, finalization);
      if (finalized?.ownershipChanged) {
        throw new SingletonConflictError(ctx.runId, 'controller-ownership', null);
      }
      return { status: 'DONE', detail: 'report chain completed' };
    },
  });
}

export const __test__ = { shellQuote, prNumber, appendJudgeVerdict };
