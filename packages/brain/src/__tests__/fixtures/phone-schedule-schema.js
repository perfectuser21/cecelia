import {applyPhoneMainSchema} from './phone-main-schema.js';
import {readFileSync} from 'node:fs';
const BASE_SQL=`
 CREATE TABLE schema_version(version VARCHAR(10) PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');
 CREATE TABLE tasks(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),title TEXT,description TEXT,priority TEXT,task_type TEXT CONSTRAINT tasks_task_type_check CHECK(task_type IN ('dev','device_job','research')),executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('headed-session')),status TEXT,kind TEXT DEFAULT 'agent',
 project_id UUID,area_id UUID,goal_id UUID,okr_initiative_id UUID,ability_id UUID,blocked_at TIMESTAMPTZ,location TEXT,payload JSONB DEFAULT '{}',trigger_source TEXT,domain TEXT,tags TEXT[],prd_content TEXT,execution_profile TEXT,owner_role TEXT,delivery_type TEXT,created_by TEXT,dept TEXT,phase TEXT,parent_task_id UUID,sequence_no INTEGER,blocked_reason TEXT,blocked_detail JSONB,
 result JSONB,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now(),completed_at TIMESTAMPTZ,claimed_by TEXT,claimed_at TIMESTAMPTZ,due_at TIMESTAMPTZ,notion_id TEXT,notion_synced_at TIMESTAMPTZ,notion_props JSONB);
 CREATE UNIQUE INDEX idx_tasks_dedup_active ON tasks(title,COALESCE(goal_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE status IN ('queued','in_progress');
 CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2',current_task_id UUID);
 CREATE TABLE initiative_contracts(id UUID PRIMARY KEY);
 CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);
 CREATE TABLE map_scope_repositories(scope_key TEXT,repo TEXT,adapter_config JSONB DEFAULT '{}');
 CREATE TABLE cecelia_events(id BIGSERIAL PRIMARY KEY,event_type TEXT,source TEXT,payload JSONB,created_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE recurring_tasks(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),title TEXT NOT NULL,description TEXT,task_type TEXT,priority TEXT DEFAULT 'P1',goal_id UUID,project_id UUID,cron_expression TEXT,recurrence_type TEXT,template JSONB DEFAULT '{}',is_active BOOLEAN DEFAULT false,next_run_at TIMESTAMPTZ,last_run_at TIMESTAMPTZ,last_run_status TEXT,skip_streak INTEGER DEFAULT 0);
`;
export async function applyPhoneScheduleMigration(pool,name){
 const sql=readFileSync(new URL(`../../../migrations/${name}.sql`,import.meta.url),'utf8');
 if(/\b(?:public\.|CREATE\s+EXTENSION|CREATE\s+SCHEMA|DROP\s+SCHEMA|ALTER\s+DATABASE|CREATE\s+DATABASE)\b/i.test(sql))throw Error('phone_fixture_migration_not_schema_local');
 // 与实际migrate wrapper相同：body真实执行后才登记；不登记未执行的历史版本。
 await pool.query(sql);
 await pool.query('INSERT INTO schema_version(version,description) VALUES($1,$2) ON CONFLICT(version) DO NOTHING',[name.split('_')[0],name.replace(/^\d+_/, '')]);
}
export async function createPhoneScheduleSchema(pool,{ skipHttp = false } = {}){
 await pool.query(BASE_SQL);
 for(const name of ['272_janitor','357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','413_work_routing_receipts','421_work_routing_projection_guard','425_harness_attempt_cleanup_outbox','426_map_repository_and_route_snapshot_authority','427_direct_profile_frozen_contract','465_work_routing_receipt_supersession','471_script_executor_kind_and_task_type','472_validate_script_executor_constraints','490_phone_registry','501_capacity_reservations','503_execution_directory','504_app_server_generations','507_linux_script_authorization','508_phone_dispatches','510_us_brain_image_retention'])await applyPhoneScheduleMigration(pool,name);
 await applyPhoneMainSchema(pool);
 await pool.query(`CREATE TABLE kernel_controller_sessions(id TEXT PRIMARY KEY,task_id UUID REFERENCES tasks(id),run_id UUID,status TEXT);
 CREATE TABLE callback_queue(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID REFERENCES tasks(id),run_id TEXT,processed_at TIMESTAMPTZ);`);
 for(const name of ['065_device_locks','448_device_locks_phones','509_headed_task_takeover',...(skipHttp ? [] : ['517_phone_http_bindings','518_phone_http_leases'])])await applyPhoneScheduleMigration(pool,name);
}
