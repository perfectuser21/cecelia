import {digest} from '../orchestrator/commander-decision.js';

/** 动作账只保存不可变意图与已验收事实；Workflow进度由DBOS独占。 */
export function createCommanderActionStore(pool) {
  const assertIdentity = (row, identity) => {
    if (!row || digest(row.identity) !== digest(identity)) throw Error('commander_action_identity_conflict');
    const deadline_ms = Number(row.deadline_ms);
    if (!Number.isSafeInteger(deadline_ms) || deadline_ms <= 0) throw Error('commander_action_deadline_invalid');
    return {...row,deadline_ms};
  };
  async function read(db, identity) {
    const {rows} = await db.query('SELECT identity,state,result,deadline_ms FROM commander_activity_actions WHERE run_id=$1 AND activity_key=$2', [identity.run_id, identity.activity_key]);
    return assertIdentity(rows[0], identity);
  }
  return {
    async reserve(identity, {deadline_ms}) {
      const inserted = await pool.query(`INSERT INTO commander_activity_actions(action_id,run_id,activity_key,identity,state,deadline_ms)
        VALUES($1,$2,$3,$4,'reserved',$5) ON CONFLICT DO NOTHING RETURNING identity,state,result,deadline_ms`,
      [identity.action_id,identity.run_id,identity.activity_key,JSON.stringify(identity),deadline_ms]);
      return {created:inserted.rowCount === 1, record:inserted.rowCount ? assertIdentity(inserted.rows[0],identity) : await read(pool,identity)};
    },
    async settle(identity, result) {
      const saved = await pool.query(`UPDATE commander_activity_actions SET state='settled',result=$3::jsonb
        WHERE run_id=$1 AND activity_key=$2 AND state='reserved' AND identity=$4::jsonb RETURNING identity,state,result,deadline_ms`,
      [identity.run_id,identity.activity_key,JSON.stringify(result),JSON.stringify(identity)]);
      const row = saved.rowCount ? saved.rows[0] : await read(pool,identity);
      if (row.state !== 'settled' || digest(row.result) !== digest(result)) throw Error('commander_action_settlement_conflict');
      return row.result;
    },
  };
}
