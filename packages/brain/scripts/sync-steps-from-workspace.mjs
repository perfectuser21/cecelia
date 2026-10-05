#!/usr/bin/env node
/**
 * sync-steps-from-workspace.mjs — 把仓库 step-dod.json（真身）投影进 Brain `steps` 表
 *
 * 用法:
 *   node packages/brain/scripts/sync-steps-from-workspace.mjs [--file <step-dod.json>] [--dry-run]
 *   默认文件 /Users/administrator/perfect21/zenithjoy-workspace/services/phone-adb-controller/step-dod.json
 *   连库走 DB_DEFAULTS（DB_NAME 等 env 覆盖）。
 *
 * 规则:
 *   - 每步按 activity（= journey_steps.activity_key）+ capability_key 找到最新 backbone_version 的活动挂上去
 *   - 找不到活动 → 整批不写，抛 activity_not_found 并列出全部缺失（不吞）
 *   - key 冲突 → 更新 activity_id/step_order/mode/readback/source_sha256；幂等，重跑 0 变更
 *   - source_sha256 = sha256(canonical JSON(step))，与仓库现算不一致即漂移
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_FILE =
  '/Users/administrator/perfect21/zenithjoy-workspace/services/phone-adb-controller/step-dod.json';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stepSha256(step) {
  return createHash('sha256').update(canonicalJson(step)).digest('hex');
}

export function parseStepDod(jsonText) {
  const data = JSON.parse(jsonText);
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    throw new Error('step-dod.json 缺少非空 steps 数组');
  }
  const capability = data.capability || data.steps[0].key.split('.')[0];
  const steps = data.steps.map((s, i) => {
    if (!s.key || !s.activity) throw new Error(`第 ${i + 1} 步缺 key 或 activity: ${JSON.stringify(s)}`);
    return {
      order: i + 1,
      key: s.key,
      activity: s.activity,
      mode: s.mode || 'checkpoint',
      readback: s.readback ?? {},
    };
  });
  return { capability, version: data.version ?? null, contract_sha256: data.contract_sha256 ?? null, steps };
}

async function loadActivityMap(client, capabilityKey) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (activity_key) activity_key, id
       FROM activities
      WHERE capability_key = $1 AND activity_key IS NOT NULL
      ORDER BY activity_key, backbone_version DESC, step_number ASC`,
    [capabilityKey]
  );
  return new Map(rows.map((r) => [r.activity_key, r.id]));
}

export async function syncSteps(client, spec, { dryRun = false, manageTransaction = true } = {}) {
  const activities = await loadActivityMap(client, spec.capability);
  const missing = [...new Set(spec.steps.filter((s) => !activities.has(s.activity)).map((s) => s.activity))];
  if (missing.length > 0) {
    const keys = spec.steps.filter((s) => missing.includes(s.activity)).map((s) => s.key);
    throw new Error(
      `activity_not_found: capability=${spec.capability} activities=[${missing.join(', ')}] steps=[${keys.join(', ')}]`
    );
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  if (manageTransaction) await client.query('BEGIN');
  try {
    for (const step of spec.steps) {
      const activityId = activities.get(step.activity);
      const sha = stepSha256({ key: step.key, activity: step.activity, mode: step.mode, readback: step.readback });
      const existing = await client.query(
        `SELECT activity_id, step_order, source_sha256 FROM steps WHERE key = $1`,
        [step.key]
      );
      if (existing.rowCount === 0) {
        inserted += 1;
        if (!dryRun) {
          await client.query(
            `INSERT INTO steps (activity_id, step_order, key, activity_key, mode, readback, source_sha256)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
            [activityId, step.order, step.key, step.activity, step.mode, JSON.stringify(step.readback), sha]
          );
        }
        continue;
      }
      const row = existing.rows[0];
      if (row.source_sha256 === sha && row.activity_id === activityId && row.step_order === step.order) {
        unchanged += 1;
        continue;
      }
      updated += 1;
      if (!dryRun) {
        await client.query(
          `UPDATE steps
              SET activity_id = $2, step_order = $3, activity_key = $4, mode = $5,
                  readback = $6::jsonb, source_sha256 = $7, active = true, updated_at = now()
            WHERE key = $1`,
          [step.key, activityId, step.order, step.activity, step.mode, JSON.stringify(step.readback), sha]
        );
      }
    }
    if (manageTransaction) await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    if (manageTransaction) await client.query('ROLLBACK');
    throw error;
  }
  return { capability: spec.capability, total: spec.steps.length, inserted, updated, unchanged, dryRun };
}

async function main(argv) {
  const args = argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const file = fileIdx >= 0 ? args[fileIdx + 1] : DEFAULT_FILE;
  const dryRun = args.includes('--dry-run');
  const spec = parseStepDod(readFileSync(file, 'utf8'));
  const [{ default: pg }, { DB_DEFAULTS }] = await Promise.all([import('pg'), import('../src/db-config.js')]);
  const client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  try {
    const result = await syncSteps(client, spec, { dryRun });
    console.log(JSON.stringify({ file, ...result }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
