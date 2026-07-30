#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';

const { Pool } = pg;

export function classifyKernelRunIdentity(
  duplicateActiveRows = [],
  identityGapRows = [],
) {
  const duplicateActiveTasks = duplicateActiveRows
    .map((row) => String(row.current_task_id))
    .sort();
  const duplicateActiveRuns = duplicateActiveRows
    .map((row) => ({
      taskId: String(row.current_task_id),
      activeCount: Number(row.active_count),
      runIds: (row.run_ids ?? []).map(String).sort(),
    }))
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
  const historicalUntrustedRunIds = identityGapRows
    .filter((row) => row.current_task_id == null || row.created_source == null)
    .map((row) => String(row.id))
    .sort();

  return {
    ok: duplicateActiveTasks.length === 0,
    duplicateActiveTasks,
    duplicateActiveRuns,
    historicalUntrustedRunIds,
    counts: {
      duplicateActiveTasks: duplicateActiveTasks.length,
      historicalUntrustedRuns: historicalUntrustedRunIds.length,
    },
  };
}

export async function loadKernelRunIdentityReport(db) {
  const { rows: duplicateRows } = await db.query(
    `SELECT current_task_id,
            COUNT(*)::int AS active_count,
            array_agg(id ORDER BY started_at, id) AS run_ids
       FROM initiative_runs
      WHERE orchestrator_version = 'v2'
        AND current_task_id IS NOT NULL
        AND phase NOT IN ('done', 'failed')
      GROUP BY current_task_id
     HAVING COUNT(*) > 1
      ORDER BY current_task_id`,
  );
  const { rows: columnRows } = await db.query(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'initiative_runs'
          AND column_name = 'created_source'
     ) AS exists`,
  );
  const createdSourceColumn = columnRows[0]?.exists === true;
  const createdSourceProjection = createdSourceColumn
    ? 'created_source'
    : 'NULL::text AS created_source';
  const identityGapPredicate = createdSourceColumn
    ? '(current_task_id IS NULL OR created_source IS NULL)'
    : '( TRUE )';
  const { rows: identityRows } = await db.query(
    `SELECT id, initiative_id, current_task_id, phase,
            ${createdSourceProjection}, started_at, completed_at
      FROM initiative_runs
      WHERE orchestrator_version = 'v2'
        AND ${identityGapPredicate}
      ORDER BY started_at, id`,
  );

  return {
    ...classifyKernelRunIdentity(duplicateRows, identityRows),
    schema: { createdSourceColumn },
  };
}

export async function runKernelRunIdentityPreflight({
  pool = new Pool(DB_DEFAULTS),
  output = console.log,
} = {}) {
  try {
    const report = await loadKernelRunIdentityReport(pool);
    output(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 2;
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  runKernelRunIdentityPreflight()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: error.message,
      }));
      process.exitCode = 1;
    });
}
