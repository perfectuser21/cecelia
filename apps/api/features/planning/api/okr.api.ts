/**
 * OKR API - Single-layer Area OKR architecture
 */

export interface KeyResult {
  id: string;
  goal_id: string;
  title: string;
  description: string | null;
  target_value: number;
  current_value: number;
  unit: string | null;
  status: 'on_track' | 'at_risk' | 'behind';
  priority: string;
  expected_completion_date: string | null;
  created_at: string;
  updated_at: string;
  projects?: Array<{
    id: string;
    name: string;
  }>;
}

export interface Objective {
  id: string;
  business_id: string;
  title: string;
  description: string | null;
  quarter: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  key_results?: KeyResult[];
}

export interface Area {
  id: string;
  name: string;
  objectives_count: number;
  avg_progress: number;
}

export interface AreaDetail {
  area: {
    id: string;
    name: string;
    created_at: string;
  };
  objectives: Objective[];
}

/**
 * Get all Areas with OKR statistics
 */
export async function fetchAreas(quarter?: string): Promise<Area[]> {
  const url = quarter ? `/api/okr/areas?quarter=${encodeURIComponent(quarter)}` : '/api/okr/areas';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch areas');
  }
  return response.json();
}

/**
 * Get complete OKR for a specific Area
 */
export async function fetchAreaOKR(areaId: string, quarter?: string): Promise<AreaDetail> {
  const url = quarter
    ? `/api/okr/areas/${areaId}?quarter=${encodeURIComponent(quarter)}`
    : `/api/okr/areas/${areaId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch area OKR');
  }
  return response.json();
}

/**
 * Get a single Objective with Key Results
 */
export async function fetchObjective(id: string): Promise<Objective> {
  const response = await fetch(`/api/okr/objectives/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch objective');
  }
  return response.json();
}

/**
 * Get a single Key Result with contributing Projects
 */
export async function fetchKeyResult(id: string): Promise<KeyResult> {
  const response = await fetch(`/api/okr/key-results/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch key result');
  }
  return response.json();
}

/**
 * Create a new Objective
 */
export async function createObjective(data: {
  business_id: string;
  title: string;
  description?: string;
  quarter?: string;
  status?: string;
  priority?: string;
}): Promise<Objective> {
  const response = await fetch('/api/okr/objectives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create objective');
  }
  return response.json();
}

/**
 * Create a new Key Result
 */
export async function createKeyResult(data: {
  goal_id: string;
  title: string;
  target_value: number;
  description?: string;
  current_value?: number;
  unit?: string;
  status?: string;
  priority?: string;
  expected_completion_date?: string;
}): Promise<KeyResult> {
  const response = await fetch('/api/okr/key-results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create key result');
  }
  return response.json();
}

/**
 * Update a Key Result
 */
export async function updateKeyResult(
  id: string,
  data: Partial<Omit<KeyResult, 'id' | 'goal_id' | 'created_at' | 'updated_at' | 'projects'>>
): Promise<KeyResult> {
  const response = await fetch(`/api/okr/key-results/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update key result');
  }
  return response.json();
}
