/**
 * Engine API
 * Engine 能力信息 API 调用
 */

import { apiClient } from './client';

// Types
export interface Skill {
  name: string;
  description: string;
  trigger: string;
  status: 'active' | 'inactive';
}

export interface Hook {
  name: string;
  trigger: string;
  description: string;
  protectedPaths: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
  type: 'major' | 'minor' | 'patch';
}

export interface EngineInfo {
  version: string;
  name: string;
  description: string;
  skills: Skill[];
  hooks: Hook[];
  changelog: ChangelogEntry[];
}

interface EngineInfoResponse {
  success: boolean;
  engine?: EngineInfo;
  error?: string;
}

interface HealthResponse {
  success: boolean;
  status: string;
  engineAccessible: boolean;
  timestamp: string;
}

// API Functions

/**
 * 获取 Engine 健康状态
 */
export async function getEngineHealth(): Promise<HealthResponse> {
  const response = await apiClient.get('/engine/health');
  return response.data;
}

/**
 * 获取 Engine 完整信息
 */
export async function getEngineInfo(): Promise<EngineInfoResponse> {
  const response = await apiClient.get('/engine/info');
  return response.data;
}
