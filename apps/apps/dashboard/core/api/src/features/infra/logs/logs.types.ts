// Logs feature types

export interface Log {
  id: number;
  user_id?: number;
  action: string;
  resource_type?: string;
  resource_id?: number;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export interface CreateLogDTO {
  user_id?: number;
  action: string;
  resource_type?: string;
  resource_id?: number;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
}
