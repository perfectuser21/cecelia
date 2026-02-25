/**
 * Historical Drop-off Analysis
 * Combines cohort, funnel, and drop-off detection analysis
 */

import { cohortAnalyzer } from './cohort-analyzer.js';
import { funnelAnalyzer } from './funnel-analyzer.js';
import { dropoffDetector } from './dropoff-detector.js';
import type {
  CohortData,
  FunnelStep,
  DropoffMoment,
  CohortAnalysisRequest,
  FunnelAnalysisRequest,
  DropoffAnalysisRequest,
} from './types.js';

export class HistoricalDropoffAnalyzer {
  /**
   * Perform complete historical drop-off analysis
   */
  async analyzeAll(startDate?: string, endDate?: string) {
    const [cohorts, funnel, dropoffs] = await Promise.all([
      this.analyzeCohorts({ startDate, endDate }),
      this.analyzeFunnel({ startDate, endDate }),
      this.analyzeDropoffs({ startDate, endDate }),
    ]);

    return {
      cohorts,
      funnel,
      dropoffs,
      summary: {
        totalCohorts: cohorts.length,
        totalUsersAnalyzed: cohorts.reduce((sum, c) => sum + c.totalUsers, 0),
        highRiskUsers: dropoffs.filter((d) => d.riskScore > 0.7).length,
        criticalDropoffSteps: funnel
          .filter((s) => s.dropoffRate > 0.3)
          .map((s) => s.step),
      },
    };
  }

  /**
   * Analyze user cohorts and retention
   */
  async analyzeCohorts(req: CohortAnalysisRequest): Promise<CohortData[]> {
    return cohortAnalyzer.analyze(req.startDate, req.endDate, req.groupBy);
  }

  /**
   * Analyze user funnel
   */
  async analyzeFunnel(req: FunnelAnalysisRequest): Promise<FunnelStep[]> {
    return funnelAnalyzer.analyze(req.startDate, req.endDate);
  }

  /**
   * Detect drop-off moments
   */
  async analyzeDropoffs(req: DropoffAnalysisRequest): Promise<DropoffMoment[]> {
    return dropoffDetector.analyze(
      req.startDate,
      req.endDate,
      req.minRiskScore
    );
  }
}

export const historicalDropoffAnalyzer = new HistoricalDropoffAnalyzer();
