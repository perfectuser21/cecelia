import { randomUUID } from 'node:crypto';

// 本例只验证真实writer的字段持久化；最小schema不是生产migration验收。
export async function prepareActionsWriterSchema(client) {
  const schema = `actions_fields_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET LOCAL search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, description text,
      priority text, task_type text, status text, project_id uuid, area_id uuid,
      goal_id uuid, location text, payload jsonb, trigger_source text, domain text,
      okr_initiative_id uuid, ability_id uuid, blocked_at timestamptz,
      tags text[], prd_content text, execution_profile text, owner_role text,
      delivery_type text, created_by text, dept text, phase text, executor_kind text,
      parent_task_id uuid, sequence_no int, kind text, blocked_reason text, blocked_detail jsonb
    );
    CREATE TABLE map_scope_repositories (scope_key text, repo text, adapter_config jsonb);
    CREATE TABLE initiative_runs (current_task_id uuid, orchestrator_version text);
    CREATE TABLE work_routing_receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, source text, source_id text,
      work_kind text, change_kind text, pipeline text, canonical_task_type text,
      default_execution_profile text, execution_profile_override text, repo text,
      map_scope jsonb, impact_contract_required boolean, orchestrator text, router_version text,
      route_reason text, evidence jsonb, map_scope_validation_version text,
      direct_contract_seed jsonb, anchor_generation integer DEFAULT 0, created_at timestamptz
    );
    CREATE TABLE cecelia_events (event_type text, source text, payload jsonb);
  `);
  return schema;
}
