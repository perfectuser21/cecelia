#!/usr/bin/env node
/**
 * apply-anchors.mjs — 锚点回填 apply器
 *
 * Usage:
 *   node packages/brain/scripts/apply-anchors.mjs --input <approved.json> [--dry-run] [--output <result.json>]
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';
import brainAuth from '../../../scripts/lib/brain-auth-headers.cjs';

const { brainAuthHeaders } = brainAuth;

const ANCHOR_FIELDS = ['unit_test_path', 'workflow_ref', 'guard_ref'];

export function parseApprovedFile(jsonContent) {
  const data = JSON.parse(jsonContent);
  if (!Array.isArray(data.entries)) throw new Error('approved 文件缺少 entries 数组');
  for (const e of data.entries) {
    if (!e.feature_id) throw new Error('entries 中有一条缺少 feature_id: ' + JSON.stringify(e));
  }
  return data.entries;
}

export function buildPatchPayload(entry) {
  const payload = {};
  for (const field of ANCHOR_FIELDS) {
    if (entry[field] != null) payload[field] = entry[field];
  }
  return payload;
}

export async function resolveFeatureId(queryFn, shortId) {
  const { rows } = await queryFn(
    `SELECT id FROM journey_features WHERE id::text ILIKE $1 LIMIT 5`,
    [`${shortId}%`]
  );
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new Error(`短id "${shortId}" 命中多条(${rows.length})，需要人工核实唯一性`);
  return rows[0].id;
}

// ── CLI 入口(被直接执行时才跑;被 import 时跳过,方便单测) ──────────────────
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('用法: node apply-anchors.mjs --input <approved.json> [--dry-run] [--output <result.json>]');
    process.exit(1);
  }
  const dryRun = !!args['dry-run'];
  const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

  const pool = new pg.Pool(DB_DEFAULTS);
  const queryFn = (sql, params) => pool.query(sql, params);

  const entries = parseApprovedFile(readFileSync(resolve(args.input), 'utf8'));
  const applied = [];
  const skipped = [];
  const failed = [];

  for (const entry of entries) {
    try {
      const featureId = await resolveFeatureId(queryFn, entry.feature_id);
      if (!featureId) {
        skipped.push({ feature_id: entry.feature_id, reason: 'not_found' });
        continue;
      }
      const payload = buildPatchPayload(entry);
      if (Object.keys(payload).length === 0) {
        skipped.push({ feature_id: entry.feature_id, reason: 'no_fields' });
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] ${entry.feature_id} → ${featureId}: ${JSON.stringify(payload)}`);
        applied.push({ feature_id: entry.feature_id, resolved_id: featureId, fields: payload, dry_run: true });
        continue;
      }
      const resp = await fetch(`${BRAIN_URL}/api/brain/journey_features/${featureId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...brainAuthHeaders() },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        failed.push({ feature_id: entry.feature_id, reason: `HTTP ${resp.status}` });
        continue;
      }
      console.log(`[applied] ${entry.feature_id} → ${featureId}: ${JSON.stringify(payload)}`);
      applied.push({ feature_id: entry.feature_id, resolved_id: featureId, fields: payload });
    } catch (err) {
      failed.push({ feature_id: entry.feature_id, reason: err.message });
    }
  }

  await pool.end();

  const result = { applied, skipped, failed };
  console.log(`\n汇总: applied=${applied.length} skipped=${skipped.length} failed=${failed.length}`);
  if (args.output) {
    writeFileSync(resolve(args.output), JSON.stringify(result, null, 2));
    console.log(`结果已写入 ${args.output}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

const isMainModule = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main();
}
