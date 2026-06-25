/* eslint-disable no-undef */ // Node ESM 全局(process/fetch/console/AbortSignal)
// ZenithJoy Autopilot — 薄指挥(conductor)编排器 / A 道
// 设计依据: zenithjoy/docs/superpowers/specs/2026-06-21-zenithjoy-autopilot-design.md
//
// 这是编排骨架。核心命门: 取活 → 出 Contract → 【方向闸】 → A道(到 PR)。
// 方向闸: 动手前先把 Contract 摆出来; 主理人一句话掰回方向 → 只重出 Contract、绝不浪费 PR。
//
// 模块分工(一人一个文件,互不抢锁):
//   contract.mjs      proposeContract/renderContract   ← Agent A(接真 LLM Proposer)
//   a-lane.mjs        runALane                         ← Agent B(接 engine-worktree/ship/pr-watchdog)
//   decision-view.mjs readVerdict/publishContract      ← Agent C(接 Notion「待决策」视图)
//   deadman.mjs       beat/deadmanCheck                ← Agent C(接飞书告警)
//   conductor.mjs     编排循环 + 分诊 + 入口            ← 协调员(本文件,不交 agent)
//
// 用法:
//   node conductor.mjs --demo            内置「走偏→掰回」剧本(看效果)
//   node conductor.mjs --once            从真 Brain 取一个就绪活,出 Contract 写进待决策
//   node conductor.mjs --deadman-check   检查心跳 stale 则报红 exit 1

import { beat, deadmanCheck } from './deadman.mjs';
import { proposeContract, renderContract } from './contract.mjs';
import { runALane } from './a-lane.mjs';
import { readVerdict, publishContract, QUEUE_DIR } from './decision-view.mjs';

const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';

// ── 分诊器: 用主理人 DoD 的两类断言当分界线 ──────────────────────────
// 逻辑断言(CI 能验) → A 道全自动; 接缝断言(碰真机/生产) → B 道(本骨架不含,挡回)。
function triage(task) {
  const seamSignals = /微信|抖音|真机|UIA|wechat|rpa|生产 ?env|朋友圈|publish.*真发/i;
  const text = `${task.title || ''} ${task.description || ''}`;
  if (seamSignals.test(text)) return { lane: 'B', reason: '命中接缝信号(真机/生产),A道骨架不接,需人定方向' };
  return { lane: 'A', reason: '逻辑活,CI 能验,可全自动' };
}

// ── 指挥处理一个活: 取活 → Contract → 方向闸(可多轮掰回) → A道 ──────
async function conductOne(task, { mode = 'demo', script = [] } = {}) {
  const ledger = { redirects: 0, prsOpened: 0, timeline: [] };
  const stamp = (ev) => ledger.timeline.push(`${new Date().toISOString().slice(11, 19)} ${ev}`);

  beat('pull'); stamp(`📥 取活: ${task.title}`);
  const t = triage(task); stamp(`🚦 分诊: ${t.lane} 道 — ${t.reason}`);
  if (t.lane === 'B') {
    stamp('⏸️  接缝活 → 不进 A 道, 写「待决策」等主理人定方向(B 道,本骨架不实现)');
    return { ...ledger, halted: 'B-lane' };
  }

  let round = 0, steer = undefined;
  while (true) {
    round++;
    beat('contract');
    const c = await proposeContract(task, steer);
    stamp(`📝 出第 ${round} 版 Contract: ${c.approach.slice(0, 42)}…`);
    console.log('\n' + renderContract(task, c, round) + '\n');

    beat('gate');
    const verdict = await readVerdict({ mode, script, round, taskId: task.id });
    if (!verdict) { stamp('⏸️  暂停在方向闸,等人审(状态保留)'); return { ...ledger, halted: 'await-verdict', lastContract: c }; }

    if (verdict.action === 'redirect') {
      ledger.redirects++; steer = verdict.steer;
      stamp(`↩️  主理人掰回方向: "${verdict.steer}" → 重出 Contract(注意: 未写一行代码、未开 PR)`);
      continue;
    }
    if (verdict.action === 'approve') {
      stamp('✅ 主理人放行 → 进 A 道');
      beat('a-lane');
      const pr = runALane(task, c);
      ledger.prsOpened++;
      stamp(`🚀 A道开 PR: ${pr.pr}`);
      return { ...ledger, done: true, pr };
    }
    throw new Error(`未知裁决: ${JSON.stringify(verdict)}`);
  }
}

// ── 真 Brain: 取一个就绪逻辑活 ──────────────────────────────────────
async function pullReadyTask() {
  const r = await fetch(`${BRAIN}/api/brain/tasks?status=queued&limit=1`).catch(() => null);
  if (!r || !r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

// ── 入口 ────────────────────────────────────────────────────────────
const mode = process.argv[2] || '--demo';

if (mode === '--deadman-check') {
  await deadmanCheck();
} else if (mode === '--demo') {
  console.log('═══ 薄指挥 DEMO · 命门剧本: 喂个会走偏的活 → 闸拦下 → 一句话掰回 → 不浪费 PR ═══\n');
  const task = { id: 'demo-cache', title: '给 daily-report 加缓存', description: '报表每次都重算,慢' };
  const script = [
    { action: 'redirect', steer: '缓存要放服务端 Redis,不是前端 localStorage' },
    { action: 'approve' },
  ];
  const r = await conductOne(task, { mode: 'demo', script });
  console.log('─── 时间线 ───');
  r.timeline.forEach((l) => console.log('  ' + l));
  console.log('\n─── 命门验收指标 ───');
  console.log(`  方向掰回次数: ${r.redirects}`);
  console.log(`  因走偏浪费的 PR: ${r.prsOpened - (r.done ? 1 : 0)}  ← 关键: 应为 0(掰回发生在 Contract 阶段,动手前)`);
  console.log(`  最终正确方向开 PR: ${r.done ? 1 : 0}`);
  await deadmanCheck();
} else if (mode === '--once') {
  const task = await pullReadyTask();
  if (!task) { console.log('Brain 无 queued 就绪活,空转(真实里转入闲时自找低风险活)'); beat('idle'); process.exit(0); }
  console.log(`从 Brain 取到活: ${task.title} (${task.id})`);
  const r = await conductOne(task, { mode: 'once' });
  if (r.halted === 'await-verdict') {
    const f = publishContract(task, r.lastContract);
    console.log(`已写「待决策」: ${f}`);
    console.log(`主理人审完写裁决到: ${QUEUE_DIR}/${task.id}.verdict  例: {"action":"approve"} 或 {"action":"redirect","steer":"..."}`);
  }
} else {
  console.error(`未知参数: ${mode}。用 --demo / --once / --deadman-check`);
  process.exit(2);
}
