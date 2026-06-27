/**
 * Staging E2E Runner（阶段2 Slice1）。
 *
 * harness sub_task 合并后，reportNode 派生一个 task_type='staging_e2e' 的 Brain 任务。
 * 本模块是该任务的 native 执行器（executor.triggerCeceliaRun 直接调用，
 * 独立于 langgraph / interrupt）：
 *   1. 复用 scripts/staging-deploy.sh 把 Brain 部署到 :5222；
 *   2. 加载 initiative_contracts.e2e_acceptance，在真 staging 实例上跑 contract E2E；
 *   3. verdict（PASS/FAIL/SKIP）落 staging_e2e_results 表，并写回 tasks.result。
 *
 * 不碰人工放行 / promote / report（Slice2/3）。
 *
 * verdict 语义：
 *   PASS  — 部署成功且全部 scenario 通过
 *   FAIL  — 部署失败 / scenario 失败 / 合同结构非法
 *   SKIP  — staging 是"加分项"：无 docker / 无 .env.staging / 无合同 时跳过（非失败）
 */

import { execSync } from 'child_process';
import path from 'path';
import pool from './db.js';
import { updateTaskStatus } from './task-updater.js';
import { normalizeAcceptance } from './harness-final-e2e.js';
import { resolveLine, decidePromote, runInternalPromote, defaultPromoteExec, getRepoRoot, PROMOTE_STATUS, spawnHarnessReport, readProductionInfo, REPORT_KIND } from './staging-promote.js';
import { sendFeishu } from './notifier.js';

export const STAGING_PORT = 5222;
// A 方案：内部线交付 dashboard，staging 用 deploy-local.sh 起的 dashboard 预览端口。
export const DASHBOARD_STAGING_PORT = 5223;
const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;
const SCENARIO_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_CAP_BYTES = 4000;

function cap(s) {
  const str = typeof s === 'string' ? s : (s ? String(s) : '');
  return str.length > OUTPUT_CAP_BYTES ? str.slice(-OUTPUT_CAP_BYTES) : str;
}

/**
 * 跑 scripts/staging-deploy.sh，返回机器可读结果。
 * staging-deploy.sh 优雅降级时打印 STAGING_SKIP_REASON=no_docker/no_env，
 * 此处解析为 status='skipped'，不算失败。
 *
 * @returns {{status:'success'|'skipped'|'failed', reason:string|null, output:string}}
 */
