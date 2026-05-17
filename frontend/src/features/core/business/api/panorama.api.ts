/**
 * Panorama API Client
 * Fetches VPS vitals and plan data
 */

const API_BASE = '/api/panorama';

export interface VitalsData {
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  uptime: {
    seconds: number;
    formatted: string;
  };
  load: number[];
}

export interface PlanItem {
  id: string;
  content: string;
  completed: boolean;
  priority?: 'high' | 'medium' | 'low';
}

export interface PlanData {
  date: string;
  items: PlanItem[];
  source: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Get VPS vitals (CPU, memory, disk, uptime)
 */
export async function getVitals(): Promise<ApiResponse<VitalsData>> {
  try {
    const response = await fetch(`${API_BASE}/vitals`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get today's plan
 */
export async function getPlan(): Promise<ApiResponse<PlanData>> {
  try {
    const response = await fetch(`${API_BASE}/plan`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
