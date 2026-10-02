import {readFileSync} from 'node:fs';

// 仅声明真实Router/createRoutedTask/selector/terminal消费的最小关系；不复制公共schema。
export async function initializeRetirementSchema(pool){
 await pool.query(`
 CREATE TABLE schema_version(version text PRIMARY KEY,description text,applied_at timestamptz DEFAULT now());
 CREATE TABLE tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,description text,priority text,
 task_type text,status text DEFAULT 'queued',project_id uuid,area_id uuid,goal_id uuid,
 location text,payload jsonb DEFAULT '{}',trigger_source text,domain text,okr_initiative_id uuid,
 ability_id uuid,blocked_at timestamptz,tags text[],prd_content text,execution_profile text,
 owner_role text,delivery_type text,created_by text,dept text,phase text,executor_kind text,
 parent_task_id uuid,sequence_no integer,kind text,blocked_reason text,blocked_detail jsonb,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),queued_at timestamptz DEFAULT now(),
 started_at timestamptz,completed_at timestamptz,claimed_by text,claimed_at timestamptz,
 metadata jsonb DEFAULT '{}',result jsonb,status_history jsonb DEFAULT '[]',error_message text);
 CREATE TABLE initiative_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),current_task_id uuid,orchestrator_version text);
 CREATE TABLE initiative_contracts(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
 CREATE TABLE map_scope_repositories(scope_key text,repo text,adapter_config jsonb DEFAULT '{}');
 CREATE TABLE task_dependencies(from_task_id uuid,to_task_id uuid,edge_type text,status text);
 CREATE TABLE harness_gap_dependencies(source_task_id uuid,status text);
 CREATE TABLE cecelia_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,source text,payload jsonb);
 CREATE TABLE working_memory(key text PRIMARY KEY,value_json jsonb,updated_at timestamptz);
 CREATE TABLE dispatch_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid,event_type text,reason text,created_at timestamptz);
 `);
 // 执行真实最低依赖migration，台账只由这些原SQL自己的footer记录。
 for(const name of ['413_work_routing_receipts.sql','426_map_repository_and_route_snapshot_authority.sql','427_direct_profile_frozen_contract.sql','465_work_routing_receipt_supersession.sql']){
  await pool.query(readFileSync(new URL(`../../../migrations/${name}`,import.meta.url),'utf8'));
 }
}
