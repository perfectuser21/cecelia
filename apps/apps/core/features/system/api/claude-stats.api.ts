import { apiClient } from './client';

export interface ModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost: number;
}

export interface DailyStats {
  date: string;
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  sessions: number;
}

export interface SessionStats {
  session_id: string;
  cwd: string;
  started_at: string;
  ended_at: string | null;
  model: string;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  messages: number;
}

export interface StatsOverview {
  total_cost: number;
  total_sessions: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  average_cost_per_session: number;
  by_model: ModelUsage[];
}

export interface StatsResponse {
  overview: StatsOverview;
  daily: DailyStats[];
  recent_sessions: SessionStats[];
}

const emptyStats: StatsResponse = {
  overview: {
    total_cost: 0, total_sessions: 0, total_messages: 0,
    total_input_tokens: 0, total_output_tokens: 0,
    average_cost_per_session: 0, by_model: [],
  },
  daily: [],
  recent_sessions: [],
};

export const claudeStatsApi = {
  getStats: async (days: number = 30): Promise<StatsResponse> => {
    try {
      const response = await apiClient.get<StatsResponse>('/v1/claude-stats', {
        params: { days },
        timeout: 8000,
      });
      return response.data;
    } catch {
      return emptyStats;
    }
  },
};
