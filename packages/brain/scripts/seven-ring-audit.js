#!/usr/bin/env node
/**
 * seven-ring-audit.js — 七环对账巡检
 *
 * 七环 = 写了≠入册了 / 入册了≠在跑 / 在跑≠跑的是新的 / 跑了≠写对了
 *       写对了≠有人消费 / 没告警≠健康 / 面板上的≠现实的
 *
 * 产出：
 *   - POST /api/brain/kv/seven-ring-audit-last（供面板展示 + DoD curl 验证）
 *   - 更新 packages/quality/ratchets/seven-ring-hard-faults.json（硬伤棘轮）
 *   - 可选：写日报 note
 *
 * 用法：node packages/brain/scripts/seven-ring-audit.js [--note]
 *       --note 额外把结果写进 Brain AI Notes（适合 ci-patrol 调用）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RATCHET_PATH = join(__dirname, '../../quality/ratchets/seven-ring-hard-faults.json');
const WRITE_NOTE = process.argv.includes('--note');

// ─── Brain API 探测 ────────────────────────────────────────────────────────
async function detectBrain() {
  for (const url of ['http://localhost:5221', 'http://host.docker.internal:5221']) {
    try {
      const r = await fetch(`${url}/api/brain/tick/status`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return url;
    } catch { /* try next */ }
  }
  throw new Error('Brain API 双路径均不可达');
}

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// ─── 七环检查函数 ──────────────────────────────────────────────────────────

async function r1_testsRegistered(brain) {
  try {
    const data = await fetchJson(`${brain}/api/brain/quality/test-pyramid`);
    if (!data.available) return { status: 'fail', detail: 'test-pyramid 数据不可用，guard 未运行' };
    const ageH = (Date.now() - new Date(data.updated_at).getTime()) / 3600000;
    if (ageH > 25) return { status: 'fail', detail: `数据陈旧 ${ageH.toFixed(1)}h（阈值 25h）` };
    if (!data.pass) return { status: 'fail', detail: `guard FAIL: ${(data.failures || []).slice(0, 2).join('; ')}` };
    return { status: 'pass', detail: `guard PASS，${data.permanent?.total ?? '?'} 个测试，${ageH.toFixed(1)}h 前更新` };
  } catch (e) {
    return { status: 'fail', detail: `异常: ${e.message}` };
  }
}

async function r2_loopRunning(brain) {
  try {
    const data = await fetchJson(`${brain}/api/brain/tick/status`);
    if (!data.loop_running) return { status: 'fail', detail: 'tick loop 未运行（loop_running=false）' };
    const ageMin = (Date.now() - new Date(data.last_tick).getTime()) / 60000;
    if (ageMin > 10) return { status: 'fail', detail: `last_tick ${ageMin.toFixed(1)} 分钟前（阈值 10min）` };
    return { status: 'pass', detail: `tick 正常，${ageMin.toFixed(1)}min 前，interval ${data.interval_minutes}min` };
  } catch (e) {
    return { status: 'fail', detail: `异常: ${e.message}` };
  }
}

