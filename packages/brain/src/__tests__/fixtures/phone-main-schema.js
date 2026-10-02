import {applyPhoneScheduleMigration} from './phone-schedule-schema.js';
// 仅私有维表；spans、视图、生成列和约束使用实际完整495/511/512/513/514/515/516。
export async function applyPhoneMainSchema(pool) {
 await pool.query(`CREATE TABLE workflows(id UUID PRIMARY KEY,key TEXT,capability_id UUID);
 CREATE TABLE journeys(id UUID PRIMARY KEY,parent_journey_id UUID);
 CREATE TABLE journey_steps(id UUID PRIMARY KEY,workflow_id UUID,activity_key TEXT,step_number INTEGER,status TEXT,journey_id UUID);
 CREATE TABLE steps(id UUID PRIMARY KEY);CREATE TABLE enablers(id UUID PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS task_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID REFERENCES tasks(id),run_id TEXT,status TEXT,ended_at TIMESTAMPTZ);`);
 for(const name of ['495_vs_model_spans','511_shared_activity_refs','512_linux_pool_controller','513_definition_versions','514_span_occurrences','515_release_definition_evidence','516_span_definition_provenance'])await applyPhoneScheduleMigration(pool,name);
}
export function phoneMigrationFile(files,suffix) {
 const matches=files.filter(name=>name.endsWith(`_${suffix}.sql`));
 if(matches.length!==1)throw Error(`phone_fixture_migration_ambiguous:${suffix}`);
 return matches[0];
}

export function assertPhoneFixtureDatabase(database,ci,message='phone_fixture_scratch_required') {
 if(database!=='cecelia_scratch'&&!(ci==='true'&&database==='cecelia_test'))throw Error(message);
}
