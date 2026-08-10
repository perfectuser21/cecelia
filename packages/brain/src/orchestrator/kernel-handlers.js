import { normalizeFailureSignature } from './convergence-signatures.js';
import { finalizeKernelRun } from './kernel-run-store.js';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function prNumber(prUrl) {
  const value = String(prUrl ?? '').match(/\/pull\/(\d+)(?:\/|$)/)?.[1];
  return value ? Number(value) : null;
}

function evaluatorBrainResult(result) {
  if (!result) return null;
  if (Array.isArray(result.behavior_tests)) return result;
  return {
    verdict: result.decision?.outcome ?? null,
    behavior_tests: Array.isArray(result.checks) ? result.checks : [],
    judgments_written: result.judgments_written ?? result.decision?.judgments_written,
    summary: result.summary ?? null,
  };
}

async function appendJudgeVerdict(
  pool,
  ctx,
  verdict,
  feedback,
  judgeFailureClass,
  judgeFailureSignature,
) {
  const evaluateVerdict = ctx.observed.evaluateVerdict ?? {};
  const evaluatorFailureClass = evaluateVerdict.failure_class ?? null;
  // Judge classification is an independent contract field. Missing means
  // unknown and must not be silently filled from the evaluator verdict.
  const failureClass = judgeFailureClass ?? null;
  const failureSignature = normalizeFailureSignature(judgeFailureSignature);

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
      JSON.stringify({ pr: { head_sha: ctx.observed.pr?.head_sha ?? null } }),
      verdict === 'PASS' ? 'allow' : 'deny:judge_fail',
      JSON.stringify({
        verdict,
        pr_head_sha: ctx.observed.pr?.head_sha ?? null,
        feedback: feedback ?? null,
        failure_class: failureClass,
        ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
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
      const brainResult = evaluatorBrainResult(evaluateResult) ?? ctx.observed.callbackResult;
      const contract = ctx.bundle.inputs.contract ?? {};
      const result = await deps.judgeGate({
        agentVerdict: evaluator.verdict ?? evaluateResult?.decision?.outcome,
        agentFeedback: evaluator.feedback ?? evaluateResult?.decision?.reason ?? null,
        brainResult,
        transcript: evaluateResult?.transcript ?? ctx.observed.callbackResult?.transcript,
        worktreePath: ctx.bundle.inputs.worktree_path,
        sprintDir: ctx.bundle.inputs.sprint_dir,
        contractText: contract.contract_content ?? null,
        prdText: contract.prd_content ?? null,
        taskId: ctx.taskId,
        instanceLabel: `kernel-${String(ctx.attempt.id).slice(0, 8)}`,
        promptDir: deps.promptDir,
        stageFacts: {
          current_stage: 'independent_judge',
          pr_state: ctx.observed.pr?.state ?? null,
          pr_merged: ctx.observed.pr?.merged === true,
          head_sha: ctx.observed.pr?.head_sha ?? null,
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
        },
        error: null,
        provider_metadata: { provider: 'independent-judge', session_id: null },
      });
      return { status: 'DONE', detail: `judge:${result.verdict}` };
    },

    async 'wait:human_review'(ctx) {
      const url = ctx.observed.pr?.url;
      const number = prNumber(url);
      if (!number) return { status: 'BLOCKED', detail: 'human review requires a valid PR URL' };
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
      if (pr.mergeStateStatus === 'CONFLICTING') {
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
      // 合并权单一裁决闸（PRD「必须实现」第 1 条）：harness-owned PR 上的 `harness-judge`
      // required check 默认非 success，三条合并通道（CI 通用 auto-merge / engine-pr-watchdog
      // / kernel 自身）都得等它 success 才能合并。这里是唯一置 success 的执行点——只有走完
      // mergeGate（loop.js F6 双保险已校验 allow）到达 merge_pr 才会执行，且必须在真正
      // `gh pr merge` **之前**发出，保证「judge PASS 前物理不可合并」。
      // 走版本无关 REST（gh api statuses），对齐 update-branch 的 gh 2.45 教训。
      const statusPath = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pr.url ?? '');
      if (pr.head_sha && statusPath) {
        deps.execCmd(
          `gh api ${shellQuote(`repos/${statusPath[1]}/${statusPath[2]}/statuses/${pr.head_sha}`)} ` +
            `-X POST -f state=success -f context=harness-judge ` +
            `-f ${shellQuote('description=harness kernel mergeGate passed (evaluate+judge)')}`,
        );
      }
      deps.execCmd(`gh pr merge ${shellQuote(pr.url)} --squash --delete-branch`);
      return { status: 'DONE', detail: 'merge requested' };
    },

    async report(ctx) {
      const { observed } = ctx;
      const payload = observed.task?.payload ?? {};
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
      await finalizeRun(deps.pool, {
        runId: ctx.runId,
        expectedTaskId: ctx.taskId,
        outcome: 'done',
      });
      return { status: 'DONE', detail: 'report chain completed' };
    },
  });
}

export const __test__ = { shellQuote, prNumber, appendJudgeVerdict };
