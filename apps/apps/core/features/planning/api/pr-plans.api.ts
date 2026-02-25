/**
 * PR Plans API - Three-layer decomposition (Objective → KR → Initiative → PR Plans → Tasks)
 */

const BRAIN_API_URL = 'http://localhost:5221/api/brain';

export interface PRPlan {
  id: string;
  initiative_id: string;
  project_id: string;
  title: string;
  dod: string;  // Definition of Done
  files: string[];  // Related files
  sequence: number;  // Execution order
  depends_on: string[];  // Dependent PR Plan IDs
  complexity: 'small' | 'medium' | 'large';
  status: 'planning' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
  // Derived fields (not in DB)
  tasks_count?: number;
  tasks_completed?: number;
}

export interface Initiative {
  id: string;
  title: string;
  description: string | null;
  status: string;
  goal_id: string | null;  // Linked KR
  created_at: string;
  updated_at: string;
  pr_plans?: PRPlan[];
}

export interface PRPlansResponse {
  success: boolean;
  pr_plans: PRPlan[];
  count: number;
}

export interface PRPlanResponse {
  success: boolean;
  pr_plan: PRPlan;
}

export interface InitiativeResponse {
  success: boolean;
  initiative: Initiative;
}

export interface InitiativesResponse {
  success: boolean;
  initiatives: Initiative[];
  count: number;
}

/**
 * Get all PR Plans, optionally filtered by initiative
 */
export async function getPRPlans(initiativeId?: string): Promise<PRPlan[]> {
  try {
    const url = initiativeId
      ? `${BRAIN_API_URL}/pr-plans?initiative_id=${initiativeId}`
      : `${BRAIN_API_URL}/pr-plans`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch PR Plans: ${response.statusText}`);
    }

    const data: PRPlansResponse = await response.json();
    return data.pr_plans || [];
  } catch (error) {
    console.error('Error fetching PR Plans:', error);
    throw error;
  }
}

/**
 * Get a single PR Plan by ID
 */
export async function getPRPlan(id: string): Promise<PRPlan> {
  try {
    const response = await fetch(`${BRAIN_API_URL}/pr-plans/${id}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch PR Plan: ${response.statusText}`);
    }

    const data: PRPlanResponse = await response.json();
    return data.pr_plan;
  } catch (error) {
    console.error('Error fetching PR Plan:', error);
    throw error;
  }
}

/**
 * Get all Initiatives
 */
export async function getInitiatives(): Promise<Initiative[]> {
  try {
    const response = await fetch(`${BRAIN_API_URL}/initiatives`);

    if (!response.ok) {
      throw new Error(`Failed to fetch Initiatives: ${response.statusText}`);
    }

    const data: InitiativesResponse = await response.json();
    return data.initiatives || [];
  } catch (error) {
    console.error('Error fetching Initiatives:', error);
    throw error;
  }
}

/**
 * Get a single Initiative by ID
 */
export async function getInitiative(id: string): Promise<Initiative> {
  try {
    const response = await fetch(`${BRAIN_API_URL}/initiatives/${id}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch Initiative: ${response.statusText}`);
    }

    const data: InitiativeResponse = await response.json();
    return data.initiative;
  } catch (error) {
    console.error('Error fetching Initiative:', error);
    throw error;
  }
}

/**
 * Check if a PR Plan is blocked by dependencies
 */
export function isPRPlanBlocked(prPlan: PRPlan, allPRPlans: PRPlan[]): boolean {
  if (!prPlan.depends_on || prPlan.depends_on.length === 0) {
    return false;
  }

  // Check if any dependency is not completed
  for (const depId of prPlan.depends_on) {
    const depPlan = allPRPlans.find(p => p.id === depId);
    if (!depPlan || depPlan.status !== 'completed') {
      return true;
    }
  }

  return false;
}

/**
 * Get dependency chain for a PR Plan
 */
export function getDependencyChain(prPlan: PRPlan, allPRPlans: PRPlan[]): PRPlan[] {
  const chain: PRPlan[] = [];

  if (!prPlan.depends_on || prPlan.depends_on.length === 0) {
    return chain;
  }

  for (const depId of prPlan.depends_on) {
    const depPlan = allPRPlans.find(p => p.id === depId);
    if (depPlan) {
      chain.push(depPlan);
      // Recursively get dependencies
      chain.push(...getDependencyChain(depPlan, allPRPlans));
    }
  }

  return chain;
}

/**
 * Update PR Plan status
 */
export async function updatePRPlanStatus(
  id: string,
  status: PRPlan['status'],
  allPRPlans?: PRPlan[]
): Promise<PRPlan> {
  try {
    // Client-side validation (if allPRPlans provided)
    if (allPRPlans) {
      const prPlan = allPRPlans.find(p => p.id === id);
      if (!prPlan) {
        throw new Error('PR Plan not found');
      }

      // Validate status transition
      if (!isValidStatusTransition(prPlan.status, status)) {
        throw new Error(`Invalid status transition: ${prPlan.status} → ${status}`);
      }

      // Check if dependencies are met for in_progress
      if (status === 'in_progress' && isPRPlanBlocked(prPlan, allPRPlans)) {
        throw new Error('Cannot start PR Plan: dependencies not completed');
      }
    }

    const response = await fetch(`${BRAIN_API_URL}/pr-plans/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to update PR Plan: ${response.statusText}`);
    }

    const data: PRPlanResponse = await response.json();
    return data.pr_plan;
  } catch (error) {
    console.error('Error updating PR Plan status:', error);
    throw error;
  }
}

/**
 * Validate status transition
 */
export function isValidStatusTransition(
  currentStatus: PRPlan['status'],
  newStatus: PRPlan['status']
): boolean {
  // Allow same status (no change)
  if (currentStatus === newStatus) {
    return true;
  }

  // Define valid transitions
  const validTransitions: Record<PRPlan['status'], PRPlan['status'][]> = {
    planning: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'planning', 'cancelled'],
    completed: ['in_progress'], // Allow reopening
    cancelled: ['planning'], // Allow un-cancelling
  };

  return validTransitions[currentStatus]?.includes(newStatus) || false;
}
