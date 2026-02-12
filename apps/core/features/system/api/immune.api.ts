/**
 * Immune System API Client
 *
 * 免疫系统 API 客户端 - 与 Brain API (localhost:5221) 通信
 */

import type {
  ApiResponse,
  DashboardData,
  FailureSignature,
  Policy,
  PolicyEvaluation,
  PolicyFilters,
  SignatureDetail,
  SignatureFilters,
} from '../types/immune';

const API_BASE = import.meta.env.VITE_API_URL || '';
const BRAIN_API_URL = '/api/brain';

/**
 * Handle API response and extract data
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  const json: ApiResponse<T> = await response.json();

  if (!json.success) {
    throw new Error(json.error || json.details || 'Unknown API error');
  }

  if (!json.data) {
    throw new Error('API returned success but no data');
  }

  return json.data;
}

/**
 * Build query string from params
 */
function buildQuery(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }

  return searchParams.toString();
}

// ============ Dashboard API ============

/**
 * Get dashboard overview data
 *
 * GET /api/brain/immune/dashboard
 */
export async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch(`${BRAIN_API_URL}/immune/dashboard`);
  return handleResponse<DashboardData>(response);
}

// ============ Policies API ============

/**
 * Get policies list with optional filters
 *
 * GET /api/brain/policies?status=active&limit=50&offset=0
 */
export async function fetchPolicies(filters?: PolicyFilters): Promise<Policy[]> {
  const query = filters ? buildQuery(filters) : '';
  const url = `${BRAIN_API_URL}/policies${query ? `?${query}` : ''}`;

  const response = await fetch(url);
  return handleResponse<Policy[]>(response);
}

/**
 * Get single policy by ID
 *
 * GET /api/brain/policies/:id
 */
export async function fetchPolicy(policyId: number): Promise<Policy> {
  const response = await fetch(`${BRAIN_API_URL}/policies/${policyId}`);
  return handleResponse<Policy>(response);
}

/**
 * Get policy evaluations (最近 N 次评估)
 *
 * GET /api/brain/policies/:id/evaluations?limit=100&offset=0
 */
export async function fetchPolicyEvaluations(
  policyId: number,
  limit = 10,
  offset = 0
): Promise<PolicyEvaluation[]> {
  const query = buildQuery({ limit, offset });
  const url = `${BRAIN_API_URL}/policies/${policyId}/evaluations?${query}`;

  const response = await fetch(url);
  return handleResponse<PolicyEvaluation[]>(response);
}

/**
 * Update policy status (禁用策略)
 *
 * PATCH /api/brain/policies/:id/status
 *
 * @param policyId - Policy ID
 * @param status - New status ('active' | 'disabled')
 * @param reason - Optional reason for status change
 */
export async function updatePolicyStatus(
  policyId: number,
  status: 'active' | 'disabled',
  reason?: string
): Promise<void> {
  const response = await fetch(`${BRAIN_API_URL}/policies/${policyId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status, reason }),
  });

  await handleResponse<void>(response);
}

// ============ Failures & Signatures API ============

/**
 * Get failure signatures list
 *
 * GET /api/brain/failures/signatures?limit=20&min_count=5
 */
export async function fetchSignatures(filters?: SignatureFilters): Promise<FailureSignature[]> {
  const query = filters ? buildQuery(filters) : '';
  const url = `${BRAIN_API_URL}/failures/signatures${query ? `?${query}` : ''}`;

  const response = await fetch(url);
  return handleResponse<FailureSignature[]>(response);
}

/**
 * Get single signature detail with related policies
 *
 * GET /api/brain/failures/signatures/:signature
 */
export async function fetchSignature(signature: string): Promise<SignatureDetail> {
  // URL encode the signature (may contain special characters)
  const encodedSignature = encodeURIComponent(signature);
  const response = await fetch(`${BRAIN_API_URL}/failures/signatures/${encodedSignature}`);
  return handleResponse<SignatureDetail>(response);
}

// ============ Promotions API ============

/**
 * Get policy promotion history
 *
 * GET /api/brain/policies/promotions?limit=10
 */
export interface PolicyPromotion {
  policy_id: number;
  signature: string;
  promoted_at: string;
  simulations: number;
  pass_rate: number;
  risk_level: 'low' | 'medium' | 'high';
}

export async function fetchPromotions(limit = 10): Promise<PolicyPromotion[]> {
  const query = buildQuery({ limit });
  const response = await fetch(`${BRAIN_API_URL}/policies/promotions?${query}`);
  return handleResponse<PolicyPromotion[]>(response);
}

// ============ Export all API functions ============

export const immuneApi = {
  // Dashboard
  fetchDashboard,

  // Policies
  fetchPolicies,
  fetchPolicy,
  fetchPolicyEvaluations,
  updatePolicyStatus,

  // Signatures
  fetchSignatures,
  fetchSignature,

  // Promotions
  fetchPromotions,
};
