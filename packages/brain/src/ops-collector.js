/**
 * ops-collector.js — 运行舱采集器（指挥舱 G1 S1 刀1，task 6fcb5356）
 * 拉取模型：scheduler job 复用 host-exec ssh 逃逸，无宿主 daemon/写端点。
 * 契约（PrepPRD D1-D3）：0条=可疑须 source_status 佐证；失败 reason_code+last_error 双写；
 * 宁 stale 不假数据；next_run 绝对 UTC 或 NULL；OpenClaw 只读 docker exec 写死路径；
 * launchd 只认已加载；meta 白名单禁凭据。
 */
import { existsSync } from 'fs';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';
import { summarizeLiveness } from './ops-liveness.js';
import { statusFromCollectorState } from './ops-alarm-ledger.js';

import { OWN_LABEL_RE, parseLaunchctlList, parsePlistDump, computeNextRunUTC, extractOpenclawAgents, extractOpenclawSkills, inferAgentOrg, inferAgentRoleType, parseGhaCron, OPENCLAW_CONFIG_CMD, OPENCLAW_CRON_CMD, parseOpenclawCrons, PLIST_DUMP_CMD, parseCrontab, CRONTAB_CMD_MMV, CRONTAB_CMD_USVPS, CRONTAB_HOST_EXPECT, parseCrontabWithHost, GHA_CRON_CMD } from './ops-collector-hosts.js';
export { OWN_LABEL_RE, parseLaunchctlList, parsePlistDump, computeNextRunUTC, extractOpenclawAgents, extractOpenclawSkills, inferAgentOrg, inferAgentRoleType, parseGhaCron, OPENCLAW_CONFIG_CMD, OPENCLAW_CRON_CMD, parseOpenclawCrons, PLIST_DUMP_CMD, parseCrontab, CRONTAB_CMD_MMV, CRONTAB_CMD_USVPS, CRONTAB_HOST_EXPECT, parseCrontabWithHost, GHA_CRON_CMD };
import { parseN8nRuns, isBusinessWorkflow, summarizeRuns, N8N_RUNS_CMD, DISCO_STAGES, DISCO_MIN_RUNS, DISCO_CONVERGED_RATE, parseEvalScore, inferDiscoStage, rollupAgentMaturity, rollupWorkflowMaturity, parseN8nExecutionStages, aggregateStageStats, STAGE_TO_SKILL, N8N_STAGE_DATA_CMD, buildEvalRecord, detectPostcondition, countStages, parseN8nWorkflows, resolveWorkflowAgents, buildStageFlow, buildWorkflowMermaid, buildWorkflowPageBlocks, N8N_LIST_CMD } from './ops-collector-n8n.js';
export { parseN8nRuns, isBusinessWorkflow, summarizeRuns, N8N_RUNS_CMD, DISCO_STAGES, DISCO_MIN_RUNS, DISCO_CONVERGED_RATE, parseEvalScore, inferDiscoStage, rollupAgentMaturity, rollupWorkflowMaturity, parseN8nExecutionStages, aggregateStageStats, STAGE_TO_SKILL, N8N_STAGE_DATA_CMD, buildEvalRecord, detectPostcondition, countStages, parseN8nWorkflows, resolveWorkflowAgents, buildStageFlow, buildWorkflowMermaid, buildWorkflowPageBlocks, N8N_LIST_CMD };

export const INTERVAL_MS = parseInt(process.env.OPS_COLLECTOR_INTERVAL_MS || String(5 * 60 * 1000), 10);

/**
 * 版本历史（刀7）：只在 eval 分数或 DisCo 档位**真的变了**时追加一代。
 * 采集器每 5 分钟跑一次，若无条件追加会灌成流水账——历史要的是"演进节点"不是心跳。
 */
async function recordSkillVersionIfChanged(pool, skillRow, name, ev, st) {
  const { rows: [last] } = await pool.query(
    `SELECT generation, eval_score, disco_stage FROM ops_skill_versions
     WHERE skill_id=$1 ORDER BY generation DESC LIMIT 1`, [skillRow.id]);
  const changed = !last
    || last.eval_score !== ev.score
    || last.disco_stage !== st.stage;
  if (!changed) return;
  const gen = (last?.generation ?? 0) + 1;
  const note = !last ? '首次记录'
    : [last.eval_score !== ev.score ? `分数 ${last.eval_score ?? '-'}→${ev.score ?? '-'}` : null,
       last.disco_stage !== st.stage ? `档位 ${last.disco_stage ?? '-'}→${st.stage}` : null]
      .filter(Boolean).join('；');
  await pool.query(
    `INSERT INTO ops_skill_versions (skill_id, skill_name, generation, eval_score, eval_baseline,
                                     eval_raw, disco_stage, stage_reason, change_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (skill_id, generation) DO NOTHING`,
    [skillRow.id, name, gen, ev.score, ev.baseline, ev.raw || null, st.stage, st.reason, note]);
  await pool.query(`UPDATE ops_skills SET generation=$1 WHERE id=$2`, [gen, skillRow.id]);
}


