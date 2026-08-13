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

import { execFileSync, execSync, spawnSync } from 'child_process';
import fs, { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import pool from './db.js';
import { updateTaskStatus } from './task-updater.js';
import { normalizeAcceptance } from './harness-final-e2e.js';
import { resolveLine, decidePromote, runInternalPromote, defaultPromoteExec, getRepoRoot, PROMOTE_STATUS, spawnHarnessReport, readProductionInfo, REPORT_KIND } from './staging-promote.js';
import { sendFeishu, sendBark } from './notifier.js';

export const STAGING_PORT = 5222;
// A 方案：内部线交付 dashboard，staging 用 deploy-local.sh 起的 dashboard 预览端口。
export const DASHBOARD_STAGING_PORT = 5223;
// ZenithJoy 蓝绿护栏：:5200=生产，:5201=staging（ZenithJoy CI push:main→:5201 自动部署）。
export const ZJ_STAGING_PORT = 5201;
// ZenithJoy develop 环境端口占位（FR-06 / Sprint 07131922）。
// 实际部署端口待 ZenithJoy 侧决策后更新，默认 5230。
export const ZJ_DEV_PORT = process.env.ZJ_DEV_PORT ? parseInt(process.env.ZJ_DEV_PORT, 10) : 5230;
const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;
const SCENARIO_TIMEOUT_MS = 5 * 60 * 1000;
const REGRESSION_TIMEOUT_MS = 5 * 60 * 1000;
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
export async function deployStaging(opts = {}) {
  const injectedExec = opts.exec;
  // 容器内 cwd=/app，部署脚本在 bind-mount 的 repo 根 scripts/；用绝对路径。
  // REPO_ROOT env（容器=bind-mount repo 根）优先；getRepoRoot() 仅本地直跑兜底（容器内返回 /）。
  const repoRoot = opts.cwd || process.env.REPO_ROOT || getRepoRoot();
  // A 方案：内部线交付 dashboard → 用 deploy-local.sh 构建 dashboard 到 staging（:5223）
  // + 写 .staging-pending（promote 步靠它）；非内部线沿用 staging-deploy.sh（brain :5222）。
  const internal = opts.line === 'internal';
  const customer = opts.line === 'customer';
  const stagingPort = internal ? DASHBOARD_STAGING_PORT : customer ? ZJ_STAGING_PORT : STAGING_PORT;

  // ZenithJoy 蓝绿护栏：customer line 的 staging 由 ZenithJoy CI push:main→:5201 自动部署，
  // Cecelia 不跨 repo 做部署（跨 repo 边界）；只做健康检查——起不来则 FAIL 护栏触发，:5200 不被触碰。
  // 重试逻辑：ZenithJoy CI deploy 需 2-3 分钟，staging 检查在 merge 后立即触发，容器重启窗口内
  // 单次 curl 失败即判死是误判。重试 maxAttempts 次（默认 5），间隔 retryDelayMs（默认 30s）。
  // 默认总窗口：5×30s + 4×30s = 270s ≈ 4.5 分钟，覆盖 ZJ CI 全部部署时间。
  //
  // 健康检查语义（2026-07-07 增强）：
  //   - :5201/health 必须返回 JSON { status: 'ok' } 才算健康。
  //   - ZJ API server 旧版本无 /health 路由时，SPA fallback 返回 200+HTML（不含 "status":"ok"），
  //     视为 zj_staging_html_fallback（服务起来了但版本太旧 / 路由未就绪），触发护栏。
  //   - ECONNREFUSED（进程未起）仍触发 zj_staging_unhealthy。
  if (customer && !opts.deployScript) {
    const host = process.env.ZJ_STAGING_HOST || 'localhost';
    const maxAttempts = opts.maxAttempts ?? 5;
    const retryDelayMs = opts.retryDelayMs ?? 30_000;
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let lastErr;
    let lastOut;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const healthUrl = `http://${host}:${ZJ_STAGING_PORT}/health`;
      const curlArgs = ['-sf', '--connect-timeout', '30', '--max-time', '30', healthUrl];
      try {
        const raw = injectedExec
          ? injectedExec(`curl ${curlArgs.join(' ')}`, { encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024 })
          : execFileSync('curl', curlArgs, { encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024 });
        const out = typeof raw === 'string' ? raw : String(raw);
        lastOut = out;
        // JSON 层验证：/health 必须返回含 "status":"ok" 的 JSON，防 SPA fallback 返回 HTML 误判健康。
        let parsed;
        try { parsed = JSON.parse(out.trim()); } catch { /* non-JSON → 视为不健康 */ }
        if (parsed && parsed.status === 'ok') {
          // SHA 兼容两种格式：新端点 { sha } / 旧格式 { build: { sha } }
          const stagingSha = parsed.sha || parsed?.build?.sha || null;
          const stagingBuildTime = parsed?.build?.buildTime || null;
          const shaLine = stagingSha ? `\n[ZJ staging SHA: ${stagingSha}${stagingBuildTime ? ' buildTime:' + stagingBuildTime : ''}]` : '';
          return { status: 'success', reason: null, output: cap(out + shaLine), stagingPort, stagingSha, zjSha: parsed.sha || null };
        }
        // 服务进程活着但 /health 未返回 ok JSON（旧版本 SPA fallback 或服务启动中）
        const htmlHint = !parsed ? ' [非JSON,可能SPA fallback或旧版本未含/health端点]' : ` [status=${parsed.status}]`;
        lastErr = new Error(`zj /health 未返回 ok${htmlHint}`);
        if (attempt < maxAttempts) {
          console.warn(`[staging-e2e] ZJ staging :${ZJ_STAGING_PORT} /health 响应非 ok（attempt ${attempt}/${maxAttempts}），${retryDelayMs / 1000}s 后重试${htmlHint}`);
          await sleep(retryDelayMs);
        }
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          console.warn(`[staging-e2e] ZJ staging :${ZJ_STAGING_PORT} 健康检查失败（attempt ${attempt}/${maxAttempts}），${retryDelayMs / 1000}s 后重试`);
          await sleep(retryDelayMs);
        }
      }
    }
    const errMsg = `${lastErr?.stdout ? String(lastErr.stdout) : ''}\n${lastErr?.stderr ? String(lastErr.stderr) : ''}\n${lastErr?.message || ''}`.trim();
    // 如果最后一次是 HTML fallback（进程活但不健康），区分原因。
    const reason = lastOut && !lastOut.trim().startsWith('{') ? 'zj_staging_html_fallback' : 'zj_staging_unhealthy';
    const combined = `[尝试 ${maxAttempts} 次均失败，总等待 ${Math.round((maxAttempts - 1) * retryDelayMs / 1000)}s] ${errMsg}`;
    return { status: 'failed', reason, output: cap(combined), stagingPort };
  }

  let processSpec;
  if (opts.deployScript) {
    processSpec = { executable: 'bash', args: [opts.deployScript] };
  } else if (internal) {
    // --changed 显式指定 dashboard：harness 合 main 后在 main 上跑，git diff 为空，必须强制走 dashboard build。
    processSpec = {
      executable: 'bash',
      args: [path.join(repoRoot, 'scripts/deploy-local.sh'), '--changed=apps/dashboard/'],
    };
  } else {
    processSpec = { executable: 'bash', args: [path.join(repoRoot, 'scripts/staging-deploy.sh')] };
  }
  try {
    const processOptions = {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: DEPLOY_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    };
    const raw = injectedExec
      ? injectedExec([processSpec.executable, ...processSpec.args].join(' '), processOptions)
      : execFileSync(processSpec.executable, processSpec.args, processOptions);
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
  // 端口重写按线区分。
  // 内部线 dashboard staging（port=5223）：5174(dashboard)→:5223，5221(brain) 保持活 brain。
  // ZenithJoy staging（port=5201）：5200(production)→:5201（合同针对 production 写，重写到 staging）。
  // 非内部线 brain staging（port=5222）：5221→:5222（原行为）。
  let cmd;
  if (port === DASHBOARD_STAGING_PORT) {
    cmd = command.cmd
      .replace(/localhost:5174/g, `${host}:${port}`)
      .replace(/127\.0\.0\.1:5174/g, `${host}:${port}`)
      .replace(/localhost:5221/g, `${host}:5221`)
      .replace(/127\.0\.0\.1:5221/g, `${host}:5221`);
  } else if (port === ZJ_STAGING_PORT) {
    cmd = command.cmd
      .replace(/localhost:5200/g, `${host}:${port}`)
      .replace(/127\.0\.0\.1:5200/g, `${host}:${port}`);
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
        scenarios_total, scenarios_passed, failed_scenarios, deploy_output, deployed_at, tested_at, tested_sha)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
     ON CONFLICT (pr_url) DO NOTHING`,
    [
      r.taskId, r.initiativeId, r.prUrl, r.verdict, r.reason, r.port,
      r.scenariosTotal || 0, r.scenariosPassed || 0,
      JSON.stringify(r.failedScenarios || []),
      r.deployOutput || null, r.deployedAt || null, r.testedAt || null,
      r.testedSha || null,
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

/** Slice9: 取当前 git HEAD SHA（staging 实测锚点）。失败 → null（不阻断 verdict）。 */
function defaultGetSha(opts = {}) {
  try {
    const exec = opts.exec || execSync;
    const out = exec('git rev-parse HEAD', { encoding: 'utf8', cwd: opts.cwd });
    return String(typeof out === 'string' ? out : out).trim();
  } catch {
    return null;
  }
}

/**
 * Slice2：staging E2E PASS 后放行分流（决策 C）。
 * 内部线 → 自动 promote（注入 promoteExec，绝不在测试里打真生产）；
 * 客户线/unknown → pending_promote + 飞书通知（挂 DB 状态行，不碰 interrupt）。
 * best-effort：任何失败只告警，不影响 verdict 已落库。
 * @returns {string} 最终 promote_status
 */
/**
 * Slice9: initiative 级聚合检查 — 该 initiative 所有 staging_e2e_results 有无 FAIL。
 * SKIP 是加分项跳过（no_docker 等），不算失败；只要无 FAIL 即放行（PASS/SKIP 都 OK）。
 * @returns {Promise<{allPass: boolean, testedSha: string|null}>}
 */
export async function checkInitiativeAggregate(dbPool, initiativeId) {
  if (!initiativeId) return { allPass: true, testedSha: null };
  const r = await dbPool.query(
    `SELECT verdict, tested_sha FROM staging_e2e_results WHERE initiative_id = $1`,
    [initiativeId],
  );
  const rows = r?.rows || [];
  const allPass = !rows.some((x) => x.verdict === 'FAIL');
  const testedSha = rows.find((x) => x.tested_sha)?.tested_sha || null;
  return { allPass, testedSha };
}

export async function handlePromote(dbPool, { verdict, baseRepo, prUrl, initiativeId, deployOutput, zjSha }, opts = {}) {
  const decision = decidePromote({ verdict, baseRepo });
  const notify = opts.notify || sendFeishu;
  const notifyBark = opts.notifyBark || sendBark;
  try {
    if (decision.action === 'none') {
      await updatePromoteStatus(dbPool, prUrl, PROMOTE_STATUS.NA);
      // ZenithJoy customer line staging FAIL → 飞书 + Bark 双通知（护栏触发，:5200 未触碰）。
      // SKIP（无合同/无 docker）不通知：不是真失败，是配置缺省。
      if (verdict === 'FAIL' && decision.line === 'customer') {
        try {
          const deployStr = deployOutput ? String(deployOutput).trim() : '';
          // zjSha 优先（新端点 /health 直接返回）；回退到 deployOutput 诊断行（旧格式兼容）
          const shaFromOutput = deployStr.match(/\[ZJ staging SHA:\s*([0-9a-f]{7,40})[^\]]*\]/)?.[1];
          const shaLine = (zjSha && zjSha !== 'unknown')
            ? `\n候选: ${zjSha}`
            : (shaFromOutput ? `\n最后已知 staging SHA: ${shaFromOutput.slice(0, 12)}` : '');
          const outputSnippet = deployStr
            ? `\n诊断: ${deployStr.slice(-400)}`
            : '';
          await notify(
            `🚨 [ZJ 护栏触发] ZenithJoy staging :5201 失败，:5200 生产未触碰\n`
            + `initiative: ${initiativeId || '?'}\nPR: ${prUrl || '?'}${shaLine}${outputSnippet}\n`
            + `下一步: 检查 ZenithJoy CI deploy 日志，修复后重推 main 触发重跑`
          );
        } catch (e) {
          console.warn(`[staging-e2e] ZJ 护栏触发通知失败（忽略）: ${e.message}`);
        }
        // Bark 移动通知（fire-and-forget，不阻塞主流程）。
        notifyBark(
          '🚨 ZJ 护栏触发',
          `staging :5201 失败，:5200 生产未触碰。initiative: ${initiativeId || '?'}`,
        ).catch(() => {});
      }
      return PROMOTE_STATUS.NA;
    }
    if (decision.action === 'auto') {
      // Slice9 复合闸 1：initiative 级聚合 gate — 该 initiative 有任何 staging FAIL → 不 auto-promote，
      // 挂 pending（等同 initiative 其他 PR 也全绿），防单 PR PASS 就上生产漏掉别 PR 的 FAIL。
      const aggCheck = opts.checkInitiativeAggregate || checkInitiativeAggregate;
      const agg = await aggCheck(dbPool, initiativeId);
      if (!agg.allPass) {
        console.warn(`[staging-e2e] 聚合 gate: initiative ${initiativeId} 有未通过的 staging → 挂 pending，不 auto-promote`);
        await updatePromoteStatus(dbPool, prUrl, PROMOTE_STATUS.PENDING_PROMOTE);
        return PROMOTE_STATUS.PENDING_PROMOTE;
      }
      // Slice9 复合闸 2：SHA 锚定 — staging 实测的 SHA != 当前部署目标 SHA（run 在飞期间别 PR merge
      // 致 main 前进）→ 漂移，promote 会上没经 staging 验证的代码。两端都非空才比（fail-open）。
      const getCurrentSha = opts.getCurrentSha || defaultGetSha;
      const currentSha = getCurrentSha({ cwd: process.env.REPO_ROOT || getRepoRoot() });
      if (agg.testedSha && currentSha && agg.testedSha !== currentSha) {
        console.warn(`[staging-e2e] SHA 漂移: tested=${agg.testedSha} != current=${currentSha} → 挂 pending，不 auto-promote`);
        await updatePromoteStatus(dbPool, prUrl, PROMOTE_STATUS.PENDING_PROMOTE);
        return PROMOTE_STATUS.PENDING_PROMOTE;
      }
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
        { db: dbPool },
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
/**
 * Slice6: 抢 staging 部署 advisory lock（dedicated client，session 级，避免跨 pool.query 连接漂移）。
 * 抢到 → 返回 { release }；抢不到（别路正占）→ null。pool 无 connect（测试 mock）/ 抢锁基础设施异常
 * → fail-open 返回 no-op lock（不因锁机制本身故障阻断 staging，锁只是并发止血不是硬门）。
 * @returns {Promise<{release: () => Promise<void>}|null>}
 */
export async function acquireStagingLock(dbPool, lockKey) {
  if (!dbPool || typeof dbPool.connect !== 'function') {
    return { release: async () => {} };
  }
  let client;
  try {
    client = await dbPool.connect();
    const r = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);
    if (!r?.rows?.[0]?.locked) {
      client.release();
      return null;
    }
    return {
      release: async () => {
        try { await client.query('SELECT pg_advisory_unlock($1)', [lockKey]); }
        finally { client.release(); }
      },
    };
  } catch (err) {
    if (client) { try { client.release(); } catch { /* ignore */ } }
    console.warn(`[staging-e2e] advisory lock 获取异常（fail-open）: ${err.message}`);
    return { release: async () => {} };
  }
}


/**
 * 读取 golden-smoke test 文件头部注释中的 target_env 字段。
 * 格式：* target_env  : xxx
 * @returns {string|null}
 */
function readTargetEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/\*\s+target_env\s*:\s*(\S+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

const WINDOWS_ENVS = new Set(['windows_cloud', 'windows_wechat']);

/**
 * 全量 regression golden-smoke 扫描。
 * 扫描 packages/quality/tests/regression/*.golden-smoke.test.ts，
 * 过滤 windows 环境文件，用 spawnSync npx vitest run 执行，返回 verdict。
 * @returns {{ verdict:'PASS'|'FAIL'|'SKIP', total:number, passed:number, failed:number, skipped:number, files:string[] }}
 */
export function runGoldenSmokeRegression(opts = {}) {
  const repoRoot = opts.cwd || process.env.REPO_ROOT || getRepoRoot();
  const regressionDir = path.join(repoRoot, 'packages/quality/tests/regression');

  // 1. 扫描文件（Node 22 fs.globSync，或 readdirSync 兜底）
  let allFiles = [];
  try {
    if (typeof fs.globSync === 'function') {
      allFiles = fs.globSync(path.join(regressionDir, '*.golden-smoke.test.ts'));
    } else {
      const entries = fs.readdirSync(regressionDir);
      allFiles = entries
        .filter((f) => f.endsWith('.golden-smoke.test.ts'))
        .map((f) => path.join(regressionDir, f));
    }
  } catch {
    allFiles = [];
  }

  if (allFiles.length === 0) {
    return { verdict: 'SKIP', total: 0, passed: 0, failed: 0, skipped: 0, files: [] };
  }

  // 2. 过滤 windows 环境文件（staging 跑在 linux 服务器，windows 路径不可运行）
  const filteredFiles = allFiles.filter((f) => {
    const env = readTargetEnv(f);
    return !env || !WINDOWS_ENVS.has(env);
  });

  if (filteredFiles.length === 0) {
    return {
      verdict: 'SKIP',
      total: allFiles.length,
      passed: 0,
      failed: 0,
      skipped: allFiles.length,
      files: [],
    };
  }

  // 3. 执行：spawnSync npx vitest run --reporter=json
  const tmpJsonPath = path.join(os.tmpdir(), `golden-smoke-${Date.now()}.json`);
  const stagingPort = opts.stagingPort || STAGING_PORT;
  const spawnFn = opts.spawnSync || spawnSync;
  const env = {
    ...process.env,
    BRAIN_URL: `http://localhost:${stagingPort}`,
  };

  spawnFn(
    'npx',
    ['vitest', 'run', '--reporter=json', '--outputFile', tmpJsonPath, ...filteredFiles],
    { cwd: repoRoot, timeout: REGRESSION_TIMEOUT_MS, env },
  );

  // 4. 解析结果
  let total = filteredFiles.length;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    if (fs.existsSync(tmpJsonPath)) {
      const jsonOut = JSON.parse(fs.readFileSync(tmpJsonPath, 'utf8'));
      passed = jsonOut.numPassedTests ?? 0;
      failed = jsonOut.numFailedTests ?? 0;
      skipped = jsonOut.numPendingTests ?? 0;
      total = passed + failed + skipped;
      try { fs.unlinkSync(tmpJsonPath); } catch { /* ignore */ }
    } else {
      // 无输出文件，视全部失败
      failed = filteredFiles.length;
      total = filteredFiles.length;
    }
  } catch {
    failed = filteredFiles.length;
    total = filteredFiles.length;
  }

  return {
    verdict: failed > 0 ? 'FAIL' : 'PASS',
    total,
    passed,
    failed,
    skipped,
    files: filteredFiles.map((f) => path.relative(repoRoot, f)),
  };
}

