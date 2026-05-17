// VPS Monitor API client

const API_BASE = import.meta.env.VITE_API_URL || '';

// Types matching backend response
export interface SystemStats {
  hostname: string;
  platform: string;
  uptime: number;
  cpu: {
    model: string;
    cores: number;
    usage: number;
    loadAverage: {
      '1min': number;
      '5min': number;
      '15min': number;
    };
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: string;
    used?: string;
    available?: string;
    usagePercent?: number;
  };
  network: Array<{
    interface: string;
    bytesReceived: number;
    bytesSent: number;
    packetsReceived: number;
    packetsSent: number;
  }>;
  timestamp: number;
}

export interface ContainerInfo {
  name: string;
  status: string;
  ports: string;
  cpu: string;           // CPU 使用率字符串，如 "33.12%"
  cpuPercent: number;    // CPU 使用率数值，如 33.12
  memory: string;        // 内存使用量，如 "789.2MiB / 15.61GiB"
  memoryPercent: number; // 内存使用率数值，如 4.94
}

export interface ContainersResponse {
  containers: ContainerInfo[];
  running: number;
  total: number;
  timestamp: number;
}

export interface ServiceInfo {
  name: string;
  containerName: string;
  port: number;
  status: 'running' | 'stopped' | 'unknown';
  uptime: string;
}

export interface ServicesResponse {
  services: ServiceInfo[];
  timestamp: number;
}

export interface MetricPoint {
  time: string;
  cpu: number;
  memory: number;
  load: number;
  disk: number;
}

export interface MetricsHistoryResponse {
  metrics: MetricPoint[];
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

// API functions
export const vpsMonitorApi = {
  getStats: async (): Promise<SystemStats> => {
    return fetchApi('/api/v1/vps-monitor/stats');
  },

  getContainers: async (): Promise<ContainersResponse> => {
    return fetchApi('/api/v1/vps-monitor/containers');
  },

  getServices: async (): Promise<ServicesResponse> => {
    return fetchApi('/api/v1/vps-monitor/services');
  },

  getHistory: async (hours: number = 24): Promise<MetricPoint[]> => {
    const response = await fetchApi<MetricsHistoryResponse>(
      `/api/v1/vps-monitor/history?hours=${hours}`
    );
    return response.metrics;
  },
};
