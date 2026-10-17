// evaluate 活动（evaluator 真人 QA）：CI 绿后、合并前的门（决策 02d8e749）。
// 在 PR 预览环境（lib/preview.mjs）里，全新 claude 会话只拿 01 需求与 02 的 QA 场景，像真人 QA 一样黑盒验收：
// （QA 模式按仓库，C6：local 仓库如 zenithjoy 第一阶段不起预览，在 PR worktree 里黑盒验 CLI / 脚本 / node 进程，提示词 evaluate-local）
// 按 Q-n 逐条操作 + 探索式测试，写 <sprint_dir>/05-qa-report-r<round>.md。运行期间 03/04（开发自述与自测）藏起，结束放回。
// 程序判：报告格式与 Q-n 覆盖 → 证据须在执行记录里 → 禁单元测试当证据 → 禁碰生产 Brain → PASS/FAIL。
// 产品不合格（qa.verdict FAIL）是正常结果：completed + outputs.qa，交给 runner 的修复环；报告/会话本身不合格才是活动失败。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail, log } from '../lib/protocol.mjs';
import { provenanceRequired, beginEvaluateIsolation, compileCurrentQaEvidence } from '../lib/record-provenance.mjs';
import { sourceFacts } from '../runner/lib/source-provenance.mjs';
import { intentIdsError } from '../lib/intent.mjs';
import { qaScenarios, SPEC_FILE, INTENT_FILE } from '../lib/spec-check.mjs';
import { parseQaReport, judgeQa, unitTestEvidence, productionTouches, trivialAssertions, screenshotProblems } from '../lib/qa-report.mjs';
import { bashExecutions, unverifiedItems, sessionCostUsd } from '../lib/transcript.mjs';
import { waitPreview, DEFAULT_PREVIEW_API } from '../lib/preview.mjs';
import { createPreviewBridge } from '../lib/preview-bridge.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, headSha, snapshotChanges, outOfScopeChanges,
} from '../lib/claude.mjs';
import { chainTamperFailure, hideFile, recoverHidden } from '../lib/guards.mjs';
import { qaMode, productionPatterns } from '../lib/repo-profile.mjs';

const HIDDEN_FILES = ['03-build.md', '04-evidence.md'];
const TIMEOUT = { envVar: 'CODING_WF_EVALUATE_TIMEOUT_MS', defaultMs: 2400000, reserveMs: 60000 };
const SESSION_FLAGS = ['--output-format', 'stream-json', '--verbose', '--setting-sources', 'user'];
// 允许 Bash 真实操作；不许提交、改历史、切分支、推送、开 PR
const DENIED = [
  'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git rebase:*)', 'Bash(gh:*)',
];

const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** 上一轮独立裁判判 QA 没真验到时 runner 传来的裁决（相对 worktree）：必须是 sprint 目录里存在的文件。→ 绝对路径 / '无' / null（非法）。 */
function judgeFeedbackPath(worktree, dir, rel) {
  if (rel === undefined || rel === null || rel === '') return '无';
  const abs = path.resolve(worktree, String(rel));
  return path.dirname(abs) === path.resolve(dir) && fs.existsSync(abs) ? abs : null;
}
const brief = (items) => items.map(({ id, covers, severity, scene, command, output }) => ({
  id, covers, ...(severity ? { severity, scene } : {}), command, output_tail: String(output ?? '').slice(-1000),
}));

