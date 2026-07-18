#!/usr/bin/env node
/**
 * unclaimed-ratio.mjs — nightly 无主比例统计 + 棘轮告警
 *
 * 查 graph_edges 覆盖节点中不在任何 covered 认领域的比例，
 * 输出 JSONL（每行含 date/total_nodes/unclaimed_nodes/unclaimed_ratio），
 * 比例上升 → 开 [claim-ratchet-red] GH Issue（日期去重）。
 *
 * 合同: B5/B6
 *
 * 用法:
 *   node packages/brain/scripts/ci/unclaimed-ratio.mjs --output /tmp/unclaimed-ratio.jsonl
 *   node packages/brain/scripts/ci/unclaimed-ratio.mjs --fire-test --dry-run-issue --output /tmp/x.jsonl
 *   fire_test=1 node packages/brain/scripts/ci/unclaimed-ratio.mjs ...
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ci/ → brain → packages → workspace(root)，需上4级
const REPO_ROOT = path.resolve(__dirname, '../../../..');

// ─── CLI 参数解析 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outputArg = args.find((a) => a.startsWith('--output=')) || args[args.indexOf('--output') + 1];
const outputPath = (outputArg && !outputArg.startsWith('--'))
  ? outputArg
  : (args.find((a) => a.startsWith('--output='))?.replace('--output=', '')) || '/tmp/unclaimed-ratio.jsonl';

const fireTest = args.includes('--fire-test') || process.env.fire_test === '1' || process.env.FIRE_TEST === '1';
const dryRunIssue = args.includes('--dry-run-issue');

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const REPO = 'cecelia';
const CLAIM_DEPTH = 10;

// ─── 复用 graph-query.js 纯函数 ───────────────────────────────────────────────
const graphQueryPath = path.resolve(REPO_ROOT, 'packages/brain/src/lib/graph-query.js');
const { buildAdjacency, reachable, classifyFeatureAnchors } = await import(graphQueryPath);

// ─── buildClaimZones（与 routes/graph.js 完全等价）────────────────────────────
function buildClaimZones(ctx) {
  const zones = [];
  for (const c of ctx.classified) {
    if (c.status !== 'covered') continue;
    const nodes = c.anchors.filter((a) => a.matched_node).map((a) => a.matched_node);
    const zone = new Set([
      ...reachable(ctx.adj, nodes, { dir: 'fwd', maxDepth: CLAIM_DEPTH }),
      ...reachable(ctx.adj, nodes, { dir: 'rev', maxDepth: CLAIM_DEPTH }),
    ]);
    zones.push({ feature_id: c.feature_id, name: c.name, zone });
  }
  return zones;
}

// ─── 读 Brain KV ───────────────────────────────────────────────────────────────
async function getKV(key) {
  try {
    const resp = await fetch(`${BRAIN_URL}/api/brain/kv/${key}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.value;
  } catch {
    return null;
  }
}

async function setKV(key, value) {
  try {
    const resp = await fetch(`${BRAIN_URL}/api/brain/kv/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── 创建 GH Issue（棘轮告警）───────────────────────────────────────────────
async function openIssueIfNeeded(today, ratio, dryRun) {
  const title = `[claim-ratchet-red] 无主比例上升 — ${today}`;

  if (dryRun) {
    console.log(`[RATCHET] --dry-run-issue 模式: 不创建 Issue`);
    console.log(`[RATCHET] Issue title: ${title}`);
    console.log(`[RATCHET] Issue body: 当日 unclaimed_ratio=${ratio.toFixed(4)} > 历史最高`);
    return;
  }

  // 检查是否已有同日 open issue（去重）
  try {
    const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
    const repo = process.env.GITHUB_REPOSITORY || process.env.GH_REPO || '';
    if (!repo) {
      console.warn('[RATCHET] GITHUB_REPOSITORY 未设置，跳过 Issue 创建');
      return;
    }
    const searchCmd = `gh api "repos/${repo}/issues?state=open&per_page=50" --jq "[.[] | select(.title==${JSON.stringify(title)})] | length"`;
    const existing = parseInt(execSync(searchCmd, {
      env: { ...process.env, GH_TOKEN: ghToken },
      encoding: 'utf8',
    }).trim() || '0', 10);

    if (existing > 0) {
      console.log(`[RATCHET] 已有同日 open issue，跳过: ${title}`);
      return;
    }

    const body = `## 无主比例上升\n\n**日期**: ${today}\n**unclaimed_ratio**: ${ratio.toFixed(4)}\n\n当日无主比例超过历史最高值，请检查并处置新增无主文件。\n\n> 本 Issue 由 unclaimed-ratio.mjs 自动创建。`;

    execSync(
      `gh issue create --repo ${repo} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label "claim-ratchet-red" 2>/dev/null || gh issue create --repo ${repo} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`,
      {
        env: { ...process.env, GH_TOKEN: ghToken },
        encoding: 'utf8',
      }
    );
    console.log(`[RATCHET] GitHub Issue 已创建: ${title}`);
  } catch (err) {
    console.warn('[RATCHET] Issue 创建失败（可能无 GH_TOKEN 或 label 不存在）:', err.message);
  }
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // fire_test 模式：强制 ratio=1.0
  if (fireTest) {
    console.log('[UNCLAIMED-RATIO] fire_test=1 模式: 强制 ratio=1.0');
    const line = JSON.stringify({
      date: today,
      total_nodes: 1,
      unclaimed_nodes: 1,
      unclaimed_ratio: 1.0,
      mode: 'fire_test',
    });
    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, line + '\n', 'utf8');
    console.log(`[UNCLAIMED-RATIO] 输出写入: ${outputPath}`);
    console.log(line);

    // 棘轮判定
    const histMax = parseFloat((await getKV('claim_ratchet_max')) || '0');
    if (1.0 > histMax) {
      console.log(`[RATCHET] 当日 ratio=1.0 > 历史最高 ${histMax} → 触发告警`);
      await openIssueIfNeeded(today, 1.0, dryRunIssue);
      await setKV('claim_ratchet_max', 1.0);
    } else {
      console.log(`[RATCHET] 当日 ratio=1.0 <= 历史最高 ${histMax}，跳过`);
    }
    return;
  }

  // 正常模式：连接 DB
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const dbName = process.env.DB_NAME || 'cecelia_test';
  const dbUser = process.env.DB_USER || 'cecelia';
  const dbPassword = process.env.DB_PASSWORD || '';

  const pool = new pg.Pool({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: dbUser,
    password: dbPassword,
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  });

  try {
    // 查 graph_edges
    const { rows: edges } = await pool.query(
      `SELECT src_path, dst_path, edge_type FROM graph_edges WHERE repo = $1`,
      [REPO]
    );

    // 查 journey_features（用于 buildClaimZones）
    const { rows: features } = await pool.query(
      `SELECT id, name, unit_test_path, workflow_ref, guard_ref FROM journey_features`
    );

    const adj = buildAdjacency(edges);
    const nodeSet = new Set([...adj.fwd.keys(), ...adj.rev.keys()]);
    const classified = classifyFeatureAnchors(features, nodeSet);

    // buildClaimZones
    const zones = buildClaimZones({ adj, nodeSet, classified });

    // 计算 unclaimed 比例
    const total_nodes = nodeSet.size;
    let unclaimed_nodes = 0;
    for (const node of nodeSet) {
      const inCoveredZone = zones.some((z) => z.zone.has(node));
      if (!inCoveredZone) unclaimed_nodes++;
    }

    const unclaimed_ratio = total_nodes === 0 ? 0 : unclaimed_nodes / total_nodes;

    console.log(`[UNCLAIMED-RATIO] total_nodes=${total_nodes}, unclaimed_nodes=${unclaimed_nodes}, ratio=${unclaimed_ratio.toFixed(4)}`);

    // 写 JSONL
    const line = JSON.stringify({
      date: today,
      total_nodes,
      unclaimed_nodes,
      unclaimed_ratio,
    });
    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, line + '\n', 'utf8');
    console.log(`[UNCLAIMED-RATIO] 输出写入: ${outputPath}`);
    console.log(line);

    // 棘轮判定
    const histMax = parseFloat((await getKV('claim_ratchet_max')) || '0');
    if (unclaimed_ratio > histMax) {
      console.log(`[RATCHET] 当日 ratio=${unclaimed_ratio.toFixed(4)} > 历史最高 ${histMax} → 触发告警`);
      await openIssueIfNeeded(today, unclaimed_ratio, dryRunIssue);
      await setKV('claim_ratchet_max', unclaimed_ratio);
    } else {
      console.log(`[RATCHET] 当日 ratio=${unclaimed_ratio.toFixed(4)} <= 历史最高 ${histMax}，无需告警`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[UNCLAIMED-RATIO] 未预期错误:', err);
  process.exit(1);
});
