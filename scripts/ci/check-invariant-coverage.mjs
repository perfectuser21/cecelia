#!/usr/bin/env node
/**
 * check-invariant-coverage.mjs — CL-2 invariant→契约桥（红线裸奔检测）
 * ----------------------------------------------------------------------------
 * 读 Brain 的 invariant 全集（decisions 表 category='invariant' status='active'），
 * 比对根 regression-contract.yaml 的 golden_paths[].invariant_ids：
 *   有红线但没有任何契约条目守卫 → 报「invariant #X 裸奔」。
 *
 * 双模数据源（CI 没有 Brain/DB）：
 *   1. API 模式：本地/有 Brain 时走 GET $BRAIN_URL/api/brain/invariants
 *      （routes/abilities.js 的干净端点；status.js:270 的 /decisions?category= 是坏端点勿用）
 *   2. 快照模式：API 不可达（CI）时读 config/invariants-snapshot.json
 *      （由 scripts/ci/export-invariants-snapshot.mjs 定期导出；
 *       exported_at 超 30 天 → 告警提醒刷新，不 fail）
 *   环境开关：INVARIANT_BRIDGE_SOURCE=snapshot 强制跳过 API（测试/CI 确定性）
 *
 * 出口三态：
 *   - 无裸奔 → exit 0
 *   - 有裸奔 + 告警模式（默认）→ 打印裸奔清单，exit 0
 *   - 有裸奔 + INVARIANT_BRIDGE_STRICT=1 → exit 1
 *   - 数据源/契约文件缺失等配置错误 → exit 2
 *
 * 用法：node scripts/ci/check-invariant-coverage.mjs \
 *         [--snapshot config/invariants-snapshot.json] [--contract regression-contract.yaml]
 *
 * 纯 node 内建，零依赖（yaml 用受控格式的小解析器，只认 golden_paths 条目结构）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STALE_DAYS = 30;

// ── 纯函数（导出可测）───────────────────────────────────────────────────────

/**
 * 从 regression-contract.yaml 文本提取 golden_paths 条目的 id + invariant_ids。
 * 只支持本仓库受控格式：
 *   - id: CORE-XXX            （两空格缩进的条目起始）
 *     invariant_ids: [a, b]   （inline flow）
 *     invariant_ids:          （block 列表）
 *       - a
 * 无 invariant_ids 字段 → 空数组（additive 兼容，现有条目不用动）。
 */
