/**
 * Cohort Analysis - Group users by signup date and track retention
 */

import pool from '../task-system/db.js';
import type { CohortData, RetentionPoint } from './types.js';

export class CohortAnalyzer {
  /**
   * Analyze user cohorts and retention rates
   * @param startDate - Start date for cohort analysis (ISO string)
   * @param endDate - End date for cohort analysis (ISO string)
   * @param groupBy - Group by 'week' or 'month'
   */
  async analyze(
    startDate?: string,
    endDate?: string,
    groupBy: 'week' | 'month' = 'week'
  ): Promise<CohortData[]> {
    const dateFormat = groupBy === 'week' ? 'IYYY-"W"IW' : 'YYYY-MM';
    const truncateUnit = groupBy === 'week' ? 'week' : 'month';

    const query = `
      WITH cohorts AS (
        SELECT
          to_char(date_trunc('${truncateUnit}', created_at), '${dateFormat}') as cohort,
          id as user_id,
          created_at as signup_date
        FROM users
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
      ),
      user_activities AS (
        SELECT
          user_id,
          MAX(created_at) as last_activity
        FROM user_activities
        GROUP BY user_id
      ),
      cohort_retention AS (
        SELECT
          c.cohort,
          c.user_id,
          EXTRACT(EPOCH FROM (COALESCE(ua.last_activity, c.signup_date) - c.signup_date)) / (7 * 24 * 3600) as weeks_active
        FROM cohorts c
        LEFT JOIN user_activities ua ON c.user_id = ua.user_id
      )
      SELECT
        cohort,
        COUNT(DISTINCT user_id) as total_users,
        jsonb_agg(
          jsonb_build_object(
            'week', FLOOR(weeks_active)::integer,
            'retained', COUNT(DISTINCT user_id)
          ) ORDER BY FLOOR(weeks_active)
        ) as retention_data
      FROM cohort_retention
      GROUP BY cohort
      ORDER BY cohort;
    `;

    const result = await pool.query(query, [startDate || null, endDate || null]);

    return result.rows.map((row: any) => {
      const retentionByWeek: RetentionPoint[] = [];
      const totalUsers = parseInt(row.total_users, 10);

      // Aggregate retention data by week
      const weekMap = new Map<number, number>();
      for (const item of row.retention_data) {
        const week = item.week;
        const count = weekMap.get(week) || 0;
        weekMap.set(week, count + item.retained);
      }

      // Convert to sorted array with rates
      const weeks = Array.from(weekMap.keys()).sort((a, b) => a - b);
      for (const week of weeks) {
        const retained = weekMap.get(week) || 0;
        retentionByWeek.push({
          week,
          retained,
          rate: totalUsers > 0 ? retained / totalUsers : 0,
        });
      }

      return {
        cohort: row.cohort,
        totalUsers,
        retentionByWeek,
      };
    });
  }
}

export const cohortAnalyzer = new CohortAnalyzer();
