/**
 * Funnel Analysis - Identify drop-off points in user journey
 */

import pool from '../task-system/db.js';
import type { FunnelStep } from './types.js';

export class FunnelAnalyzer {
  /**
   * Analyze user funnel and identify drop-off rates
   * @param startDate - Start date for analysis (ISO string)
   * @param endDate - End date for analysis (ISO string)
   */
  async analyze(startDate?: string, endDate?: string): Promise<FunnelStep[]> {
    const query = `
      WITH user_funnel AS (
        SELECT
          u.id as user_id,
          u.created_at,
          CASE WHEN EXISTS (
            SELECT 1 FROM user_activities ua
            WHERE ua.user_id = u.id
            AND ua.activity_type = 'activation'
            LIMIT 1
          ) THEN 1 ELSE 0 END as activated,
          CASE WHEN EXISTS (
            SELECT 1 FROM user_activities ua
            WHERE ua.user_id = u.id
            AND ua.created_at >= u.created_at + interval '7 days'
            LIMIT 1
          ) THEN 1 ELSE 0 END as retained_week1,
          CASE WHEN EXISTS (
            SELECT 1 FROM user_activities ua
            WHERE ua.user_id = u.id
            AND ua.created_at >= u.created_at + interval '14 days'
            LIMIT 1
          ) THEN 1 ELSE 0 END as retained_week2
        FROM users u
        WHERE ($1::timestamp IS NULL OR u.created_at >= $1)
          AND ($2::timestamp IS NULL OR u.created_at <= $2)
      )
      SELECT
        COUNT(*) as total_signups,
        SUM(activated) as total_activated,
        SUM(retained_week1) as total_retained_week1,
        SUM(retained_week2) as total_retained_week2
      FROM user_funnel;
    `;

    const result = await pool.query(query, [startDate || null, endDate || null]);
    const row = result.rows[0];

    const totalSignups = parseInt(row.total_signups, 10);
    const totalActivated = parseInt(row.total_activated, 10);
    const totalRetainedWeek1 = parseInt(row.total_retained_week1, 10);
    const totalRetainedWeek2 = parseInt(row.total_retained_week2, 10);

    const steps: FunnelStep[] = [
      {
        step: 'signup',
        users: totalSignups,
        dropoffRate: 0, // First step has no drop-off
      },
      {
        step: 'activation',
        users: totalActivated,
        dropoffRate: totalSignups > 0 ? 1 - totalActivated / totalSignups : 0,
      },
      {
        step: 'week1_retention',
        users: totalRetainedWeek1,
        dropoffRate: totalActivated > 0 ? 1 - totalRetainedWeek1 / totalActivated : 0,
      },
      {
        step: 'week2_retention',
        users: totalRetainedWeek2,
        dropoffRate: totalRetainedWeek1 > 0 ? 1 - totalRetainedWeek2 / totalRetainedWeek1 : 0,
      },
    ];

    return steps;
  }
}

export const funnelAnalyzer = new FunnelAnalyzer();