async function r3_deployFingerprint(brain) {
  // 复用 T2/T3 闸产出：检查 smoke-gate-last KV key
  try {
    const r = await fetch(`${brain}/api/brain/kv/smoke-gate-last`, { signal: AbortSignal.timeout(4000) });
    if (r.status === 404) {
      return { status: 'unknown', detail: 'smoke-gate-last 尚未入库（T2/T3 产出待落库）' };
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const ts = data.updated_at || data.checked_at;
    const ageH = ts ? (Date.now() - new Date(ts).getTime()) / 3600000 : 999;
    if (ageH > 25) return { status: 'fail', detail: `部署指纹陈旧 ${ageH.toFixed(1)}h（阈值 25h）` };
    if (data.pass === false) return { status: 'fail', detail: `smoke gate FAIL: ${data.detail || ''}` };
    return { status: 'pass', detail: `smoke gate PASS，${ageH.toFixed(1)}h 前` };
  } catch (e) {
    return { status: 'unknown', detail: `无法检查: ${e.message}` };
  }
}

async function r4_ledgerCorrect(brain) {
  // 账本写对 = OKR 有进度
  try {
    const data = await fetchJson(`${brain}/api/brain/okr/current`);
    const objectives = Array.isArray(data) ? data : (data.objectives || []);
    const active = objectives.filter(o => o.status === 'active');
    const withProgress = active.filter(o => (o.progress_pct ?? 0) > 0);
    if (active.length === 0) return { status: 'unknown', detail: '无 active OKR' };
    if (withProgress.length === 0) return { status: 'fail', detail: `${active.length} 个 active OKR 进度均为 0` };
    return { status: 'pass', detail: `${withProgress.length}/${active.length} 个 OKR 有进度记录` };
  } catch (e) {
    return { status: 'fail', detail: `异常: ${e.message}` };
  }
}

async function r5_outputConsumed(brain) {
  // 产出有人消费 = 最近 48h 有任务完成
  try {
    const data = await fetchJson(`${brain}/api/brain/tasks?status=completed&limit=5`);
    const tasks = Array.isArray(data) ? data : (data.tasks || data.data || []);
    if (tasks.length === 0) return { status: 'fail', detail: '无已完成任务记录' };
    const latest = tasks[0];
    const ageH = latest.completed_at
      ? (Date.now() - new Date(latest.completed_at).getTime()) / 3600000
      : (latest.updated_at ? (Date.now() - new Date(latest.updated_at).getTime()) / 3600000 : 999);
    if (ageH > 48) return { status: 'fail', detail: `最近完成任务 ${ageH.toFixed(1)}h 前（阈值 48h）` };
    return { status: 'pass', detail: `最近完成：「${(latest.title || '').slice(0, 28)}」，${ageH.toFixed(1)}h 前` };
  } catch (e) {
    return { status: 'fail', detail: `异常: ${e.message}` };
  }
}

async function r6_alertChannelAlive(brain) {
  // 告警通道活着 = tick 运行 + 最近派发成功
  try {
    const data = await fetchJson(`${brain}/api/brain/tick/status`);
    if (!data.loop_running) return { status: 'fail', detail: 'tick 未运行，告警通道阻塞' };
    const ld = data.last_dispatch;
    if (!ld) return { status: 'unknown', detail: '尚无派发记录（系统刚启动？）' };
    if (ld.success === false) return { status: 'fail', detail: `最近派发失败: ${(ld.task_title || '').slice(0, 25)}` };
    const ageH = (Date.now() - new Date(ld.dispatched_at).getTime()) / 3600000;
    return { status: 'pass', detail: `派发正常，最近：「${(ld.task_title || '').slice(0, 25)}」，${ageH.toFixed(1)}h 前` };
  } catch (e) {
    return { status: 'fail', detail: `异常: ${e.message}` };
  }
}

async function r7_dashboardFresh(brain) {
  // 面板数据新鲜 = quality_test_pyramid 数据 <25h
  try {
    const data = await fetchJson(`${brain}/api/brain/quality/test-pyramid`);
    if (!data.available) return { status: 'fail', detail: '面板数据不可用（quality_test_pyramid 为空）' };
    const ageH = (Date.now() - new Date(data.updated_at).getTime()) / 3600000;
    if (ageH > 25) return { status: 'fail', detail: `面板数据陈旧 ${ageH.toFixed(1)}h（阈值 25h）` };
    return { status: 'pass', detail: `面板数据新鲜，${ageH.toFixed(1)}h 前更新` };
  } catch (e) {
    return { status: 'fail', detail: `异常: ${e.message}` };
  }
}

// ─── 棘轮 ──────────────────────────────────────────────────────────────────

function loadRatchet() {
  if (!existsSync(RATCHET_PATH)) return null;
  try {
    return JSON.parse(readFileSync(RATCHET_PATH, 'utf8'));
  } catch { return null; }
}

function saveRatchet(data) {
  const dir = dirname(RATCHET_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(RATCHET_PATH, JSON.stringify(data, null, 2) + '\n');
}

function checkRatchet(hardFaultCount, rings) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = loadRatchet();

  if (!existing) {
    // 首跑：建基准，不告警
    const ratchet = {
      established: today,
      max_hard_faults_allowed: hardFaultCount,
      last_audit: today,
      last_hard_fault_count: hardFaultCount,
      rings_failed: rings.filter(r => r.status === 'fail').map(r => r.name),
    };
    saveRatchet(ratchet);
    return { broken: false, firstRun: true, ratchet };
  }

  const broken = hardFaultCount > existing.max_hard_faults_allowed;
  const updated = {
    ...existing,
    max_hard_faults_allowed: broken
      ? existing.max_hard_faults_allowed
      : Math.min(existing.max_hard_faults_allowed, hardFaultCount),
    last_audit: today,
    last_hard_fault_count: hardFaultCount,
    rings_failed: rings.filter(r => r.status === 'fail').map(r => r.name),
  };
  saveRatchet(updated);
  return { broken, firstRun: false, ratchet: updated };
}

// ─── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  let brain;
  try {
    brain = await detectBrain();
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  console.log(`[seven-ring-audit] Brain: ${brain}`);

  const RINGS = [
    { id: 'r1', name: '测试入册', fn: r1_testsRegistered },
    { id: 'r2', name: '定时循环在跑', fn: r2_loopRunning },
    { id: 'r3', name: '部署指纹是新的', fn: r3_deployFingerprint },
    { id: 'r4', name: '账本写对', fn: r4_ledgerCorrect },
    { id: 'r5', name: '产出有人消费', fn: r5_outputConsumed },
    { id: 'r6', name: '告警通道活着', fn: r6_alertChannelAlive },
    { id: 'r7', name: '面板数据新鲜', fn: r7_dashboardFresh },
  ];

  const rings = [];
  for (const ring of RINGS) {
    process.stdout.write(`  环${ring.id.slice(1)}: ${ring.name} ... `);
    const result = await ring.fn(brain);
    const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
    console.log(`${icon} ${result.detail}`);
    rings.push({ id: ring.id, name: ring.name, ...result });
  }

  const hardFaults = rings.filter(r => r.status === 'fail').length;
  const unknowns = rings.filter(r => r.status === 'unknown').length;
  const pass = hardFaults === 0;

  console.log(`\n硬伤: ${hardFaults} / 未知: ${unknowns} / ${pass ? '✅ PASS' : '❌ FAIL'}`);

  // 棘轮检查
  const { broken, firstRun, ratchet } = checkRatchet(hardFaults, rings);
  if (firstRun) {
    console.log(`[ratchet] 首跑建基准，max_allowed=${ratchet.max_hard_faults_allowed}`);
  } else if (broken) {
    console.error(`[ratchet] ❌ 棘轮断裂！硬伤 ${hardFaults} > 允许值 ${ratchet.max_hard_faults_allowed}`);
  } else {
    console.log(`[ratchet] ✅ 棘轮完好，max_allowed=${ratchet.max_hard_faults_allowed}`);
  }

  // 写 Brain KV
  const snapshot = {
    available: true,
    pass,
    hard_faults: hardFaults,
    unknowns,
    ratchet_broken: broken,
    rings,
    audited_at: new Date().toISOString(),
  };

  try {
    const r = await fetch(`${brain}/api/brain/kv/seven-ring-audit-last`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const body = await r.json();
      console.log(`[kv] 写入成功，updated_at=${body.updated_at}`);
    } else {
      console.error(`[kv] 写入失败: HTTP ${r.status}`);
    }
  } catch (e) {
    console.error(`[kv] 写入异常: ${e.message}`);
  }

  // 可选：写日报 note
  if (WRITE_NOTE) {
    const noteBody = buildNoteBody(rings, hardFaults, pass, broken, ratchet);
    try {
      const r = await fetch(`${brain}/api/brain/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[seven-ring-audit] 七环对账 ${new Date().toISOString().slice(0, 10)}`,
          type: 'log',
          content: noteBody,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) console.log('[note] 日报写入成功');
      else console.error(`[note] 写入失败: HTTP ${r.status}`);
    } catch (e) {
      console.error(`[note] 写入异常: ${e.message}`);
    }
  }

  process.exit(broken ? 1 : 0);
}

function buildNoteBody(rings, hardFaults, pass, broken, ratchet) {
  const icon = pass ? '✅' : '❌';
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const ratchetLine = broken
    ? `**棘轮 ❌ 断裂**：硬伤 ${hardFaults} > 允许值 ${ratchet.max_hard_faults_allowed}`
    : `棘轮 ✅ 完好，max_allowed=${ratchet.max_hard_faults_allowed}`;

  const ringLines = rings.map(r => {
    const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';
    return `- ${icon} **环${r.id.slice(1)}: ${r.name}** — ${r.detail}`;
  }).join('\n');

  return `# 七环对账 ${date}

${icon} 总结：硬伤 ${hardFaults} 个${broken ? ' | ❌ 棘轮断裂' : ''}

${ratchetLine}

## 七环逐项

${ringLines}

---
棘轮文件：\`packages/quality/ratchets/seven-ring-hard-faults.json\``;
}

main().catch(e => {
  console.error('[seven-ring-audit] fatal:', e);
  process.exit(1);
});
