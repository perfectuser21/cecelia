/** 发布线·只读查询（决策 de6dff5d 第 3 步）。 */
import { releaseLineFlags, getPointer, everConverged } from './release-line.js';

const VERSION_SQL = `SELECT v.id, v.version_no, v.content_md5, v.first_build_id, v.created_at,
    (SELECT count(*)::int FROM activity_version_builds m WHERE m.activity_version_id = v.id) AS build_count,
    (SELECT jsonb_build_object('id', b.id, 'source_commit', b.source_commit, 'created_at', b.created_at)
       FROM activity_version_builds m JOIN activity_definition_versions b ON b.id = m.build_id
      WHERE m.activity_version_id = v.id ORDER BY b.created_at DESC LIMIT 1) AS latest_build
  FROM activity_versions v`;

export async function listReleaseEvents(db, activityId, { limit = 20 } = {}) {
  return (await db.query('SELECT * FROM activity_release_events WHERE activity_id = $1 ORDER BY id DESC LIMIT $2', [activityId, limit])).rows;
}

export async function listContentVersions(db, activityId) {
  return (await db.query(`${VERSION_SQL} WHERE v.activity_id = $1 ORDER BY v.version_no DESC`, [activityId])).rows;
}

/** 各部署目标最近一个 release 里该 Activity 的构建与版本——执行端实际可能在跑的，和账面生产指针对照。 */
async function targetVersions(db, activityId) {
  if (!(await db.query("SELECT to_regclass('release_versions') IS NOT NULL AS ok")).rows[0]?.ok) return [];
  return (await db.query(
    `SELECT DISTINCT ON (r.environment, r.target) r.id AS release_id, r.environment, r.target, r.created_at,
            r.payload->'verification'->>'status' AS verification_status, a->>'id' AS build_id, m.activity_version_id, v.version_no
       FROM release_versions r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'activities') a
       LEFT JOIN activity_version_builds m ON m.build_id::text = a->>'id'
       LEFT JOIN activity_versions v ON v.id = m.activity_version_id
      WHERE a->>'activity_id' = $1
      ORDER BY r.environment, r.target, r.created_at DESC`, [activityId])).rows;
}

/** GET /activities/:id/release：生产版、最新、候选、是否受保护、最近事件、各目标机最近 release 的版本、开关。 */
export async function getActivityRelease(db, activityId) {
  const activity = (await db.query('SELECT id, current_definition_version_id FROM activities WHERE id = $1', [activityId])).rows[0];
  if (!activity) return null;
  const pointer = await getPointer(db, activityId);
  const versions = await listContentVersions(db, activityId);
  const latestMap = activity.current_definition_version_id ? (await db.query(
    'SELECT activity_version_id FROM activity_version_builds WHERE build_id = $1', [activity.current_definition_version_id])).rows[0] : null;
  const production = pointer ? versions.find(v => v.id === pointer.production_version_id) ?? null : null;
  const latest = latestMap ? versions.find(v => v.id === latestMap.activity_version_id) ?? null : null;
  const candidates = production ? versions.filter(v => v.version_no > production.version_no) : versions;
  const targets = await targetVersions(db, activityId);
  return {
    activity_id: activityId,
    production, latest, candidates,
    ever_converged: production ? await everConverged(db, activityId, production.id) : false,
    current_definition_version_id: activity.current_definition_version_id,
    latest_release_per_target: targets.map(t => ({ ...t, matches_production: Boolean(production && t.activity_version_id === production.id) })),
    events: await listReleaseEvents(db, activityId, { limit: 20 }),
    flags: releaseLineFlags(),
    note: '把关开关关闭期间生产版只是账面指针；执行端实际跑的是各目标机已部署的 release（见 latest_release_per_target）',
  };
}

/** 当前生产配方；每格带生产版号与该版本最新构建，?commit= 时再带该 commit 下的构建。 */
export async function getProductionRecipe(db, workflowId, { commit = null } = {}) {
  const row = (await db.query('SELECT * FROM workflow_production_recipes WHERE workflow_id = $1 ORDER BY id DESC LIMIT 1', [workflowId])).rows[0];
  if (!row) return null;
  const slots = [];
  for (const slot of row.recipe) {
    const extra = slot.activity_version_id ? (await db.query(
      `SELECT v.version_no,
              (SELECT jsonb_build_object('id', b.id, 'source_commit', b.source_commit) FROM activity_version_builds m
                 JOIN activity_definition_versions b ON b.id = m.build_id WHERE m.activity_version_id = v.id ORDER BY b.created_at DESC LIMIT 1) AS latest_build,
              (SELECT b.id FROM activity_version_builds m JOIN activity_definition_versions b ON b.id = m.build_id
                WHERE m.activity_version_id = v.id AND b.source_commit = $2 ORDER BY b.created_at DESC LIMIT 1) AS commit_build_id
         FROM activity_versions v WHERE v.id = $1`, [slot.activity_version_id, commit])).rows[0] : null;
    slots.push({ ...slot, version_no: extra?.version_no ?? null, latest_build: extra?.latest_build ?? null,
      ...(commit ? { commit_build_id: extra?.commit_build_id ?? null } : {}) });
  }
  return { ...row, recipe: slots };
}

export async function listProductionRecipes(db, workflowId, { limit = 20 } = {}) {
  return (await db.query('SELECT * FROM workflow_production_recipes WHERE workflow_id = $1 ORDER BY id DESC LIMIT $2', [workflowId, limit])).rows;
}
