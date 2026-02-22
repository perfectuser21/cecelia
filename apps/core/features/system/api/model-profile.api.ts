import { apiClient } from './client';

export interface ModelLayerConfig {
  provider: string;
  model: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  is_active: boolean;
  config: {
    thalamus: ModelLayerConfig;
    cortex: ModelLayerConfig;
    executor: {
      default_provider: string;
      model_map?: Record<string, Record<string, string | null>>;
      fixed_provider?: Record<string, string>;
    };
  };
  created_at: string;
  updated_at: string;
}

export interface ModelProfilesResponse {
  success: boolean;
  profiles: ModelProfile[];
}

export interface ActiveProfileResponse {
  success: boolean;
  profile: ModelProfile;
}

export async function fetchModelProfiles(): Promise<ModelProfile[]> {
  const res = await apiClient.get<ModelProfilesResponse>('/brain/model-profiles');
  return res.data.profiles;
}

export async function fetchActiveProfile(): Promise<ModelProfile> {
  const res = await apiClient.get<ActiveProfileResponse>('/brain/model-profiles/active');
  return res.data.profile;
}

export async function switchProfile(profileId: string): Promise<void> {
  await apiClient.put('/brain/model-profiles/active', { profile_id: profileId });
}

// ============================================================
// Model Registry 类型
// ============================================================

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  tier: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  layer: 'brain' | 'executor';
  allowed_models: string[];
  fixed_provider: string | null;
}

export interface ModelRegistryResponse {
  success: boolean;
  models: ModelInfo[];
  agents: AgentInfo[];
}

export interface UpdateAgentModelResponse {
  success: boolean;
  agent_id: string;
  previous: Record<string, unknown>;
  current: { provider: string; model: string };
  profile: ModelProfile;
}

// ============================================================
// Model Registry API
// ============================================================

export async function fetchModelRegistry(): Promise<{ models: ModelInfo[]; agents: AgentInfo[] }> {
  const res = await apiClient.get<ModelRegistryResponse>('/brain/model-profiles/models');
  return { models: res.data.models, agents: res.data.agents };
}

export async function updateAgentModel(
  agentId: string,
  modelId: string
): Promise<UpdateAgentModelResponse> {
  const res = await apiClient.patch<UpdateAgentModelResponse>('/brain/model-profiles/active/agent', {
    agent_id: agentId,
    model_id: modelId,
  });
  return res.data;
}
