const API_BASE = import.meta.env.VITE_API_URL || '';

export interface MachineService {
  name: string;
  port?: number;
  type?: string;
  needs_cn_ip?: boolean;
  internal?: boolean;
  description?: string;
}

export interface MachineDeprecated {
  name: string;
  reason?: string;
}

export interface MachineConflict {
  service: string;
  type: 'ip_mismatch' | 'deprecated';
  message: string;
  severity: 'error' | 'warning';
}

export interface MachineMetadata {
  hardware?: string;
  os?: string;
  tailscale_name?: string;
  tailscale_ip?: string;
  public_ip?: string;
  ssh_alias?: string;
  ssh_user?: string;
  exit_node?: string | null;
  exit_node_ip?: string | null;
  effective_country?: string;
  offers_exit_node?: boolean;
  socks_proxy?: string;
  ssh_tunnels?: string[];
  role?: string;
  tags?: string[];
  accounts?: string[];
  services: MachineService[];
  deprecated: MachineDeprecated[];
  notes?: string;
}

export interface Machine {
  id: string;
  name: string;
  description: string;
  status: string;
  metadata: MachineMetadata;
  tailscale_online: boolean;
  tailscale_last_seen: string | null;
  conflicts: MachineConflict[];
  updated_at: string;
}

export const machinesApi = {
  async list(): Promise<Machine[]> {
    const res = await fetch(`${API_BASE}/api/brain/machines`);
    if (!res.ok) throw new Error(`Failed to fetch machines: ${res.status}`);
    return res.json();
  },

  async get(name: string): Promise<Machine> {
    const res = await fetch(`${API_BASE}/api/brain/machines/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Failed to fetch machine ${name}: ${res.status}`);
    return res.json();
  },

  async patch(name: string, metadata: Partial<MachineMetadata>): Promise<Machine> {
    const res = await fetch(`${API_BASE}/api/brain/machines/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata }),
    });
    if (!res.ok) throw new Error(`Failed to update machine ${name}: ${res.status}`);
    return res.json();
  },
};
