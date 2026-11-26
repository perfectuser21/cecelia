import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function captureReplayEvidence({root,runId,schema,pool,real}){
 if(!/^repair_actions_[a-f0-9]{32}$/.test(schema))throw Error('repair_evidence_schema_invalid');
 const read=name=>fs.readFileSync(path.join(root,name));
 const artifact=read('answer.json');JSON.parse(artifact.toString('utf8'));
 // Real subscription mode has no calls.jsonl meter: do not claim calls were measured.
 const calls=real?null:read('calls.jsonl');
 if(calls!==null){
  const lines=calls.toString('utf8').trim();if(!lines)throw Error('repair_call_evidence_empty');
  for(const line of lines.split('\n'))JSON.parse(line);
 }
 const decisions=fs.existsSync(path.join(root,'decisions.jsonl'))?read('decisions.jsonl'):null;
 // These are the action store's immutable identity/intent and settled facts.
 // created_at is unrelated wall-clock metadata, not a replay side-effect contract.
 const actions=(await pool.query(`SELECT action_id,run_id,activity_key,attempt,identity,state,result,deadline_ms
   FROM ${schema}.commander_activity_actions WHERE run_id=$1 ORDER BY activity_key,attempt,action_id`,[runId])).rows;
 assert(Array.isArray(actions),'repair_action_evidence_missing');
 return {calls,actions,artifact,decisions};
}
export function assertReplayEvidence(before,after){
 assert.deepEqual(after.calls,before.calls,'commander_replay_calls_changed');
 assert.deepEqual(after.actions,before.actions,'commander_replay_actions_changed');
 assert.deepEqual(after.artifact,before.artifact,'commander_replay_artifact_changed');
 assert.deepEqual(after.decisions,before.decisions,'commander_replay_decisions_changed');
 return {calls:before.calls===null?null:after.calls.equals(before.calls),
  actions:true,artifact:after.artifact.equals(before.artifact)};
}