export function deployStaging(opts = {}) {
  const exec = opts.exec || execSync;
  // 容器内 cwd=/app，部署脚本在 bind-mount 的 repo 根 scripts/；用绝对路径。
  // REPO_ROOT env（容器=bind-mount repo 根）优先；getRepoRoot() 仅本地直跑兜底（容器内返回 /）。
  const repoRoot = opts.cwd || process.env.REPO_ROOT || getRepoRoot();
  // A 方案：内部线交付 dashboard → 用 deploy-local.sh 构建 dashboard 到 staging（:5223）
  // + 写 .staging-pending（promote 步靠它）；非内部线沿用 staging-deploy.sh（brain :5222）。
  const internal = opts.line === 'internal';
  const stagingPort = internal ? DASHBOARD_STAGING_PORT : STAGING_PORT;
  let script;
  if (opts.deployScript) {
    script = `bash ${opts.deployScript}`;
  } else if (internal) {
    // --changed 显式指定 dashboard：harness 合 main 后在 main 上跑，git diff 为空，必须强制走 dashboard build。
    script = `bash ${path.join(repoRoot, 'scripts/deploy-local.sh')} --changed=apps/dashboard/`;
  } else {
    script = `bash ${path.join(repoRoot, 'scripts/staging-deploy.sh')}`;
  }
  try {
    const raw = exec(script, {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: DEPLOY_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
    const out = typeof raw === 'string' ? raw : (raw ? raw.toString('utf8') : '');
    const skip = out.match(/STAGING_SKIP_REASON=(\S+)/);
    if (skip) return { status: 'skipped', reason: skip[1], output: cap(out), stagingPort };
    return { status: 'success', reason: null, output: cap(out), stagingPort };
  } catch (err) {
    const combined = `${err.stdout ? String(err.stdout) : ''}\n${err.stderr ? String(err.stderr) : ''}\n${err.message || ''}`.trim();
    // 脚本即便非 0 退出也可能已打印 skip 原因（如 setup 失败）→ 仍视为 skip 而非 fail
    const skip = combined.match(/STAGING_SKIP_REASON=(\S+)/);
    if (skip) return { status: 'skipped', reason: skip[1], output: cap(combined), stagingPort };
    return { status: 'failed', reason: 'deploy_failed', output: cap(combined), stagingPort };
  }
}

/**
 * 跑一条 contract scenario 命令，针对 staging :5222。
 *
 * 与 harness-final-e2e.runScenarioCommand 的差异：staging E2E 验证的是 Brain 自身，
 * 命令合法地访问 :5222 的 /api/brain/*，因此不套 planner_drift 拦截；并把命令里的
 * :5221 重写到 :5222，使针对 production 端口写的合同也能打到 staging 实例。
 *
 * @returns {{exitCode:number, output:string}}
 */
export function runStagingCommand(command, opts = {}) {
  const exec = opts.exec || execSync;
  const port = opts.port || STAGING_PORT;
  if (!command || typeof command.cmd !== 'string' || !command.cmd.trim()) {
    return { exitCode: 1, output: '(empty cmd)' };
  }
  // 此脚本在生产 brain 容器内跑，容器内 localhost 不通 staging 容器；重写目标用
  // host.docker.internal（容器内访问 host 的 staging :5222）。env STAGING_HOST 可覆盖（host 直跑传 localhost）。
  const host = opts.host || process.env.STAGING_HOST || 'host.docker.internal';
  // P1#5（2026-06-27 审计）：端口重写按线区分。
  // mac_web 合同实际引用 localhost:5174(dashboard dev) + localhost:5221(brain)。
  // 内部线 dashboard staging（port=5223 静态站，无 /api/brain）：dashboard 断言 5174→:5223，
  //   brain 断言 5221 保持活 brain（内部线无 staging brain，brain-deploy 已上线，仅换 host 可达）。
  // 非内部线 brain staging（port=5222）：5221→:5222（原行为）。
  let cmd;
  if (port === DASHBOARD_STAGING_PORT) {
    cmd = command.cmd
      .replace(/localhost:5174/g, `${host}:${port}`)
      .replace(/127\.0\.0\.1:5174/g, `${host}:${port}`)
      .replace(/localhost:5221/g, `${host}:5221`)
      .replace(/127\.0\.0\.1:5221/g, `${host}:5221`);
  } else {
    cmd = command.cmd
      .replace(/localhost:5221/g, `${host}:${port}`)
      .replace(/127\.0\.0\.1:5221/g, `${host}:${port}`);
  }
  try {
    const raw = exec(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      timeout: SCENARIO_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
    const str = typeof raw === 'string' ? raw : (raw ? raw.toString('utf8') : '');
    return { exitCode: 0, output: cap(str) };
  } catch (err) {
    const combined = `${err.stdout ? String(err.stdout) : ''}\n${err.stderr ? String(err.stderr) : ''}\n${err.message || ''}`.trim();
    return { exitCode: Number.isInteger(err.status) ? err.status : 1, output: cap(combined) };
  }
}

/**
 * 顺序跑 e2e_acceptance 全部 scenario（scenario 内命令 fail-fast）。
 * @returns {{verdict:'PASS'|'FAIL', scenariosTotal:number, scenariosPassed:number, failedScenarios:Array}}
 */
export function runScenarios(acceptance, opts = {}) {
  const { scenarios } = normalizeAcceptance(acceptance);
  const failedScenarios = [];
  let scenariosPassed = 0;
  for (const sc of scenarios) {
    let failure = null;
    for (const command of sc.commands) {
      const r = runStagingCommand(command, opts);
      if (r.exitCode !== 0) {
        failure = { name: sc.name, exitCode: r.exitCode, output: r.output };
        break;
      }
    }
    if (failure) failedScenarios.push(failure);
    else scenariosPassed++;
  }
  return {
    verdict: failedScenarios.length === 0 ? 'PASS' : 'FAIL',
    scenariosTotal: scenarios.length,
    scenariosPassed,
    failedScenarios,
  };
}

/**
 * 从 contract_content（markdown 文本）解析 e2e_acceptance。
 * 兼容两种形态：
 *   1. 内联命令块：## E2E 验收 段下的 ```bash 代码块
 *   2. 脚本文件引用：段内出现 `script: path.sh` / `run: path.ps1` 等行
 * 返回 {scenarios:[{name,covered_tasks,commands}]} 或 null（无法解析）。
 */
export function parseE2eAcceptanceFromContract(content) {
  if (!content || typeof content !== 'string') return null;

  // 找到 ## E2E 验收 标题（允许括号内注释）
  const headingMatch = content.match(/^##\s+E2E\s+验收[^\n]*/m);
  if (!headingMatch) return null;

  // 截取到下一个 ## 级别标题（不含）
  const afterHeading = content.slice(headingMatch.index + headingMatch[0].length);
  const nextH2 = afterHeading.match(/^##\s/m);
  const section = nextH2 ? afterHeading.slice(0, nextH2.index) : afterHeading;

  const scenarios = [];

  // 1. 内联代码块：```bash 或 ```sh 或 ```powershell
  const codeBlockRe = /```(bash|sh|powershell|ps1)?\n([\s\S]*?)```/g;
  let match;
  let blockIdx = 0;
  while ((match = codeBlockRe.exec(section)) !== null) {
    const lang = match[1] || 'bash';
    const scriptContent = match[2];
    if (!scriptContent || !scriptContent.trim()) continue;
    blockIdx++;
    scenarios.push({
      name: blockIdx === 1 ? 'E2E 验收' : `E2E 验收 #${blockIdx}`,
      covered_tasks: ['parsed'],
      commands: [{ type: lang, cmd: scriptContent }],
    });
  }

  // 2. 脚本文件引用（script:/run:/file: 开头的行，或裸 .sh/.ps1 路径）
  if (scenarios.length === 0) {
    const scriptRefRe = /(?:^|\n)\s*(?:script|run|file):\s*(\S+\.(?:sh|ps1))/g;
    let refMatch;
    while ((refMatch = scriptRefRe.exec(section)) !== null) {
      const filePath = refMatch[1];
      const isPs1 = filePath.endsWith('.ps1');
      scenarios.push({
        name: `E2E 验收 (${filePath})`,
        covered_tasks: ['parsed'],
        commands: [{ type: isPs1 ? 'powershell' : 'bash', cmd: isPs1 ? `powershell "${filePath}"` : `bash "${filePath}"` }],
      });
    }
  }

  return scenarios.length > 0 ? { scenarios } : null;
}

/** 加载该 initiative 的合同 e2e_acceptance（优先 approved，否则最新 version）。
 * e2e_acceptance 列为 NULL 时回退解析 contract_content 的 ## E2E 验收 段。 */
async function loadE2eAcceptance(dbPool, initiativeId) {
  const q = await dbPool.query(
    `SELECT e2e_acceptance, contract_content FROM initiative_contracts
     WHERE initiative_id::text = $1
     ORDER BY (CASE WHEN status = 'approved' THEN 0 ELSE 1 END), version DESC
     LIMIT 1`,
    [initiativeId]
  );
  const row = q.rows[0];
  if (!row) return null;
  if (row.e2e_acceptance) return row.e2e_acceptance;

  // 兜底：从 contract_content markdown 解析 ## E2E 验收 段
  if (row.contract_content) {
    const parsed = parseE2eAcceptanceFromContract(row.contract_content);
    if (parsed && parsed.scenarios && parsed.scenarios.length > 0) return parsed;
  }

  return null;
}

/** verdict 落 staging_e2e_results 表。 */
async function recordResult(dbPool, r) {
  // Slice1 修正：pr_url UNIQUE（migration 305）→ ON CONFLICT DO NOTHING 做 DB 级幂等，
  // 防同一 pr_url 重复落 verdict（per-merge 重入时不抛错、不覆盖既有 verdict）。
  await dbPool.query(
    `INSERT INTO staging_e2e_results
       (task_id, initiative_id, pr_url, verdict, reason, staging_port,
        scenarios_total, scenarios_passed, failed_scenarios, deploy_output, deployed_at, tested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     ON CONFLICT (pr_url) DO NOTHING`,
    [
      r.taskId, r.initiativeId, r.prUrl, r.verdict, r.reason, r.port,
      r.scenariosTotal || 0, r.scenariosPassed || 0,
      JSON.stringify(r.failedScenarios || []),
      r.deployOutput || null, r.deployedAt || null, r.testedAt || null,
    ]
  );
}

/** 把 verdict 摘要写回 tasks.result（SSOT 仍是 staging_e2e_results）。 */
async function writeTaskResult(dbPool, taskId, resultObj) {
  await dbPool.query(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
     WHERE id = $1::uuid`,
    [taskId, JSON.stringify({ staging_e2e: resultObj })]
  );
}

/** Slice2：按 pr_url 更新 promote_status（+ output / promoted_at）。 */
async function updatePromoteStatus(dbPool, prUrl, status, output = null) {
  if (!prUrl) return;
  const promotedAt = (status === PROMOTE_STATUS.PROMOTED || status === PROMOTE_STATUS.AUTO_PROMOTED)
    ? new Date() : null;
  await dbPool.query(
    `UPDATE staging_e2e_results
       SET promote_status = $2, promote_output = COALESCE($3, promote_output),
           promoted_at = COALESCE($4, promoted_at)
     WHERE pr_url = $1`,
    [prUrl, status, output ? String(output).slice(0, 4000) : null, promotedAt]
  );
}

/**
 * Slice2：staging E2E PASS 后放行分流（决策 C）。
 * 内部线 → 自动 promote（注入 promoteExec，绝不在测试里打真生产）；
 * 客户线/unknown → pending_promote + 飞书通知（挂 DB 状态行，不碰 interrupt）。
 * best-effort：任何失败只告警，不影响 verdict 已落库。
 * @returns {string} 最终 promote_status
 */
async function handlePromote(dbPool, { verdict, baseRepo, prUrl, initiativeId }, opts = {}) {
  const decision = decidePromote({ verdict, baseRepo });
  const notify = opts.notify || sendFeishu;
  try {
    if (decision.action === 'none') {
      await updatePromoteStatus(dbPool, prUrl, PROMOTE_STATUS.NA);
      return PROMOTE_STATUS.NA;
    }
    if (decision.action === 'auto') {
      // 内部线自动 promote。生产注入 defaultPromoteExec；测试注入 mock。
      // repoRoot 用 REPO_ROOT env（容器=bind-mount repo 根，脚本存在）；裸 getRepoRoot() 容器内返回 / 找不到脚本。
      const promoteExec = opts.promoteExec || defaultPromoteExec(process.env.REPO_ROOT || getRepoRoot());
      const r = await runInternalPromote({ promoteExec });
      // 自动 promote 成功用 auto_promoted（区分客户线 confirm 后的 promoted）；失败 promote_failed。
      const status = r.ok ? PROMOTE_STATUS.AUTO_PROMOTED : PROMOTE_STATUS.PROMOTE_FAILED;
      await updatePromoteStatus(dbPool, prUrl, status, r.output);
      // Slice3：内部线 auto_promoted → 派成功交付证书 report；promote_failed → 失败报告。
      const prod = readProductionInfo(process.env.REPO_ROOT || getRepoRoot());
      await spawnHarnessReport(
        { dbQuery: (sql, p) => dbPool.query(sql, p) },
        {
          initiativeId, prUrl,
          reportKind: r.ok ? REPORT_KIND.SUCCESS : REPORT_KIND.FAILURE,
          stagingE2eVerdict: verdict,
          promoteStatus: status,
          promotedAt: new Date().toISOString(),
          promotedBy: 'auto',
          productionVersion: prod.productionVersion,
          rollbackAnchor: prod.rollbackAnchor,
        },
      );
      return status;
    }
    // pending：客户线 / base_repo 缺失 → 挂起 + 通知主理人
    await updatePromoteStatus(dbPool, prUrl, PROMOTE_STATUS.PENDING_PROMOTE);
    try {
      await notify(
        `⏳ [Pending Promote] staging E2E PASS，等主理人放行上生产\n`
        + `initiative: ${initiativeId || '?'}\nPR: ${prUrl || '?'}\nbase_repo: ${baseRepo || '(缺失,保守挂起)'}\n`
        + `confirm: POST /api/brain/harness/promote/<resultId>`
      );
    } catch (e) {
      console.warn(`[staging-e2e] pending_promote 通知失败（忽略）: ${e.message}`);
    }
    return PROMOTE_STATUS.PENDING_PROMOTE;
  } catch (err) {
    console.warn(`[staging-e2e] handlePromote 失败（best-effort，verdict 已落库）: ${err.message}`);
    return decision.promoteStatus;
  }
}

/**
 * staging_e2e 任务 native 执行器。executor.triggerCeceliaRun 直接调用。
 *
 * 返回约定与其它 executor 分支一致：{ success:true, taskId, ... } 表示"executor 已处理完毕，
 * dispatcher 无需回退 queued"。仅当基础设施异常（DB 写失败等）才标 task failed。
 *
 * @param {{id:string, payload?:object}} task
 * @param {{pool?, deploy?, loadAcceptance?, exec?, cwd?}} [opts]
 */
export async function runStagingE2E(task, opts = {}) {
  const dbPool = opts.pool || pool;
  const deploy = opts.deploy || deployStaging;
  const loadAcceptance = opts.loadAcceptance || loadE2eAcceptance;
  const p = task.payload || {};
  const initiativeId = p.initiative_id || p.initiativeId || null;
  const prUrl = p.pr_url || (Array.isArray(p.pr_urls) ? p.pr_urls[0] : null) || null;
  const baseRepo = p.base_repo || p.baseRepo || '';

  const base = {
    taskId: task.id, initiativeId, prUrl, port: STAGING_PORT,
    scenariosTotal: 0, scenariosPassed: 0, failedScenarios: [],
    deployOutput: null, deployedAt: null, testedAt: null,
  };

  // 终局：落库 + 写回 tasks.result + 标 completed
  const finalize = async (verdict, reason, extra = {}) => {
    await recordResult(dbPool, { ...base, ...extra, verdict, reason });
    // Slice2：PASS 后放行分流（内部线 auto-promote / 客户线 pending+通知 / base_repo 缺失保守 pending）。
    // best-effort，不影响 verdict 已落库。
    const promoteStatus = await handlePromote(
      dbPool, { verdict, baseRepo, prUrl, initiativeId },
      { promoteExec: opts.promoteExec, notify: opts.notify },
    );
    await writeTaskResult(dbPool, task.id, {
      verdict, reason,
      scenarios_total: extra.scenariosTotal ?? base.scenariosTotal,
      scenarios_passed: extra.scenariosPassed ?? base.scenariosPassed,
      pr_url: prUrl, initiative_id: initiativeId,
      promote_status: promoteStatus,
    });
    await updateTaskStatus(task.id, 'completed');
    return { success: true, taskId: task.id, verdict, reason, promoteStatus };
  };

  try {
    if (!initiativeId) return await finalize('SKIP', 'no_initiative_id');

    // 1. 先加载合同（无合同则连 deploy 都不必跑）
    const acceptance = await loadAcceptance(dbPool, initiativeId);
    if (!acceptance) return await finalize('SKIP', 'no_contract');

    // 2. 部署 staging：内部线(cecelia)走 deploy-local.sh 构建 dashboard 到 :5223；
    //    非内部线走 staging-deploy.sh 部署 brain 到 :5222。
    const line = resolveLine(baseRepo);
    const dep = deploy({ exec: opts.exec, cwd: opts.cwd, line });
    base.deployOutput = dep.output;
    if (dep.status === 'skipped') return await finalize('SKIP', dep.reason);
    if (dep.status === 'failed') return await finalize('FAIL', 'deploy_failed');
    base.deployedAt = new Date();
    const stagingPort = dep.stagingPort || STAGING_PORT;
    base.port = stagingPort;

    // 3. 在真 staging 实例跑 contract E2E（命令里的目标端口重写到本次 staging 端口）
    let run;
    try {
      run = runScenarios(acceptance, { exec: opts.exec, cwd: opts.cwd, port: stagingPort });
    } catch (err) {
      base.testedAt = new Date();
      return await finalize('FAIL', `invalid_contract: ${String(err.message).slice(0, 160)}`);
    }
    base.testedAt = new Date();

    return await finalize(run.verdict, run.verdict === 'PASS' ? null : 'scenarios_failed', {
      scenariosTotal: run.scenariosTotal,
      scenariosPassed: run.scenariosPassed,
      failedScenarios: run.failedScenarios,
    });
  } catch (err) {
    // 基础设施异常（DB 写失败等）→ task failed，让 dispatcher/重试机制处理
    console.error(`[staging-e2e] runStagingE2E error task=${task.id}: ${err.message}`);
    try {
      await updateTaskStatus(task.id, 'failed', { error_message: String(err.message).slice(0, 500) });
    } catch { /* best-effort */ }
    return { success: true, taskId: task.id, failed: true, error: String(err.message).slice(0, 500) };
  }
}
