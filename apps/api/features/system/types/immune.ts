/**
 * Immune System Frontend Types
 *
 * 免疫系统前端类型定义
 * 对应 Brain API 的数据结构
 */

export type PolicyStatus = 'draft' | 'probation' | 'active' | 'disabled';
export type RiskLevel = 'low' | 'medium' | 'high';
export type EvaluationMode = 'simulate' | 'apply' | 'promote';
export type EvaluationResult = 'would_succeed' | 'would_fail' | 'success' | 'failure';

/**
 * Absorption Policy
 *
 * 吸收策略 - 定义如何处理失败任务
 */
export interface Policy {
  policy_id: number;
  signature: string;
  status: PolicyStatus;
  policy_json: {
    action: string;  // 'requeue' | 'escalate' | 'ignore' | 'delay'
    params: Record<string, any>;
    reason?: string;
  };
  risk_level: RiskLevel;
  success_count: number;
  failure_count: number;
  created_at: string;  // ISO 8601
  promoted_at: string | null;  // ISO 8601 or null
}

/**
 * Policy Evaluation
 *
 * 策略评估记录 - 每次策略应用/模拟的结果
 */
export interface PolicyEvaluation {
  eval_id: number;
  policy_id: number;
  task_id: string;
  mode: EvaluationMode;
  result: EvaluationResult;
  evaluated_at: string;  // ISO 8601
  details?: Record<string, any>;
}

/**
 * Failure Signature
 *
 * 失败签名 - 失败任务的标识符和统计信息
 */
export interface FailureSignature {
  signature: string;
  count: number;
  first_seen: string;  // ISO 8601
  last_seen: string;   // ISO 8601
  active_policies: number;
  probation_policies: number;
}

/**
 * Dashboard Data
 *
 * Dashboard 页面的汇总数据
 */
export interface DashboardData {
  policies: {
    draft: number;
    probation: number;
    active: number;
    disabled: number;
    total: number;
  };
  quarantine: {
    total: number;
    by_reason: {
      failure_threshold: number;
      manual: number;
      resource_hog: number;
    };
  };
  failures: {
    top_signatures: Array<{
      signature: string;
      count: number;
    }>;
  };
  recent_promotions: Array<{
    policy_id: number;
    signature: string;
    promoted_at: string;  // ISO 8601
    simulations: number;
    pass_rate: number;  // 0-1
    risk_level: RiskLevel;
  }>;
}

/**
 * Signature Detail
 *
 * 签名详情页数据 - 包含关联的策略
 */
export interface SignatureDetail extends FailureSignature {
  policies: Policy[];
}

/**
 * API Response Wrapper
 *
 * 统一的 API 响应格式
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
}

/**
 * Pagination Parameters
 *
 * 分页参数
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Policy List Filters
 *
 * 策略列表过滤参数
 */
export interface PolicyFilters extends PaginationParams {
  status?: PolicyStatus;
}

/**
 * Signature List Filters
 *
 * 签名列表过滤参数
 */
export interface SignatureFilters extends PaginationParams {
  min_count?: number;
}
