/**
 * Drop-off Detector - Identify users at risk of churning
 */

import pool from '../task-system/db.js';
import type { DropoffMoment } from './types.js';

export class DropoffDetector {
  /**
   * Detect users who have dropped off or are at risk
   * @param startDate - Start date for analysis (ISO string)
   * @param endDate - End date for analysis (ISO string)
   * @param minRiskScore - Minimum risk score to include (0-1)
   */
  async analyze(
    startDate?: string,
    endDate?: string,
    minRiskScore: number = 0.5
  ): Promise<DropoffMoment[]> {
    const query = `
      WITH user_last_activity AS (
        SELECT
          u.id as user_id,
          u.created_at as signup_date,
          MAX(ua.created_at) as last_activity,
          EXTRACT(EPOCH FROM (NOW() - MAX(ua.created_at))) / (24 * 3600) as days_since_last_activity,
          EXTRACT(EPOCH FROM (MAX(ua.created_at) - u.created_at)) / (24 * 3600) as days_since_signup,
          jsonb_agg(
            jsonb_build_object(
              'activity_type', ua.activity_type,
              'created_at', ua.created_at
            ) ORDER BY ua.created_at DESC
          ) FILTER (WHERE ua.created_at >= MAX(ua.created_at) - interval '7 days') as recent_actions
        FROM users u
        LEFT JOIN user_activities ua ON u.id = ua.user_id
        WHERE ($1::timestamp IS NULL OR u.created_at >= $1)
          AND ($2::timestamp IS NULL OR u.created_at <= $2)
        GROUP BY u.id, u.created_at
      )
      SELECT
        user_id,
        last_activity,
        days_since_signup,
        recent_actions,
        CASE
          WHEN days_since_last_activity > 14 THEN 0.9
          WHEN days_since_last_activity > 7 THEN 0.7
          WHEN days_since_last_activity > 3 THEN 0.5
          ELSE 0.3
        END as risk_score
      FROM user_last_activity
      WHERE days_since_last_activity IS NOT NULL
        AND days_since_signup > 7
      HAVING CASE
          WHEN days_since_last_activity > 14 THEN 0.9
          WHEN days_since_last_activity > 7 THEN 0.7
          WHEN days_since_last_activity > 3 THEN 0.5
          ELSE 0.3
        END >= $3
      ORDER BY risk_score DESC, last_activity DESC;
    `;

    const result = await pool.query(query, [
      startDate || null,
      endDate || null,
      minRiskScore,
    ]);

    return result.rows.map((row: any) => {
      const preDropoffActions: string[] = [];
      if (row.recent_actions) {
        for (const action of row.recent_actions) {
          preDropoffActions.push(action.activity_type);
        }
      }

      return {
        userId: row.user_id,
        lastActivity: new Date(row.last_activity),
        daysSinceSignup: Math.floor(parseFloat(row.days_since_signup)),
        preDropoffActions,
        riskScore: parseFloat(row.risk_score),
      };
    });
  }
}

export const dropoffDetector = new DropoffDetector();
