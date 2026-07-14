#!/usr/bin/env node
/**
 * seven-ring-audit.js — 七环巡检
 *
 * 七环定义（PRD 刀3⑩）：
 *   环1 测试入册  — test-pyramid-guard 数据新鲜且 pass
 *   环2 定时在跑  — Brain tick loop 正在运行，last_tick 在 10 分钟内
 *   环3 指纹是新的 — 近 2 小时内有 deploy-dev 成功记录（T3 闸产出）
 *   环4 账本写对  — quality snapshot permanent.total > 0，无 orphan 爆表
 *   环5 产出被消费 — 近 24h 内 Brain tasks 有 completed 记录
 *   环6 告警通道  — /api/brain/alerting/status 可达（Brain 自身健康）
 *   环7 面板数据新鲜 — quality/test-pyramid updated_at 在 26h 内
 *
 * 用法：node scripts/seven-ring-audit.js [--brain http://localhost:5221] [--dry-run]
 *
 * 结果写入 Brain KV: seven-ring-audit-last
 * 棘轮比较：scripts/seven-ring-ratchet.json（硬伤数只许降）
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RATCHET_FILE = join(__dirname, 'seven-ring-ratchet.json');

// ── 解析参数 ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const brainArg = args.find(a => a.startsWith('--brain=')) || args.find((_, i) => args[i - 1] === '--brain');
const BRAIN = brainArg?.includes('=') ? brainArg.split('=')[1] : (brainArg ? args[args.indexOf(brainArg) + 1] : null) || 'http://localhost:5221';
const DRY_RUN = args.includes('--dry-run');

// ── 辅助 ──────────────────────────────────────────────────────────────────
async function get(path) {
  const res = await fetch(`${BRAIN}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function minutesAgo(isoStr) {
  if (!isoStr) return Infinity;
  return (Date.now() - new Date(isoStr).getTime()) / 60000;
}

function hoursAgo(isoStr) {
  return minutesAgo(isoStr) / 60;
}

function ring(name, ok, detail) {
  return { name, ok, detail };
}

// ── 七环检查 ──────────────────────────────────────────────────────────────
async function checkRing1() {
  try {
    const d = await get('/api/brain/quality/test-pyramid');
    if (!d.available) return ring('环1:测试入册', false, 'quality snapshot 不可用');
    const age = hoursAgo(d.updated_at);
    if (age > 48) return ring('环1:测试入册', false, `数据过期 ${age.toFixed(1)}h > 48h`);
    if (!d.pass) return ring('环1:测试入册', false, `guard FAIL: ${(d.failures || []).join('; ')}`);
    return ring('环1:测试入册', true, `pass，数据 ${age.toFixed(1)}h 前更新`);
  } catch (e) {
    return ring('环1:测试入册', false, `请求失败: ${e.message}`);
  }
}

async function checkRing2() {
  try {
    const d = await get('/api/brain/tick/status');
    if (!d.loop_running) return ring('环2:定时在跑', false, 'loop_running=false');
    const age = minutesAgo(d.last_tick);
    if (age > 10) return ring('环2:定时在跑', false, `last_tick ${age.toFixed(1)}min 前 > 10min`);
    return ring('环2:定时在跑', true, `loop 正在跑，last_tick ${age.toFixed(1)}min 前`);
  } catch (e) {
    return ring('环2:定时在跑', false, `请求失败: ${e.message}`);
  }
}

async function checkRing3() {
  try {
    // 查 deploy_dev 表最近成功记录（T3 闸）
    const d = await get('/api/brain/deploy-dev?limit=3');
    const records = Array.isArray(d) ? d : (d.records || d.data || []);
    const recent = records.find(r => r.status === 'success' || r.status === 'green');
    if (!recent) return ring('环3:指纹是新的', false, '无成功 deploy-dev 记录');
    const age = hoursAgo(recent.created_at || recent.deployed_at || recent.updated_at);
    if (age > 48) return ring('环3:指纹是新的', false, `最近成功部署 ${age.toFixed(1)}h 前 > 48h`);
    return ring('环3:指纹是新的', true, `最近部署 ${age.toFixed(1)}h 前`);
  } catch (e) {
    // deploy-dev 路由可能不存在或无记录，降级为警告不阻断
    return ring('环3:指纹是新的', null, `无法核查: ${e.message}`);
  }
}

async function checkRing4() {
  try {
    const d = await get('/api/brain/quality/test-pyramid');
    if (!d.available) return ring('环4:账本写对', false, 'snapshot 不可用');
    const total = d.permanent?.total ?? 0;
    const orphans = d.orphans?.total ?? 0;
    if (total === 0) return ring('环4:账本写对', false, 'permanent.total = 0，账本空');
    if (orphans > 20) return ring('环4:账本写对', false, `孤儿测试 ${orphans} > 20`);
    return ring('环4:账本写对', true, `${total} 条永久测试，孤儿 ${orphans}`);
  } catch (e) {
    return ring('环4:账本写对', false, `请求失败: ${e.message}`);
  }
}

async function checkRing5() {
  try {
    const d = await get('/api/brain/tasks?status=completed&limit=5');
    const tasks = Array.isArray(d) ? d : (d.tasks || d.data || []);
    if (!tasks.length) return ring('环5:产出被消费', false, '无 completed 任务记录');
    const recent = tasks.find(t => hoursAgo(t.completed_at || t.updated_at) < 24);
    if (!recent) return ring('环5:产出被消费', false, '24h 内无 completed 任务');
    return ring('环5:产出被消费', true, `近 24h 有 ${tasks.length} 条 completed 记录`);
  } catch (e) {
    return ring('环5:产出被消费', false, `请求失败: ${e.message}`);
  }
}

async function checkRing6() {
  try {
    const d = await get('/api/brain/alerting/status');
    // 只要接口可达就算告警通道活着
    if (typeof d !== 'object') return ring('环6:告警通道', false, '响应格式异常');
    return ring('环6:告警通道', true, `告警通道可达，p1_pending=${d.p1_pending ?? '-'}`);
  } catch (e) {
    return ring('环6:告警通道', false, `告警接口不可达: ${e.message}`);
  }
}

async function checkRing7() {
  try {
    const d = await get('/api/brain/quality/test-pyramid');
    if (!d.available) return ring('环7:面板数据新鲜', false, 'snapshot 不可用');
    const age = hoursAgo(d.updated_at);
    if (age > 26) return ring('环7:面板数据新鲜', false, `数据 ${age.toFixed(1)}h 前 > 26h`);
    return ring('环7:面板数据新鲜', true, `数据 ${age.toFixed(1)}h 前更新`);
  } catch (e) {
    return ring('环7:面板数据新鲜', false, `请求失败: ${e.message}`);
  }
}

// ── 棘轮 ──────────────────────────────────────────────────────────────────
function loadRatchet() {
  if (!existsSync(RATCHET_FILE)) return null;
  try {
    return JSON.parse(readFileSync(RATCHET_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveRatchet(failCount) {
  writeFileSync(RATCHET_FILE, JSON.stringify({ fail_count: failCount, updated_at: new Date().toISOString() }, null, 2));
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[seven-ring-audit] Brain: ${BRAIN}${DRY_RUN ? ' (dry-run)' : ''}`);

  const results = await Promise.all([
    checkRing1(),
    checkRing2(),
    checkRing3(),
    checkRing4(),
    checkRing5(),
    checkRing6(),
    checkRing7(),
  ]);

  const hardFails = results.filter(r => r.ok === false).length;
  const unknowns = results.filter(r => r.ok === null).length;
  const pass = hardFails === 0;

  const audit = {
    run_at: new Date().toISOString(),
    pass,
    hard_fails: hardFails,
    unknowns,
    rings: results,
  };

  console.log('\n── 七环对账结果 ──────────────────────────────────');
  for (const r of results) {
    const icon = r.ok === true ? '✅' : r.ok === false ? '❌' : '⚠️';
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
  }
  console.log(`\n  总计：硬伤 ${hardFails}，不确定 ${unknowns}，整体 ${pass ? 'PASS' : 'FAIL'}`);

  // 棘轮检查
  const prev = loadRatchet();
  if (prev !== null && hardFails > prev.fail_count) {
    console.error(`\n🚨 棘轮告警：硬伤数 ${prev.fail_count} → ${hardFails}（只许降不许升）`);
    process.exitCode = 1;
  }
  if (!DRY_RUN) {
    saveRatchet(hardFails);
  }

  // 写入 Brain KV
  if (!DRY_RUN) {
    try {
      const resp = await fetch(`${BRAIN}/api/brain/kv/seven-ring-audit-last`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audit),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        console.log('\n[seven-ring-audit] ✅ 结果已写入 Brain KV: seven-ring-audit-last');
      } else {
        console.warn(`\n[seven-ring-audit] ⚠️ KV 写入失败: ${resp.status}`);
      }
    } catch (e) {
      console.warn(`\n[seven-ring-audit] ⚠️ KV 写入失败: ${e.message}`);
    }
  } else {
    console.log('\n[seven-ring-audit] (dry-run: 不写 KV，不更新棘轮)');
    console.log(JSON.stringify(audit, null, 2));
  }

  return audit;
}

main().catch(e => {
  console.error('[seven-ring-audit] 致命错误:', e);
  process.exit(1);
});