let lastRunAt = 0;
let running = false;
export function __resetOpsCollectorForTest() { lastRunAt = 0; }

export async function writeHeartbeat(pool, source, host, status, reasonCode, lastError, collectedAt) {
  await pool.query(
    `INSERT INTO ops_source_heartbeats (source, host_alias, last_report_at, last_collected_at, source_status, reason_code, last_error, updated_at)
     VALUES ($1,$2,NOW(),$3,$4,$5,$6,NOW())
     ON CONFLICT (source, host_alias) DO UPDATE SET
       last_report_at=NOW(), source_status=$4, reason_code=$5, last_error=$6, updated_at=NOW(),
       last_collected_at=COALESCE($3, ops_source_heartbeats.last_collected_at)`,
    [source, host, collectedAt || null, status, reasonCode, lastError ? String(lastError).slice(0, 500) : null]
  );
}

async function writeAgentsSnapshot(pool, source, host, agents, collectedAt) {
  for (const a of agents) {
    await pool.query(
      `INSERT INTO ops_agents (source, host_alias, name, agent_type, status, last_seen_at, meta, updated_at)
       VALUES ($1,$2,$3,$4,'active',$5,$6,NOW())
       ON CONFLICT (source, host_alias, name) DO UPDATE SET
         agent_type=EXCLUDED.agent_type, status='active', last_seen_at=EXCLUDED.last_seen_at,
         meta=EXCLUDED.meta, updated_at=NOW()`,
      [source, host, a.name, a.agent_type || null, collectedAt, JSON.stringify(a.meta || {})]
    );
  }
  // 快照缺席 → offline（不删行，保 notion_id 与历史）
  await pool.query(
    `UPDATE ops_agents SET status='offline', updated_at=NOW()
     WHERE source=$1 AND host_alias=$2 AND status='active' AND last_seen_at < $3`,
    [source, host, collectedAt]
  );
}

async function writeSchedulesSnapshot(pool, source, host, entries, collectedAt) {
  for (const s of entries) {
    await pool.query(
      // updated_at 显式写 collectedAt（应用时钟），与下方 deactivation 阈值同源——
      // 若用 NOW()（DB 时钟）而 DB 时钟落后于应用时钟，本轮刚写的行会 updated_at < collectedAt 被误标 active=FALSE 闪断。
      // 闹钟总账（517，任务 fe10d1a0）：机器列随快照一起写；SET 里只有机器列——
      // owner_manual/note_manual/tree_bucket_manual 与挂树列（journey_id/workflow_id/ledger_status/registered_via）
      // 是人或导入脚本的结论，机器每 5 分钟覆盖会冲掉。前 9 个参数位置不动（测试按下标断言），新列只追加在后。
      `INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, next_run_utc, last_state, last_exit_code, active, updated_at,
          interval_sec, enabled, last_run_at, last_success_at, last_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (source, host_alias, label) DO UPDATE SET
         kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc, next_run_utc=EXCLUDED.next_run_utc,
         last_state=EXCLUDED.last_state, last_exit_code=EXCLUDED.last_exit_code, active=TRUE, updated_at=$9,
         interval_sec=EXCLUDED.interval_sec, enabled=EXCLUDED.enabled,
         last_run_at=COALESCE(EXCLUDED.last_run_at, ops_schedule_entries.last_run_at),
         last_success_at=COALESCE(EXCLUDED.last_success_at, ops_schedule_entries.last_success_at),
         last_status=EXCLUDED.last_status`,
      [source, host, s.label, s.kind, s.schedule_desc || '', s.next_run_utc || null, s.last_state || null, s.last_exit_code ?? null, collectedAt,
        s.interval_sec ?? null, s.last_state !== 'disabled', s.last_run_at ?? null, s.last_success_at ?? null,
        statusFromCollectorState(s.last_state, s.last_exit_code)]
    );
  }
  if (entries.length) {
    await pool.query(
      `UPDATE ops_schedule_entries SET active=FALSE, updated_at=$3
       WHERE source=$1 AND host_alias=$2 AND active=TRUE AND updated_at < $3`,
      [source, host, collectedAt]
    );
  }
}

