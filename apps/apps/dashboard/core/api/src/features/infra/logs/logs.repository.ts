// Log repository for database operations
import { db } from '../../../shared/db/connection';
import { Log, CreateLogDTO } from './logs.types';

class LogRepository {
  async create(data: CreateLogDTO): Promise<Log> {
    const result = await db.query<Log>(
      `INSERT INTO logs (
        user_id, action, resource_type, resource_id,
        details, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        data.user_id || null,
        data.action,
        data.resource_type || null,
        data.resource_id || null,
        data.details ? JSON.stringify(data.details) : null,
        data.ip_address || null,
        data.user_agent || null,
      ]
    );
    return result.rows[0];
  }

  async findRecent(limit: number = 100): Promise<Log[]> {
    const result = await db.query<Log>(
      'SELECT * FROM logs ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }

  async findByAction(action: string, limit: number = 100): Promise<Log[]> {
    const result = await db.query<Log>(
      'SELECT * FROM logs WHERE action = $1 ORDER BY created_at DESC LIMIT $2',
      [action, limit]
    );
    return result.rows;
  }

  async findByResource(
    resourceType: string,
    resourceId: number,
    limit: number = 100
  ): Promise<Log[]> {
    const result = await db.query<Log>(
      `SELECT * FROM logs
       WHERE resource_type = $1 AND resource_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [resourceType, resourceId, limit]
    );
    return result.rows;
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    limit: number = 1000
  ): Promise<Log[]> {
    const result = await db.query<Log>(
      `SELECT * FROM logs
       WHERE created_at >= $1 AND created_at <= $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [startDate, endDate, limit]
    );
    return result.rows;
  }

  async deleteOldLogs(daysToKeep: number = 90): Promise<number> {
    const result = await db.query(
      `DELETE FROM logs
       WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${daysToKeep} days'`
    );
    return result.rowCount || 0;
  }
}

export const logsRepository = new LogRepository();
