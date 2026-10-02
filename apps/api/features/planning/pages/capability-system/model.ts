export interface Gap {
  code?: string;
  gap?: string;
  entity_id?: string;
  entity_type?: string;
  step_id?: string;
  reference_id?: string;
}
export interface Area {
  id: string;
  name: string;
  parent_area_id?: string | null;
}
export interface Organization {
  effective_area?: Area | null;
  source?: string;
  gaps?: string[];
}
export interface Journey {
  id: string;
  name: string;
  role: string;
  parent_journey_id?: string | null;
  organization?: Organization;
  area_id?: string | null;
}
export interface Binding {
  kind: string;
  repo?: string;
  path?: string;
  revision?: string;
  digest?: string;
  status?: string;
  position?: string;
  scope?: string;
  step_key?: string | null;
  step_id?: string | null;
  validation_scope?: string;
  reason?: string;
}
export interface Step {
  id?: string;
  step_id?: string;
  activity_id?: string;
  key: string;
  name?: string;
  active?: boolean;
  projection_status?: string;
  source_sha256?: string;
  source_status?: string;
  source_verified?: boolean;
  content_hash_verified?: boolean;
  description?: string;
  mode?: string;
}
export interface Usage {
  workflow_id?: string;
  reference_id: string;
  slot_key: string;
  sequence_no: number;
  activity_definition_version_id?: string;
}
export interface Activity {
  id: string;
  name: string;
  definition_status?: string;
  current_definition_version_id?: string;
  definition_source?: { repo?: string; path?: string; commit?: string };
  implementation_bindings?: Binding[];
  consumers: Usage[];
  status?: string;
}
export interface ActivityUsage {
  id?: string;
  activity_id: string;
  name: string;
  usage: Usage;
  steps: Step[];
  gaps?: Gap[];
  definition_status?: string;
  shared_components?: Array<{ id: string; name: string; kind?: string }>;
}
export interface Workflow {
  channel?: string | null;
  form?: string | null;
  id: string;
  key: string;
  name: string;
  capability_id?: string;
  value_stream_id?: string;
  organization?: Organization;
  definition_status?: string;
  current_definition_version_id?: string;
  activities: ActivityUsage[];
}
export interface Registry {
  generated_at: string;
  counts: Record<string, Record<string, number>>;
  areas: Area[];
  journeys: Journey[];
  workflows: Workflow[];
  activities: Activity[];
  steps: Step[];
  enablers: Array<{
    id: string;
    name: string;
    kind?: string;
    source_status?: string;
    source_verified?: boolean;
  }>;
  gaps: Gap[];
  source_repos: string[];
}
export interface Selection {
  activity: Activity;
  usage?: Usage;
  workflow?: Workflow;
}
export const labels: Record<string, string> = {
  areas: "部门",
  value_streams: "价值流",
  capabilities: "能力",
  workflows: "工作流",
  activities: "活动定义",
  steps: "步骤",
  enablers: "共享组件",
  legacy_features: "旧 Feature",
};
export const stateLabel = (value?: string) => value || "unknown";
export async function getJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw Error(body?.error?.message || `读取失败 HTTP ${r.status}`);
  }
  return r.json();
}