export function classifyError(e) {
  const msg = String(e?.message || '');
  if (/timed? ?out|connect|unreachable|Connection refused|ETIMEDOUT/i.test(msg)) return ['unreachable', 'ssh_or_exec_failed'];
  if (/schema_drift/.test(msg)) return ['schema_drift', 'schema_drift'];
  if (/No such file|not found|config_missing/i.test(msg)) return ['config_missing', 'config_missing'];
  return ['parse_error', 'parse_error'];
}

/** scheduler-jobs handler（needsPool:true）。opts 仅供测试注入。 */
export async function runOpsCollector(pool, opts = {}) {
  const now = opts.now ?? Date.now();
  if (running || now - lastRunAt < INTERVAL_MS) return { skipped: true };
  running = true;
  try {
    lastRunAt = now;
    const exec = opts.exec || defaultExecAsync;
    const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
    const run = (cmd) => exec(buildHostCmd(cmd, inContainer, opts.keyExistsFn));
    const collectedAt = new Date(now).toISOString();
    const results = {};

    // —— 腿1: launchd@local ——（只认已加载；0行=可疑判失败）
    try {
      const list = parseLaunchctlList(await run('launchctl list'));
      if (list.length === 0) throw new Error('parse_error: launchctl list 解析出 0 行自家任务（0=可疑，禁当真空）');
      let hostTz = 'America/Los_Angeles';
      try { hostTz = String(await run('readlink /etc/localtime')).split('zoneinfo/')[1]?.trim() || hostTz; } catch { /* 展示级信息，失败用默认 */ }
      const { plists } = parsePlistDump(await run(PLIST_DUMP_CMD));
      const agents = list.map((l) => ({
        name: l.label, agent_type: 'launchd_job',
        meta: { pid: l.pid, last_exit_code: l.lastExitCode },
      }));
      const schedules = [];
      for (const l of list) {
        const p = plists.get(l.label);
        if (!p) continue;
        const lastState = l.pid ? 'running' : (l.lastExitCode === 0 ? 'ok' : `exit ${l.lastExitCode}`);
        if (p.StartCalendarInterval) {
          schedules.push({
            label: l.label, kind: 'launchd_calendar',
            schedule_desc: `calendar(${hostTz}): ${JSON.stringify(p.StartCalendarInterval)}`,
            next_run_utc: computeNextRunUTC(p.StartCalendarInterval, new Date(now), hostTz),
            last_state: lastState, last_exit_code: l.lastExitCode,
          });
        } else if (p.StartInterval) {
          schedules.push({
            label: l.label, kind: 'launchd_interval',
            schedule_desc: `约每 ${p.StartInterval} 秒`, // 锚点=加载时刻，禁假精确
            next_run_utc: null, last_state: lastState, last_exit_code: l.lastExitCode,
            interval_sec: Number(p.StartInterval) > 0 ? Number(p.StartInterval) : null,
          });
        }
      }
      await writeAgentsSnapshot(pool, 'launchd', 'local', agents, collectedAt);
      await writeSchedulesSnapshot(pool, 'launchd', 'local', schedules, collectedAt);
      await writeHeartbeat(pool, 'launchd', 'local', 'ok', null, null, collectedAt);
      results.launchd = { ok: true, agents: agents.length, schedules: schedules.length };
    } catch (e) {
      const [status, code] = classifyError(e);
      await writeHeartbeat(pool, 'launchd', 'local', status, code, e.message);
      results.launchd = { ok: false };
    }

    // —— 腿2: openclaw@mmv ——（解析失败整份丢弃，沿用上轮+stale）
    // 0921 起落点是 MMV，经 host 逃逸 + ssh 别名 mmv 取数（见 OPENCLAW_CONFIG_CMD 注释）。
    try {
      const raw = await run(OPENCLAW_CONFIG_CMD);
      let cfg;
      try { cfg = JSON.parse(raw); } catch { throw new Error(`parse_error: clawdbot.json 非法 JSON（前100字符: ${String(raw).slice(0, 100)}）`); }
      const agents = extractOpenclawAgents(cfg);
      await writeAgentsSnapshot(pool, 'openclaw', 'mmv', agents, collectedAt);

      // cron 台账（0921 新增）：41 条 OpenClaw cron 此前从不进台账、Notion 零留痕。
      // 与 agents 同一条腿但独立 try —— cron 取数失败不该把 agents/skills 一起拖废。
      try {
        const crons = parseOpenclawCrons(await run(OPENCLAW_CRON_CMD));
        await writeSchedulesSnapshot(pool, 'openclaw', 'mmv', crons, collectedAt);
        results.openclaw_crons = { ok: true, schedules: crons.length };
      } catch (ce) {
        results.openclaw_crons = { ok: false, error: String(ce.message).slice(0, 160) };
      }
      // skill 投影（最小执行单元，与 agent 多对多）
      // 双写消除（刀7）：真相源是 ops_agents.meta.skills（直接来自 clawdbot.json 的 agent 定义）；
      // ops_skills.used_by 是它的**派生反向索引**，每轮由 extractOpenclawSkills 从同一份 cfg 现算，
      // 不接受任何其他写入方——避免两处各写一份而分叉。
      const skills = extractOpenclawSkills(cfg);
      // eval 分数来自 skill_registry.metadata.eval_score（180 个 skill 中 14 个有真分数；
      // skill_evals 表 19 条全是 e2e 测试垃圾，不可用）
      const evalRows = (await pool.query(
        `SELECT name, metadata->>'eval_score' AS es FROM skill_registry WHERE metadata->>'eval_score' IS NOT NULL`)).rows;
      const evalByName = new Map(evalRows.map((r) => [String(r.name).replace(/^\//, ''), r.es]));
      for (const sk of skills) {
        const ev = parseEvalScore(evalByName.get(sk.name));
        // 用上刀8-A 归因出的真实运行数据（上一轮写入），使档位可自动判定
        const { rows: [prev] } = await pool.query(
          `SELECT runs, run_success_rate, doc_excerpt FROM ops_skills WHERE source='openclaw' AND name=$1`,
          [sk.name]);
        // 探针从 SKILL.md 正文现判（doc_excerpt 由 SKILL.md 采集写入）
        const hasProbe = prev?.doc_excerpt ? detectPostcondition(prev.doc_excerpt) : null;
        const st = inferDiscoStage({
          name: sk.name,
          runs: prev?.runs ?? null,
          successRate: prev?.run_success_rate ?? null,
          hasPostcondition: hasProbe,
        });
        const { rows: [row] } = await pool.query(
          `INSERT INTO ops_skills (source, name, used_by, eval_score, eval_baseline, eval_raw,
                                   disco_stage, stage_reason, stage_confident, has_postcondition, updated_at)
           VALUES ('openclaw',$1,$2,$3,$4,$5,$6,$7,$8,$10,$9)
           ON CONFLICT (source, name) DO UPDATE SET
             used_by=EXCLUDED.used_by, eval_score=EXCLUDED.eval_score,
             eval_baseline=EXCLUDED.eval_baseline, eval_raw=EXCLUDED.eval_raw,
             disco_stage=EXCLUDED.disco_stage, stage_reason=EXCLUDED.stage_reason,
             stage_confident=EXCLUDED.stage_confident,
             has_postcondition=EXCLUDED.has_postcondition, updated_at=EXCLUDED.updated_at
           RETURNING id, generation`,
          [sk.name, JSON.stringify(sk.used_by), ev.score, ev.baseline, ev.raw || null,
           st.stage, st.reason, st.confident, collectedAt, hasProbe]);
        // 版本历史：只在**分数或档位真变了**时追加一代，避免每 5 分钟灌一行流水
        if (row) await recordSkillVersionIfChanged(pool, row, sk.name, ev, st);
      }
      await writeHeartbeat(pool, 'openclaw', 'mmv', 'ok', null, null, collectedAt);
      results.openclaw = { ok: true, agents: agents.length, skills: skills.length };
    } catch (e) {
      const [status, code] = classifyError(e);
      await writeHeartbeat(pool, 'openclaw', 'mmv', status, code, e.message);
      results.openclaw = { ok: false };
    }

    // —— 腿3: gha@github（静态解析宿主 checkout，失败不阻塞）——
    try {
      const entries = parseGhaCron(await run(GHA_CRON_CMD));
      await writeSchedulesSnapshot(pool, 'gha', 'github', entries, collectedAt);
      await writeHeartbeat(pool, 'gha', 'github', 'ok', null, null, collectedAt);
      results.gha = { ok: true, schedules: entries.length };
    } catch (e) {
      const [status, code] = classifyError(e);
      await writeHeartbeat(pool, 'gha', 'github', status, code, e.message);
      results.gha = { ok: false };
    }

    // —— 腿4a: crontab@mmv ——（buildHostCmd 的逃逸目标就是 MMV，见 CRONTAB_CMD_MMV 注释）
    try {
      const entries = parseCrontabWithHost(await run(CRONTAB_CMD_MMV), CRONTAB_HOST_EXPECT.mmv);
      await writeSchedulesSnapshot(pool, 'crontab', 'mmv', entries, collectedAt);
      await writeHeartbeat(pool, 'crontab', 'mmv', 'ok', null, null, collectedAt);
      results.crontab_mmv = { ok: true, schedules: entries.length };
    } catch (e) {
      const [status, code] = classifyError(e);
      await writeHeartbeat(pool, 'crontab', 'mmv', status, code, e.message);
      results.crontab_mmv = { ok: false };
    }

    // —— 腿4b: crontab@us-vps ——（显式 ssh 回本机宿主；host-exec 的默认逃逸到不了这里）
    // 这才是本次要补的缺口：22 条活（Notion 派单轮询、opc-* 五个同步、守卫、备份）零留痕。
    // 两腿都用 parseCrontabWithHost 自证落点：采到别的机器立刻抛错，不入错机器的数据。
    try {
      // 这里**故意不用 run()**：run 会再包一层 buildHostCmd，把命令套进
      // ssh→MMV，于是变成 ssh→MMV→ssh 172.17.0.1，而 MMV 的 docker 网关不是
      // us-vps（0921 实证：心跳 unreachable）。本腿自己就是完整的 ssh 命令，
      // 容器直接能到 172.17.0.1，不需要也不能再逃一次。
      const entries = parseCrontabWithHost(await exec(CRONTAB_CMD_USVPS), CRONTAB_HOST_EXPECT['us-vps']);
      await writeSchedulesSnapshot(pool, 'crontab', 'us-vps', entries, collectedAt);
      await writeHeartbeat(pool, 'crontab', 'us-vps', 'ok', null, null, collectedAt);
      results.crontab_usvps = { ok: true, schedules: entries.length };
    } catch (e) {
      const [status, code] = classifyError(e);
      await writeHeartbeat(pool, 'crontab', 'us-vps', status, code, e.message);
      results.crontab_usvps = { ok: false };
    }

    // —— 腿5: n8n run 执行历史@hk-vps（每次跑的记录 + 流程健康汇总）——
    try {
      const rawRuns = await run(N8N_RUNS_CMD);
      let runList;
      try { runList = JSON.parse(rawRuns || '[]'); } catch { throw new Error(`parse_error: n8n run 导出非法 JSON（前100字符: ${String(rawRuns).slice(0, 100)}）`); }
      const runs = parseN8nRuns(runList, 'hk-vps');
      if (runs.length === 0) throw new Error('parse_error: n8n 执行历史解析出 0 条（0=可疑，禁当真空）');
      for (const r of runs) {
        await pool.query(
          `INSERT INTO ops_runs (source, run_id, wf_id, status, mode, machine, started_at, stopped_at, duration_sec)
           VALUES ('n8n',$1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (source, run_id) DO UPDATE SET
             status=EXCLUDED.status, stopped_at=EXCLUDED.stopped_at, duration_sec=EXCLUDED.duration_sec`,
          [r.run_id, r.wf_id, r.status, r.mode, r.machine, r.started_at, r.stopped_at, r.duration_sec]);
      }
      // 回填每条流程的健康汇总 + 机器
      const byWf = new Map();
      for (const r of runs) {
        if (!byWf.has(r.wf_id)) byWf.set(r.wf_id, []);
        byWf.get(r.wf_id).push(r);
      }
      for (const [wfId, list] of byWf) {
        const s = summarizeRuns(list);
        // 活性判定：这条流程还会不会跑（按它自己的历史节奏，不是一刀切阈值）。
        // 只写机器列，人工列（owner/note/priority/starred/enable_intent）不在 SET 里，
        // 采集永远不会冲掉主理人在 Notion 上填的东西。
        const lv = summarizeLiveness(list, Date.now());
        await pool.query(
          `UPDATE ops_workflows SET machine='hk-vps', run_total=$1, run_success_rate=$2,
             run_avg_sec=$3, last_run_at=$4, last_run_status=$5,
             baseline_interval_sec=$6, liveness=$7, silent_sec=$8,
             warn_after_sec=$9, dead_after_sec=$10, liveness_at=NOW(), updated_at=NOW()
           WHERE source='n8n' AND wf_id=$11`,
          [s.total, s.success_rate, s.avg_duration_sec, s.last_run_at, s.last_status,
           lv.baseline_interval_sec, lv.liveness, lv.silent_sec,
           lv.warn_after_sec, lv.dead_after_sec, wfId]);
      }
      // 阶段级归因（刀8-A）：逐 skill 的真实运行次数/成功率/耗时。
      // 失败不影响 run 记录本身——归因是增益不是前提。
      try {
        // 阶段数据体积大（~80KB/条），单独放宽超时——默认 20s 拉 120 条必 ETIMEDOUT
        // （2026-09-08 生产实证：拉 300 条 ≈24MB 超时，归因整段跳过）
        const rawStages = await exec(buildHostCmd(N8N_STAGE_DATA_CMD, inContainer, opts.keyExistsFn), { timeoutMs: 120_000 });
        const execList = JSON.parse(rawStages || '[]') || [];
        const parsed = execList.map((x) => parseN8nExecutionStages(x));
        const stats = aggregateStageStats(parsed, STAGE_TO_SKILL);
        for (const [skillName, st] of stats) {
          await pool.query(
            `UPDATE ops_skills SET runs=$1, run_success=$2, run_success_rate=$3,
               run_avg_sec=$4, run_stats_at=$5, updated_at=NOW()
             WHERE source='openclaw' AND name=$6`,
            [st.runs, st.success, st.success_rate, st.avg_sec, collectedAt, skillName]);
        }
        results.stage_attribution = { ok: true, skills: stats.size, executions: parsed.length };
      } catch (e) {
        console.warn('[ops-collector] 阶段归因失败（不影响 run 记录）:', e.message?.slice(0, 160));
        results.stage_attribution = { ok: false };
      }
      await writeHeartbeat(pool, 'n8n-runs', 'hk-vps', 'ok', null, null, collectedAt);
      results.n8n_runs = { ok: true, runs: runs.length, workflows: byWf.size };
    } catch (e) {
      const [status, code] = classifyError(e);
      await writeHeartbeat(pool, 'n8n-runs', 'hk-vps', status, code, e.message);
      results.n8n_runs = { ok: false };
    }

    // —— 腿4: n8n workflow@hk-vps（业务流程，非"谁召唤谁"）——
    // 解析失败整份丢弃沿用上轮+stale（同 OpenClaw 腿契约）；agent 归属走传递闭包。
    try {
      const raw = await run(N8N_LIST_CMD);
      let all;
      try { all = JSON.parse(raw); } catch { throw new Error(`parse_error: n8n 导出非法 JSON（前100字符: ${String(raw).slice(0, 100)}）`); }
      const rows = parseN8nWorkflows(all);
      if (rows.length === 0) throw new Error('parse_error: n8n 解析出 0 条流程（0=可疑，禁当真空）');
      for (const r of rows) {
        await pool.query(
          `INSERT INTO ops_workflows (source, wf_id, name, active, node_count, stage_count, uses_agents, meta, updated_at)
           VALUES ('n8n',$1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (source, wf_id) DO UPDATE SET
             name=EXCLUDED.name, active=EXCLUDED.active, node_count=EXCLUDED.node_count,
             stage_count=EXCLUDED.stage_count, uses_agents=EXCLUDED.uses_agents,
             meta=EXCLUDED.meta, updated_at=EXCLUDED.updated_at`,
          [r.wf_id, r.name, r.active, r.node_count, r.stage_count,
           JSON.stringify(resolveWorkflowAgents(r.wf_id, all)), JSON.stringify(r.meta), collectedAt]
        );
      }
      await writeHeartbeat(pool, 'n8n', 'hk-vps', 'ok', null, null, collectedAt);
      results.n8n = { ok: true, workflows: rows.length };
    } catch (e) {
      const [status, code] = classifyError(e);
      await writeHeartbeat(pool, 'n8n', 'hk-vps', status, code, e.message);
      results.n8n = { ok: false };
    }

    return { ok: true, results };
  } finally {
    running = false;
  }
}
