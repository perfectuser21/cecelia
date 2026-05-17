/**
 * Structured Memory Schema - Phase 5.1
 *
 * Three-layer memory model:
 * - episodic: Event records (who did what when)
 * - working: Current task context, temporary state
 * - longterm: Preferences, lessons, patterns
 */

import pool from '../task-system/db.js';

// Valid layers
export const MEMORY_LAYERS = ['episodic', 'working', 'longterm'] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

// Valid categories per layer
export const CATEGORY_MAP: Record<MemoryLayer, string[]> = {
  episodic: ['event', 'decision'],
  working: ['context', 'state'],
  longterm: ['preference', 'lesson', 'pattern'],
};

// All valid categories
export const VALID_CATEGORIES = Object.values(CATEGORY_MAP).flat();

// Memory entry interface
export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  category: string;
  key: string;
  value: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  expires_at?: Date;
  task_id?: string;
  session_id?: string;
  source: string;
  confidence?: number;
}

// Validation result
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate memory entry data
 */
export function validateMemoryEntry(data: {
  layer?: string;
  category?: string;
  key?: string;
  value?: unknown;
  source?: string;
}): ValidationResult {
  const errors: string[] = [];

  // Check layer
  if (!data.layer) {
    errors.push('layer is required');
  } else if (!MEMORY_LAYERS.includes(data.layer as MemoryLayer)) {
    errors.push(`invalid layer: ${data.layer}. Must be one of: ${MEMORY_LAYERS.join(', ')}`);
  }

  // Check category
  if (!data.category) {
    errors.push('category is required');
  } else if (!VALID_CATEGORIES.includes(data.category)) {
    errors.push(`invalid category: ${data.category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  // Check category belongs to layer
  if (data.layer && data.category && MEMORY_LAYERS.includes(data.layer as MemoryLayer)) {
    const allowedCategories = CATEGORY_MAP[data.layer as MemoryLayer];
    if (!allowedCategories.includes(data.category)) {
      errors.push(
        `category "${data.category}" not allowed in layer "${data.layer}". ` +
          `Allowed: ${allowedCategories.join(', ')}`
      );
    }
  }

  // Check key
  if (!data.key || typeof data.key !== 'string') {
    errors.push('key is required and must be a string');
  }

  // Check value
  if (data.value === undefined || data.value === null) {
    errors.push('value is required');
  } else if (typeof data.value !== 'object') {
    errors.push('value must be an object');
  }

  // Check source (optional but if provided must be valid)
  if (data.source && !['user', 'system', 'inference'].includes(data.source)) {
    errors.push('source must be one of: user, system, inference');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Initialize memory table if not exists
 */
export async function initMemoryTable(): Promise<void> {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS memory_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      layer VARCHAR(20) NOT NULL CHECK (layer IN ('episodic', 'working', 'longterm')),
      category VARCHAR(50) NOT NULL,
      key VARCHAR(255) NOT NULL,
      value JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE,
      task_id UUID,
      session_id VARCHAR(255),
      source VARCHAR(20) DEFAULT 'system' CHECK (source IN ('user', 'system', 'inference')),
      confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
      UNIQUE (layer, key)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_layer ON memory_entries(layer);
    CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_entries(category);
    CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(key);
    CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;
  `;

  await pool.query(createTableSQL);
}

/**
 * Write memory entry (upsert)
 */
export async function writeMemory(data: {
  layer: MemoryLayer;
  category: string;
  key: string;
  value: Record<string, unknown>;
  expires_at?: string;
  task_id?: string;
  session_id?: string;
  source?: string;
  confidence?: number;
}): Promise<MemoryEntry> {
  const validation = validateMemoryEntry(data);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }

  const result = await pool.query(
    `INSERT INTO memory_entries (layer, category, key, value, expires_at, task_id, session_id, source, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (layer, key)
     DO UPDATE SET
       category = EXCLUDED.category,
       value = EXCLUDED.value,
       updated_at = NOW(),
       expires_at = EXCLUDED.expires_at,
       task_id = EXCLUDED.task_id,
       session_id = EXCLUDED.session_id,
       source = EXCLUDED.source,
       confidence = EXCLUDED.confidence
     RETURNING *`,
    [
      data.layer,
      data.category,
      data.key,
      JSON.stringify(data.value),
      data.expires_at || null,
      data.task_id || null,
      data.session_id || null,
      data.source || 'system',
      data.confidence ?? null,
    ]
  );

  return result.rows[0];
}

/**
 * Read memory entry by key
 */
export async function readMemory(key: string): Promise<MemoryEntry | null> {
  const result = await pool.query(
    `SELECT * FROM memory_entries
     WHERE key = $1
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [key]
  );

  return result.rows[0] || null;
}

/**
 * Query memory entries with filters
 */
export async function queryMemory(filters: {
  layer?: MemoryLayer;
  category?: string;
  keys?: string[];
  includeExpired?: boolean;
}): Promise<MemoryEntry[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.layer) {
    conditions.push(`layer = $${paramIndex++}`);
    params.push(filters.layer);
  }

  if (filters.category) {
    conditions.push(`category = $${paramIndex++}`);
    params.push(filters.category);
  }

  if (filters.keys && filters.keys.length > 0) {
    conditions.push(`key = ANY($${paramIndex++})`);
    params.push(filters.keys);
  }

  if (!filters.includeExpired) {
    conditions.push(`(expires_at IS NULL OR expires_at > NOW())`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT * FROM memory_entries ${whereClause} ORDER BY updated_at DESC`,
    params
  );

  return result.rows;
}

/**
 * Delete memory entry by key
 */
export async function deleteMemory(key: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM memory_entries WHERE key = $1', [key]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Clean up expired memory entries
 */
export async function cleanupExpiredMemory(): Promise<number> {
  const result = await pool.query(
    'DELETE FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at <= NOW()'
  );
  return result.rowCount ?? 0;
}

/**
 * Get memory stats
 */
export async function getMemoryStats(): Promise<{
  total: number;
  byLayer: Record<string, number>;
  byCategory: Record<string, number>;
  expired: number;
}> {
  const totalResult = await pool.query('SELECT COUNT(*) FROM memory_entries');
  const layerResult = await pool.query(
    'SELECT layer, COUNT(*) as count FROM memory_entries GROUP BY layer'
  );
  const categoryResult = await pool.query(
    'SELECT category, COUNT(*) as count FROM memory_entries GROUP BY category'
  );
  const expiredResult = await pool.query(
    'SELECT COUNT(*) FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at <= NOW()'
  );

  const byLayer: Record<string, number> = {};
  for (const row of layerResult.rows) {
    byLayer[row.layer] = parseInt(row.count, 10);
  }

  const byCategory: Record<string, number> = {};
  for (const row of categoryResult.rows) {
    byCategory[row.category] = parseInt(row.count, 10);
  }

  return {
    total: parseInt(totalResult.rows[0].count, 10),
    byLayer,
    byCategory,
    expired: parseInt(expiredResult.rows[0].count, 10),
  };
}