export function parseContractInvariantIds(yamlText) {
  const lines = yamlText.split('\n');
  const entries = [];
  let current = null;
  let inBlockList = false;

  const clean = (s) => s.trim().replace(/^["']|["']$/g, '');

  for (const raw of lines) {
    // 去尾注释（受控格式：id/uuid 值里不含 '#'，如 `invariant_ids: [uuid]  # 备注`）
    const line = raw.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (/^\s*#/.test(line) || line.trim() === '') continue;

    const entryStart = line.match(/^  - id:\s*(.+)$/);
    if (entryStart) {
      current = { id: clean(entryStart[1]), invariantIds: [] };
      entries.push(current);
      inBlockList = false;
      continue;
    }
    if (!current) continue;

    if (inBlockList) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) { current.invariantIds.push(clean(item[1])); continue; }
      inBlockList = false; // 列表结束，落回普通字段处理
    }

    const inline = line.match(/^\s+invariant_ids:\s*\[(.*)\]\s*$/);
    if (inline) {
      current.invariantIds.push(...inline[1].split(',').map(clean).filter(Boolean));
      continue;
    }
    if (/^\s+invariant_ids:\s*$/.test(line)) { inBlockList = true; continue; }
  }
  return entries;
}

/**
 * 快照 invariants × 契约条目 → 覆盖对账。
 * @returns {{covered:[], naked:[], unknownRefs:[]}}
 *   covered: 有守卫的 invariant（附 guardedBy 契约条目 id 列表）
 *   naked:   裸奔的 invariant（有红线无守卫）
 *   unknownRefs: 契约里引用了快照不存在的 id（typo / 已失效 → 假覆盖风险）
 */
export function computeCoverage(invariants, contractEntries) {
  const guardMap = new Map(); // invariantId -> [entryId]
  for (const entry of contractEntries) {
    for (const invId of entry.invariantIds) {
      if (!guardMap.has(invId)) guardMap.set(invId, []);
      guardMap.get(invId).push(entry.id);
    }
  }
  const knownIds = new Set(invariants.map((i) => i.id));
  const covered = [];
  const naked = [];
  for (const inv of invariants) {
    const guardedBy = guardMap.get(inv.id);
    if (guardedBy && guardedBy.length > 0) covered.push({ ...inv, guardedBy });
    else naked.push(inv);
  }
  const unknownRefs = [];
  for (const entry of contractEntries) {
    for (const invId of entry.invariantIds) {
      if (!knownIds.has(invId)) unknownRefs.push({ entryId: entry.id, invariantId: invId });
    }
  }
  return { covered, naked, unknownRefs };
}

/** exported_at 距 now 超过 maxDays → stale（提醒刷新快照，不 fail）。 */
export function checkSnapshotFreshness(exportedAt, now = new Date(), maxDays = STALE_DAYS) {
  const ageDays = (now.getTime() - new Date(exportedAt).getTime()) / 86400000;
  return { stale: ageDays > maxDays, ageDays: Math.round(ageDays * 10) / 10 };
}

// ── 数据源（双模）───────────────────────────────────────────────────────────

async function loadInvariantsFromApi(brainUrl) {
  const res = await fetch(`${brainUrl}/api/brain/invariants`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('API 返回非数组');
  return rows.map((r) => ({ id: r.id, topic: r.topic, priority: r.priority, created_at: r.created_at }));
}

function loadInvariantsFromSnapshot(path) {
  if (!existsSync(path)) return null;
  const snap = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(snap.invariants)) throw new Error(`快照格式错误（缺 invariants 数组）: ${path}`);
  return snap;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const argOf = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  const snapshotPath = argOf('--snapshot', 'config/invariants-snapshot.json');
  const contractPath = argOf('--contract', 'regression-contract.yaml');
  const strict = process.env.INVARIANT_BRIDGE_STRICT === '1';
  const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
  const forceSnapshot = process.env.INVARIANT_BRIDGE_SOURCE === 'snapshot';

  if (!existsSync(contractPath)) {
    console.error(`ERROR: 契约文件不存在: ${contractPath}`);
    process.exit(2);
  }

  // 数据源：API 优先（本地有 Brain），不可达回落快照（CI）
  let invariants = null;
  let source = '';
  if (!forceSnapshot) {
    try {
      invariants = await loadInvariantsFromApi(brainUrl);
      source = `api (${brainUrl})`;
    } catch {
      /* Brain 不可达（CI 常态）→ 走快照 */
    }
  }
  if (!invariants) {
    const snap = loadInvariantsFromSnapshot(snapshotPath);
    if (!snap) {
      console.error(`ERROR: Brain API 不可达且快照不存在: ${snapshotPath}`);
      console.error('  刷新方法（本地 Brain 活着时）: node scripts/ci/export-invariants-snapshot.mjs');
      process.exit(2);
    }
    invariants = snap.invariants;
    source = `snapshot (${snapshotPath}, exported_at=${snap.exported_at})`;
    if (snap.exported_at) {
      const { stale, ageDays } = checkSnapshotFreshness(snap.exported_at);
      if (stale) {
        console.log(`⚠️  快照已 ${ageDays} 天未刷新（>${STALE_DAYS} 天）——请在本地 Brain 活着时执行:`);
        console.log('    node scripts/ci/export-invariants-snapshot.mjs');
      }
    }
  }

  const entries = parseContractInvariantIds(readFileSync(contractPath, 'utf8'));
  const { covered, naked, unknownRefs } = computeCoverage(invariants, entries);

  console.log('== invariant→契约桥 红线裸奔检测（CL-2）==');
  console.log(`数据源: ${source}`);
  console.log(`invariant 全集: ${invariants.length} 条 | 有守卫: ${covered.length} | 裸奔: ${naked.length}`);
  console.log('');

  for (const c of covered) {
    console.log(`  ✅ ${c.id.slice(0, 8)} ${c.topic} ← 守卫: ${c.guardedBy.join(', ')}`);
  }
  if (naked.length > 0) {
    console.log('');
    console.log(`🚨 裸奔红线（有 invariant 无对应契约守卫）× ${naked.length}:`);
    naked.forEach((n, i) => {
      console.log(`  ${i + 1}. invariant #${n.id.slice(0, 8)} [${n.priority || '-'}] ${n.topic} — 无守卫`);
    });
    console.log('');
    console.log('  补救：在 regression-contract.yaml golden_paths 加守卫条目，');
    console.log('  并给条目挂 invariant_ids: [<上面的完整 uuid>]（additive，不影响现有条目）。');
  }
  if (unknownRefs.length > 0) {
    console.log('');
    console.log(`⚠️  契约引用了 invariant 全集里不存在的 id（typo/已失效 → 假覆盖）× ${unknownRefs.length}:`);
    for (const u of unknownRefs) console.log(`  - ${u.entryId} → ${u.invariantId}`);
  }

  console.log('');
  if (naked.length === 0 && unknownRefs.length === 0) {
    console.log('== invariant-bridge PASS：全部红线有守卫 ==');
    process.exit(0);
  }
  if (strict) {
    console.log('== invariant-bridge FAIL（INVARIANT_BRIDGE_STRICT=1 强制模式）==');
    process.exit(1);
  }
  console.log('== invariant-bridge WARN（告警模式，exit 0；转强制: INVARIANT_BRIDGE_STRICT=1）==');
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  });
}
