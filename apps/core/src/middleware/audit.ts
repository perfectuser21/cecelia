/**
 * Audit Middleware
 *
 * Logs all /api/* requests to the audit_log table for auditing.
 * Records: timestamp, path, method, response_status
 */

import { Request, Response, NextFunction } from 'express';
// @ts-ignore - db.js is JavaScript without types
import pool from '../task-system/db.js';

// Configuration
const ENABLE_AUDIT = process.env.ENABLE_AUDIT !== 'false'; // Default enabled
const EXCLUDED_PATHS = [
  '/api/system/health',
  '/api/panorama/vitals',
  '/api/health',
];

interface AuditEntry {
  timestamp: string;
  path: string;
  method: string;
  status: number;
  duration_ms: number;
  user_agent?: string;
}

/**
 * Log audit entry to database
 */
async function logAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (timestamp, path, method, status, duration_ms, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.timestamp, entry.path, entry.method, entry.status, entry.duration_ms, entry.user_agent]
    );
  } catch (error) {
    // Don't fail the request if audit logging fails
    console.error('[Audit] Failed to log:', error instanceof Error ? error.message : error);
  }
}

/**
 * Audit middleware function
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip if disabled
  if (!ENABLE_AUDIT) {
    return next();
  }

  // Skip excluded paths
  if (EXCLUDED_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Skip non-API paths
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const startTime = Date.now();

  // Capture response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      status: res.statusCode,
      duration_ms: duration,
      user_agent: req.get('user-agent'),
    };

    // Log asynchronously (don't block response)
    logAuditEntry(entry).catch(() => {
      // Silently ignore errors
    });
  });

  next();
}

/**
 * Initialize audit_log table if not exists
 */
export async function initAuditTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        path VARCHAR(512) NOT NULL,
        method VARCHAR(10) NOT NULL,
        status INTEGER NOT NULL,
        duration_ms INTEGER,
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create index for timestamp queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp DESC)
    `);

    console.log('[Audit] Table initialized');
  } catch (error) {
    console.error('[Audit] Failed to initialize table:', error instanceof Error ? error.message : error);
  }
}

export default auditMiddleware;
