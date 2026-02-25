/**
 * Analysis types for user drop-off analysis
 */

export interface CohortData {
  cohort: string; // '2026-W07' for weekly, '2026-02' for monthly
  totalUsers: number;
  retentionByWeek: RetentionPoint[];
}

export interface RetentionPoint {
  week: number; // 0 = registration week, 1 = week 1, etc.
  retained: number;
  rate: number; // 0-1
}

export interface FunnelStep {
  step: string;
  users: number;
  dropoffRate: number; // 0-1
}

export interface DropoffMoment {
  userId: string;
  lastActivity: Date;
  daysSinceSignup: number;
  preDropoffActions: string[];
  riskScore: number; // 0-1, higher = more likely to churn
}

export interface CohortAnalysisRequest {
  startDate?: string; // ISO date
  endDate?: string;
  groupBy?: 'week' | 'month';
}

export interface FunnelAnalysisRequest {
  startDate?: string;
  endDate?: string;
}

export interface DropoffAnalysisRequest {
  startDate?: string;
  endDate?: string;
  minRiskScore?: number;
}