/** 会话结束后：HEAD 不许动、sprint 目录外不许写、01/02 不许改。 */
async function guardFailure({ worktree, dir, sprintDir, input, before }) {
  const headAfter = await headSha(worktree);
  if (before.head && headAfter !== before.head) return fail('fatal', 'evaluate_head_moved', { evidence: [{ head_before: before.head, head_after: headAfter }] });
  const tampered = chainTamperFailure(dir, input);
  if (tampered) return tampered;
  const stray = await outOfScopeChanges(worktree, sprintDir, before.changes, 'evaluate');
  if (stray.length > 0) return fail('fatal', 'evaluate_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
  return null;
}

/** 报告判分；产品 PASS/FAIL 都返回 completed。 */
function judge({ reportPath, reportFile, qaIds, stdout, worktree, dir, shotsDir, round, env, cost, production, provider, model }) {
  const executions = bashExecutions(stdout);
  const prod = productionTouches(executions, production);
  if (prod.length > 0) return fail('fatal', 'evaluate_touched_production', { evidence: [{ commands: prod }] });
  if (!fs.existsSync(reportPath)) return fail('retryable', 'qa_report_missing');
  const rel = path.relative(worktree, reportPath).split(path.sep).join('/');
  let compiled;
  try { compiled = compileCurrentQaEvidence(rel); } catch (error) {
    return fail('retryable', 'qa_evidence_unverified', { evidence: [{ error: error.message }] });
  }
  const reportText = compiled ?? fs.readFileSync(reportPath, 'utf8');
  const report = parseQaReport(reportText);
  const judged = judgeQa(report, qaIds);
  if (judged.reason) return fail('retryable', judged.reason, { evidence: [{ errors: judged.errors, missing: judged.missing }] });
  const items = [...report.tests, ...report.findings];
  const unit = unitTestEvidence(items);
  if (unit.length > 0) return fail('retryable', 'qa_unit_test_evidence', { evidence: [{ items: unit }] });
  const unverified = unverifiedItems(items, executions, { worktree: [worktree, fs.realpathSync(worktree)] });
  if (unverified.length > 0) return fail('retryable', 'qa_evidence_unverified', { evidence: [{ unverified }] });
  // 恒真断言（审计 #36）：判 PASS 的命令吞掉失败 / 只回显结论
  const trivial = trivialAssertions(items);
  if (trivial.length > 0) return fail('retryable', 'qa_trivial_assertion', { evidence: [{ items: trivial }] });
  // 截图（审计 #37）：引用的截图要真存在，用了浏览器的条目要真留下截图
  const shots = screenshotProblems({ reportText, items, executions, sprintDir: dir, shotsDir });
  if (shots.length > 0) return fail('retryable', 'qa_screenshot_missing', { evidence: [{ problems: shots }] });
  const qa = {
    verdict: judged.verdict, round, env, provider, model: model ?? null, failed: brief(judged.failed), blocking: brief(judged.blocking),
    cannot_verify: judged.cannot_verify.map(({ id, covers, reason }) => ({ id, covers, reason })), cost_usd: cost,
  };
  log(`[evaluate] 第 ${round} 轮真人 QA ${judged.verdict}：失败场景 ${qa.failed.map((i) => i.id).join(',') || '无'}，阻断发现 ${qa.blocking.map((i) => i.id).join(',') || '无'}，验不了 ${qa.cannot_verify.map((i) => i.id).join(',') || '无'}`);
  return { status: 'completed', outputs: { qa_report_file: reportFile, qa }, evidence: [`${reportFile}：${judged.verdict}`] };
}

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds } = input;
  const { dir } = validateBase(input);
  const idsError = intentIdsError(intentIds);
  if (idsError) return fail('fatal', idsError);
  const tamperedBefore = chainTamperFailure(dir, input);
  if (tamperedBefore) return tamperedBefore;
  const specPath = path.join(dir, SPEC_FILE);
  const qaIds = fs.existsSync(specPath) ? qaScenarios(fs.readFileSync(specPath, 'utf8')).map((q) => q.id) : [];
  if (qaIds.length === 0) return fail('fatal', 'qa_missing');
  const judgeFeedback = judgeFeedbackPath(worktree, dir, input.judge_feedback);
  if (!judgeFeedback) return fail('fatal', 'judge_feedback_invalid', { evidence: [{ judge_feedback: input.judge_feedback }] });

  const local = qaMode(input.repo_profile) === 'local';
  const production = productionPatterns(input.repo_profile);
  let preview = null;
  if (!local) {
    preview = await waitPreview(input.pr_number, {
      api: process.env.CODING_WF_PREVIEW_API || DEFAULT_PREVIEW_API,
      timeoutMs: posInt(process.env.CODING_WF_PREVIEW_WAIT_MS, 20 * 60 * 1000),
      intervalMs: posInt(process.env.CODING_WF_PREVIEW_INTERVAL_MS, 15000),
      host: process.env.CODING_WF_PREVIEW_HOST || 'localhost',
      // 给了要验的 head：预览部署的必须正是它（审计 P0 #2）
      expectSha: input.head_sha || null,
    });
    if (preview.state === 'stale') return fail('retryable', 'preview_stale', { evidence: [{ pr: input.pr_number, expected: input.head_sha, preview_sha: preview.sha }] });
    if (preview.state !== 'active') return fail('retryable', 'preview_unavailable', { evidence: [{ pr: input.pr_number, preview }] });
  }

  const round = posInt(input.round, 1);
  // 独立从受保护事件和精确 Git 验证，不采信任务 JSON 传来的 PASS/投影。
  const sourceProvenance = provenanceRequired(worktree)
    ? sourceFacts(worktree, { taskId: input.task_id, sprintDir }, input.head_sha || await headSha(worktree)) : null;
  const reportFile = `05-qa-report-r${round}.md`;
  const reportPath = path.join(dir, reportFile);
  const hiddenPaths = HIDDEN_FILES.map((f) => path.join(dir, f));
  for (const p of hiddenPaths) if (await recoverHidden(worktree, p)) log(`[evaluate] 已放回上次残留的 ${path.basename(p)}`);
  fs.rmSync(reportPath, { force: true });

  const prompt = loadPrompt(local ? 'evaluate-local' : 'evaluate', {
    TASK_ID: input.task_id,
    INTENT_PATH: path.join(dir, INTENT_FILE),
    SPEC_PATH: specPath,
    REPORT_PATH: reportPath,
    SPRINT_DIR: dir,
    SHOTS_DIR: path.join(dir, `qa-r${round}`),
    QA_IDS: qaIds.join(','),
    ...(local ? { WORKTREE: worktree, PRODUCTION: production.join(' | ') } : { PREVIEW_URL: preview.url }),
    ROUND: String(round),
    TESTED_HEAD: input.head_sha || await headSha(worktree) || '未知',
    SOURCE_PROVENANCE: sourceProvenance ? JSON.stringify(sourceProvenance) : '本仓未接入来源凭证，不能据此宣称来源通过',
    QA_EVIDENCE_POLICY: sourceProvenance ? 'qa_native_compiled_v1' : 'legacy_model_report',
    QA_EVIDENCE_ITEM_RULE: sourceProvenance
      ? '- 每个条目必须有 ```command 代码块及 `证据来源: controller_native`；由控制器绑定本轮实际执行记录并装配原生输出与退出码。页面操作仍写实际 Playwright 命令和截图路径。'
      : '- 每个条目必须有真实执行的 ```command 和完整逐字的 ```output 代码块；页面操作仍写实际 Playwright 命令和截图路径。',
    QA_EVIDENCE_ASSEMBLY_RULES: sourceProvenance
      ? '原生证据装配规则：保留 PASS/FAIL/CANNOT_VERIFY 判定、对应项及原因。唯一执行过的精确命令可直接绑定；重复命令可写 `native_occurrence: N`，N 是同一精确 command 在本轮原生 completed 命令账中的 1 基序号（不是并发 start 顺序）。先按序号选中，再校验所给 native_item_id、退出码和 output 是否一致；非法或越界序号拒绝。也可使用已知的精确 native_item_id，或可唯一匹配的完整输出与退出码；没有足够 selector 的重复命令拒绝，不能任挑成功或最后一次。不要猜测内部 item_id。若填写 output，必须完整逐字匹配原件，包括第六行以后、空白和 CRLF。output 围栏只能放原始输出，退出码另列，禁止加 process_exit 等注释。真正零字节输出和空白输出不同。包装器摘要不能冒充子命令完整 stdout/stderr/exit；所有失败和重试均保留在完整有序命令账，账完整也不代表产品通过。'
      : '证据提交规则：每个条目必须逐字记录实际执行的 command 和完整原始 output，不得省略输出或期待控制器自动填充。保留 PASS/FAIL/CANNOT_VERIFY 判定、对应项及原因；输出不得截断、改写或添加注释。失败和重复执行也须如实留证，退出码另列；命令成功不代表产品通过。',
    JUDGE_FEEDBACK: judgeFeedback,
    // 重试必须带新信息（审计 #33）：上次评估被判不合格的原因（runner 记下传入）；单行，防止伪造机器可读行
    PREV_ERRORS: typeof input.prev_errors === 'string' && input.prev_errors.trim() ? input.prev_errors.replace(/\s+/g, ' ').trim().slice(0, 2000) : '无',
  });
  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', ...SESSION_FLAGS, '--allowedTools', 'Bash', '--disallowedTools', ...DENIED];
  const before = { head: await headSha(worktree), changes: await snapshotChanges(worktree) };

  const state = { hidden: [], isolation: null, claudeRunning: false, bridge: null };
  const restoreAll = () => state.isolation ? state.isolation.restore() : state.hidden.map((h) => h.restore()).every(Boolean);
  const onSigterm = () => {
    void state.bridge?.close();
    if (state.isolation) state.isolation.abort();else restoreAll();
    if (!state.claudeRunning) process.exit(2);
  };
  process.on('SIGTERM', onSigterm);
  let result;
  try {
    if (!local && process.env.CODING_WF_PROVIDER === 'codex') {
      try {
        state.bridge = await createPreviewBridge({ origin: preview.url, headSha: input.head_sha, prNumber: input.pr_number, production });
        args[1] += '\n\n' + loadPrompt('evaluate-codex-transport', {});
      } catch (error) {
        return fail('retryable', 'preview_unavailable', { evidence: [{ bridge_error: error.message }] });
      }
    }
    state.isolation = beginEvaluateIsolation();
    if (sourceProvenance && !state.isolation) throw Error('record_provenance_isolation_missing');
    if (state.isolation) args[1] += '\n\nCONTROLLER_WORKSPACE_ISOLATION: ' + JSON.stringify(state.isolation.hiddenFacts())
      + '\n以上仅说明可信控制器在本轮会话前暂移03/04，尚未声明恢复；不豁免产品范围、其他文件或原生命令验收。不得自行读取或改写持有副本。';
    else for (const p of hiddenPaths) state.hidden.push(await hideFile(worktree, p));
    state.claudeRunning = true;
    const run = await runClaude({ args, cwd: worktree, timeoutMs: claudeTimeoutMs(input.budget, TIMEOUT), tag: 'evaluate', isolateRemote: true,
      ...(state.bridge ? { nativeOptions: { previewCapability: state.bridge.capability } } : {}),
    });
    state.claudeRunning = false;
    // 会话执行记录落盘留证（runner 传 transcript_path；判越界/证据不实时可复核）
    if (input.transcript_path) {
      try {
        fs.mkdirSync(path.dirname(input.transcript_path), { recursive: true });
        fs.writeFileSync(input.transcript_path, run.stdout ?? '');
      } catch (error) {
        log(`[evaluate] 执行记录落盘失败：${error?.message || error}`);
      }
    }
    // A model report cannot override controller-observed head drift, even if it claims PASS.
    if (state.bridge) {
      try { await state.bridge.verify(); } catch (error) {
        result = fail('retryable', error.message === 'preview_sha_mismatch' ? 'preview_stale' : 'preview_unavailable',
          { evidence: [{ bridge_error: error.message, expected: input.head_sha }] });
      }
    }
    result ??= claudeFailure(run, { streamJson: true }) ?? (await guardFailure({ worktree, dir, sprintDir, input, before }));
    result ??= judge({
      reportPath, reportFile, qaIds, stdout: run.stdout, worktree, dir, shotsDir: path.join(dir, `qa-r${round}`), round,
      env: local ? { kind: 'local', worktree } : { kind: 'preview', url: preview.url, ...(preview.sha ? { sha: preview.sha } : {}),
        ...(state.bridge ? { transport: 'unix_http_browser' } : {}) },
      cost: run.cost_usd === undefined ? sessionCostUsd(run.stdout) : run.cost_usd, production,
      provider: run.provider, model: run.model,
    });
  } finally {
    await state.bridge?.close();
    process.off('SIGTERM', onSigterm);
    if (!restoreAll()) result = fail('fatal', 'hidden_restore_failed', { evidence: [{ hidden: state.hidden.map((h) => h.hiddenPath) }] });
  }
  return result;
}, { stage: 'evaluate', entry: import.meta.url });
