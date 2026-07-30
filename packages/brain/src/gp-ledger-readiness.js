import { pathToFileURL } from 'url';

const COUNT_QUERIES = {
  positive_missing: `
    SELECT COUNT(*)::int AS count
    FROM journey_step_links
    WHERE cell_kind IS NOT NULL
      AND cell_status IN ('green','pending')
      AND assertion_ref IS NULL
      AND na_reason IS NULL
  `,
  orphan_nfr: `
    SELECT COUNT(*)::int AS count
    FROM journey_step_links cell
    WHERE cell.cell_kind='element'
      AND cell.cell_key='NFR'
      AND NOT EXISTS (
        SELECT 1
        FROM decisions decision
        WHERE decision.category='nfr'
          AND decision.level='step'
          AND decision.target_type='journey_step'
          AND decision.target_id=cell.step_id
          AND decision.status='active'
      )
  `,
  invalid_base_ref: `
    SELECT COUNT(*)::int AS count
    FROM journey_step_links cell
    LEFT JOIN journey_features feature ON feature.id=cell.feature_id
    WHERE cell.cell_kind='base_ref'
      AND (cell.feature_id IS NULL OR feature.id IS NULL)
  `,
  unknown_assertion: `
    SELECT COUNT(*)::int AS count
    FROM journey_step_links
    WHERE assertion_ref IS NOT NULL
      AND assertion_ref NOT LIKE 'manual:%'
      AND assertion_ref NOT LIKE 'eval:%'
      AND assertion_ref NOT LIKE 'decision:%'
      AND assertion_ref NOT LIKE 'tests/%'
      AND assertion_ref NOT LIKE '%/tests/%'
      AND assertion_ref !~ '(^|/)test_[^/]+\\.py$'
      AND assertion_ref !~ '\\.(test|spec)\\.[cm]?[jt]sx?$'
      AND assertion_ref !~ '/smoke/[^/]+\\.sh$'
  `,
};

/**
 * Fail-closed §③ prerequisite used before any §④ mechanism can be trusted.
 */
export async function checkGpLedgerReadiness(pool) {
  const counts = {};
  for (const [key, sql] of Object.entries(COUNT_QUERIES)) {
    const { rows } = await pool.query(sql);
    counts[key] = Number(rows[0]?.count ?? 0);
  }
  return {
    ready: Object.values(counts).every(count => count === 0),
    ...counts,
  };
}

async function runCli() {
  const { default: pool } = await import('./db.js');
  try {
    const result = await checkGpLedgerReadiness(pool);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ready) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    process.stderr.write(`[gp-ledger-readiness] ${error.message}\n`);
    process.exitCode = 1;
  });
}

