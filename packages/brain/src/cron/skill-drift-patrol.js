/**
 * skill-drift-patrol.js
 * 每日巡检：检测 6 个 harness skill SSOT vs 快照 version 漂移，
 * 写入 skill_drift_alerts（skill_name + drift_date UNIQUE），
 * 漂移时调用 raise('P1', ...)。
 *
 * 触发窗口：UTC 02:00-02:05 = 北京时间 10:00-10:05
 */

import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { raise } from '../alerting.js';
import pool from '../db.js';

export const PATROL_HOUR_UTC = 2;
export const PATROL_WINDOW_MINUTES = 5;

const HARNESS_DRIFT_SKILLS = [
  'harness-planner',
  'harness-contract-proposer',
  'harness-contract-reviewer',
  'harness-generator',
  'harness-evaluator',
  'harness-report',
];

async function readSkillVersion(filePath) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const line = content.split('\n').find((l) => l.startsWith('version:'));
  if (!line) return null;
  return line.slice('version:'.length).replace(/[\s"]/g, '') || null;
}

async function readSsotSkillVersion(ssotDir, name) {
  for (const candidate of [
    join(ssotDir, name, 'SKILL.md'),
    join(ssotDir, 'skills', name, 'SKILL.md'),
  ]) {
    try {
      await access(candidate);
    } catch {
      continue;
    }
    return readSkillVersion(candidate);
  }
  return null;
}

/**
 * 判断当前是否在每日巡检触发窗口内（UTC 02:00-02:05）
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInPatrolWindow(now = new Date()) {
  return now.getUTCHours() === PATROL_HOUR_UTC && now.getUTCMinutes() < PATROL_WINDOW_MINUTES;
}

/**
 * 执行 skill-drift 巡检：检测所有 harness skill，漂移时 raise P1 + 写库（按日去重）。
 * @param {import('pg').Pool} [db]
 */
export async function runSkillDriftPatrol(db = pool) {
  const now = new Date();
  const driftDate = now.toISOString().slice(0, 10);

  const ssotDir = process.env.SKILLS_SSOT_DIR || join(homedir(), 'perfect21', 'zenithjoy-skills');
  const repoRoot = process.env.REPO_ROOT || new URL('../../..', import.meta.url).pathname;
  const snapshotDir = process.env.SKILLS_SNAPSHOT_DIR || join(repoRoot, 'packages', 'workflows', 'skills');

  for (const name of HARNESS_DRIFT_SKILLS) {
    const ssotVersion = await readSsotSkillVersion(ssotDir, name);
    const snapshotVersion = await readSkillVersion(join(snapshotDir, name, 'SKILL.md'));
    const drifted = ssotVersion === null || snapshotVersion === null
      ? true
      : ssotVersion !== snapshotVersion;

    if (!drifted) continue;

    raise('P1', `skill_drift_${name}`, `skill ${name} 漂移: ssot=${ssotVersion ?? 'null'} snapshot=${snapshotVersion ?? 'null'}`)
      .catch((e) => console.warn(`[skill-drift-patrol] raise failed for ${name}:`, e.message));

    try {
      await db.query(
        `INSERT INTO skill_drift_alerts (skill_name, ssot_version, snapshot_version, drift_date, detected_at)
         VALUES ($1, $2, $3, $4::date, NOW())
         ON CONFLICT (skill_name, drift_date) DO NOTHING`,
        [name, ssotVersion, snapshotVersion, driftDate]
      );
    } catch (e) {
      console.error(`[skill-drift-patrol] DB insert failed for ${name}:`, e.message);
    }
  }
}