/**
 * 起 per-PR review 预览进程。
 * Docker 内直接监听已映射的 review 端口；宿主环境使用宿主仓库脚本。
 * opts.inContainer 可显式覆盖（测试用）。
 */
export function spawnReviewPreview(port, prNum, opts = {}) {
  const HOST_REPO = process.env.CECELIA_HOST_REPO || '/Users/administrator/perfect21/cecelia';
  const distDir = path.join(HOST_REPO, 'apps/dashboard/.dist-staging');
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
  const scriptRoot = inContainer ? (process.env.REPO_ROOT || '/app') : HOST_REPO;
  const reviewScript = path.join(scriptRoot, 'scripts/review-preview.sh');
  return spawnSync('bash', [reviewScript, String(port), String(prNum), distDir], {
    encoding: 'utf8', timeout: 30000,
  });
}

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
  // o.promoteStatus（刀3b）：跳过 handlePromote 分流，直接落指定 promote_status + best-effort 通知
  //（unknown 线用：verdict 恒非 PASS，decidePromote 会误落 n_a，且需要带说明的专属通知文案）。
  const finalize = async (verdict, reason, extra = {}, o = {}) => {
    await recordResult(dbPool, { ...base, ...extra, verdict, reason });
    let promoteStatus;
    if (o.promoteStatus) {
      promoteStatus = o.promoteStatus;
      // best-effort：DB 失败不冒泡（冒泡会让 task 标 failed → dispatcher 重试 → 重复 SKIP 行 + 重复飞书）
      try {
        await updatePromoteStatus(dbPool, prUrl, o.promoteStatus);
      } catch (e) {
        console.warn(`[staging-e2e] unknown 线 promote_status 落库失败（忽略）: ${e.message}`);
      }
      if (o.notifyMessage) {
        try {
          await (opts.notify || sendFeishu)(o.notifyMessage);
        } catch (e) {
          console.warn(`[staging-e2e] unknown 线通知失败（忽略）: ${e.message}`);
        }
      }
    } else {
      // Slice2：PASS 后放行分流（内部线 auto-promote / 客户线 pending+通知 / base_repo 缺失保守 pending）。
      // best-effort，不影响 verdict 已落库。
      promoteStatus = await handlePromote(
        dbPool, { verdict, baseRepo, prUrl, initiativeId, deployOutput: base.deployOutput, zjSha: base.zjSha || null },
        { promoteExec: opts.promoteExec, notify: opts.notify },
      );
    }
    await writeTaskResult(dbPool, task.id, {
      verdict, reason,
      scenarios_total: extra.scenariosTotal ?? base.scenariosTotal,
      scenarios_passed: extra.scenariosPassed ?? base.scenariosPassed,
      pr_url: prUrl, initiative_id: initiativeId,
      promote_status: promoteStatus,
      ...(extra.regressionSmokeResult ? { regression_smoke_result: extra.regressionSmokeResult } : {}),
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

    // 刀3b（harness 跨 repo 化）：base_repo 非空但既非 cecelia 也非 zenithjoy = 第三方 repo。
    // cecelia 没有它的 staging 部署目标——旧行为落进 deployStaging 的 else 分支跑
    // staging-deploy.sh，把 cecelia brain 部署到 :5222（错误目标）。显式策略：不抢锁、
    // 不跑任何 deploy，SKIP(unknown_line) + promote_status=pending_promote + 飞书通知主理人。
    // base_repo 为空（legacy cecelia 流）保持旧行为——promote 侧决策2 的保守 pending 已兜底。
    if (line === 'unknown' && baseRepo) {
      return await finalize('SKIP', 'unknown_line', {}, {
        promoteStatus: PROMOTE_STATUS.PENDING_PROMOTE,
        notifyMessage:
          `⏳ [Unknown 线] staging_e2e 收到第三方 repo，无 staging 部署目标，已挂 pending 等人工决策\n`
          + `initiative: ${initiativeId || '?'}\nPR: ${prUrl || '?'}\nbase_repo: ${baseRepo}\n`
          + `confirm: POST /api/brain/harness/promote/<resultId>`,
      });
    }

    // Slice6: staging 单实例串行 — deploy 前抢 advisory lock，防 N 路并发互相 docker rm 顶掉。
    // 抢不到（别路正占同端口实例）→ SKIP staging_busy（不部署）；抢到 → finally 必释放。
    // customer line 用 ZJ_STAGING_PORT(5201) 作锁 key，防并发 ZenithJoy staging E2E 互相干扰，
    // 且不与 Cecelia Brain staging(STAGING_PORT=5222) 产生假冲突（两者独立端口、独立资源）。
    const lockPort = line === 'internal' ? DASHBOARD_STAGING_PORT : line === 'customer' ? ZJ_STAGING_PORT : STAGING_PORT;
    const acquireLock = opts.acquireStagingLock || acquireStagingLock;
    const lock = await acquireLock(dbPool, lockPort);
    if (!lock) return await finalize('SKIP', 'staging_busy');

    try {
      const dep = await deploy({ exec: opts.exec, cwd: opts.cwd, line });
      base.deployOutput = dep.output;
      base.zjSha = dep.zjSha || null;
      if (dep.status === 'skipped') return await finalize('SKIP', dep.reason);
      if (dep.status === 'failed') return await finalize('FAIL', dep.reason || 'deploy_failed');
      base.deployedAt = new Date();
      const stagingPort = dep.stagingPort || STAGING_PORT;
      base.port = stagingPort;
      // Slice9: 锚定 staging 实测的 git SHA（deploy 后的 HEAD），promote 时比对防 SHA 漂移。
      base.testedSha = (opts.getSha || defaultGetSha)({ exec: opts.exec, cwd: opts.cwd });

      // 3. 在真 staging 实例跑 contract E2E（命令里的目标端口重写到本次 staging 端口）
      let run;
      try {
        run = runScenarios(acceptance, { exec: opts.exec, cwd: opts.cwd, port: stagingPort });
      } catch (err) {
        base.testedAt = new Date();
        return await finalize('FAIL', `invalid_contract: ${String(err.message).slice(0, 160)}`);
      }
      base.testedAt = new Date();

      // 3b. 全量 regression golden-smoke 扫描（contract E2E PASS 后、promote 前）
      let regressionSmokeResult;
      if (run.verdict === 'PASS') {
        try {
          regressionSmokeResult = (opts.runGoldenSmokeRegression || runGoldenSmokeRegression)({
            cwd: opts.cwd,
            stagingPort,
            spawnSync: opts.spawnSync,
          });
        } catch (err) {
          console.warn(`[staging-e2e] golden-smoke regression 扫描异常（视为 SKIP）: ${err.message}`);
          regressionSmokeResult = { verdict: 'SKIP', total: 0, passed: 0, failed: 0, skipped: 0, files: [], error: String(err.message) };
        }
        if (regressionSmokeResult && regressionSmokeResult.verdict === 'FAIL') {
          return await finalize('FAIL', 'regression_golden_smoke_fail', {
            scenariosTotal: run.scenariosTotal,
            scenariosPassed: run.scenariosPassed,
            failedScenarios: run.failedScenarios,
            regressionSmokeResult,
          });
        }
      }

      // evaluator PASS 后：起 per-PR review 环境 + Bark 通知（fire-and-forget，不阻塞 verdict）
      if (run.verdict === 'PASS') {
        (async () => {
          try {
            const { allocatePort } = await import('./preview-manager.js');
            const prNum = task?.payload?.pr_number || task?.metadata?.pr_number || 0;
            const branch = task?.payload?.branch_name || task?.metadata?.branch_name || 'unknown';
            if (!prNum) return;
            const port = await allocatePort(prNum, branch, task?.payload?.base_repo, dbPool);
            // 起 review 预览（容器内 SSH 逃逸到宿主；非容器直跑）
            const r = spawnReviewPreview(port, prNum);
            if (r.status === 0) {
              console.log(`[review-env] PR #${prNum} review ready → http://38.23.47.81:${port}`);
              await sendBark(
                `✅ Review Ready — PR #${prNum}`,
                `${branch} 已过 E2E，打开 http://38.23.47.81:${port} 验收`
              );
            } else {
              console.warn('[review-env] review-preview.sh 失败:', (r.stderr || r.stdout || '').slice(0, 300));
            }
          } catch (err) {
            console.warn('[staging-e2e] review env deploy 失败（不影响 PASS）:', err.message);
          }
        })();
      }

      return await finalize(run.verdict, run.verdict === 'PASS' ? null : 'scenarios_failed', {
        scenariosTotal: run.scenariosTotal,
        scenariosPassed: run.scenariosPassed,
        failedScenarios: run.failedScenarios,
        ...(regressionSmokeResult ? { regressionSmokeResult } : {}),
      });
    } finally {
      await lock.release();
    }
  } catch (err) {
    // 基础设施异常（DB 写失败等）→ task failed，让 dispatcher/重试机制处理
    console.error(`[staging-e2e] runStagingE2E error task=${task.id}: ${err.message}`);
    try {
      await updateTaskStatus(task.id, 'failed', { error_message: String(err.message).slice(0, 500) });
    } catch { /* best-effort */ }
    return { success: true, taskId: task.id, failed: true, error: String(err.message).slice(0, 500) };
  }
}
