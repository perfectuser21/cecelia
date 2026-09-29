/**
 * skill-ledger-assertion.js — MJ5 守夜 A6「skill 账本一致性」新口径（Skill 台账投影 PR1a，任务 47def5bb）
 *
 * 旧口径只比 skill_registry(openclaw) 与 ops_skills(openclaw) 两个行数（09-16 thin 版）。
 * 扫描入账（skill-inventory-sync）上线后，账本知道每个 skill 在不在，改比名单：
 *  ① ops_skills(openclaw)——clawdbot.json 里 agent 白名单引用的 skill——必须都在账本且 presence=present；
 *     不在 = agent 引用了一个不存在的 skill（真断链）。
 *  ② 带 task_types 的派发绑定行不得 gone/broken——否则派发会指向不存在的 skill。
 * 扫描从未成功过 → ok+degraded（与 A7~A10 无 token 降级同惯例），不猜。
 * 只要红就 upsert 一条 __skill_ledger_count__ 汇总行（UNIQUE(skill_name,drift_date) 幂等），名单只进 detail。
 * Notion 行数对账（A10 因 Skill Registry 改入口面而让出）由 PR1b 推送任务接上。
 */
export const SKILL_LEDGER_KEY = 'skill_ledger_consistency';
const LABEL = 'skill 账本一致性';
const SHOW = 8;

export async function buildSkillLedgerAssertion(q) {
  const st = await q.query(`SELECT value_json FROM working_memory WHERE key = 'skill_inventory_state'`);
  let state = st?.rows?.[0]?.value_json;
  if (typeof state === 'string') { try { state = JSON.parse(state); } catch { state = null; } }
  if (!state?.last_ok_at) {
    return { key: SKILL_LEDGER_KEY, label: LABEL, ok: true, degraded: true, detail: 'skill 扫描（skill-inventory-sync）尚未成功跑过，账本一致性暂不判' };
  }

  const unregistered = (await q.query(
    `SELECT o.name FROM ops_skills o
      WHERE o.source = 'openclaw'
        AND NOT EXISTS (SELECT 1 FROM skill_registry r
                         WHERE r.name = regexp_replace(o.name, '^openclaw/', '') AND r.presence = 'present')
      ORDER BY o.name`)).rows.map((r) => r.name);
  const deadBound = (await q.query(
    `SELECT name, presence FROM skill_registry
      WHERE task_types <> '{}' AND presence IN ('gone', 'broken') ORDER BY name`)).rows;

  const ok = unregistered.length === 0 && deadBound.length === 0;
  if (ok) {
    return { key: SKILL_LEDGER_KEY, label: LABEL, ok: true, detail: 'ops_skills 引用的 skill 全部在账且在用；派发绑定行无下线/断链' };
  }
  await q.query(
    `INSERT INTO skill_drift_alerts (skill_name, ssot_version, snapshot_version, drift_date)
     VALUES ($1, $2, $3, CURRENT_DATE)
     ON CONFLICT (skill_name, drift_date)
     DO UPDATE SET ssot_version = EXCLUDED.ssot_version, snapshot_version = EXCLUDED.snapshot_version, detected_at = NOW()`,
    ['__skill_ledger_count__', `ops引用未入账=${unregistered.length}`, `派发绑定失效=${deadBound.length}`],
  ).catch(() => {});
  const parts = [];
  if (unregistered.length) parts.push(`ops_skills 引用但账本不在/非在用 ${unregistered.length} 个：${unregistered.slice(0, SHOW).join('、')}${unregistered.length > SHOW ? '…' : ''}`);
  if (deadBound.length) parts.push(`派发绑定指向已下线/断链 ${deadBound.length} 个：${deadBound.slice(0, SHOW).map((r) => `${r.name}(${r.presence})`).join('、')}`);
  return { key: SKILL_LEDGER_KEY, label: LABEL, ok: false, detail: `账实分叉：${parts.join('；')}；已记入 skill_drift_alerts` };
}
