import { execFileSync } from 'node:child_process';

const TEST_FILE_PATTERN = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|test_[^/]+\.py|[^/]+_test\.py)$/;

export function readPullRequestFiles(prUrl) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(prUrl ?? '')) {
    return [];
  }
  const output = execFileSync(
    process.env.GH_CMD || 'gh',
    ['pr', 'view', prUrl, '--json', 'files', '-q', '.files[].path'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return output.split('\n').map((item) => item.trim()).filter(Boolean);
}

export async function finalizeHarnessReportFeature(db, {
  featureId,
  prUrl,
  readChangedFiles = async (url) => readPullRequestFiles(url),
} = {}) {
  if (!featureId) return { updated: false, reason: 'feature_id_missing' };
  const featureResult = await db.query(
    `SELECT id, unit_test_path, workflow_ref, guard_ref
       FROM journey_features
      WHERE id = $1`,
    [featureId],
  );
  const feature = featureResult.rows[0];
  if (!feature) return { updated: false, reason: 'feature_not_found' };

  let unitTestPath = null;
  if (!feature.unit_test_path && !feature.workflow_ref && !feature.guard_ref && prUrl) {
    try {
      const changedFiles = await readChangedFiles(prUrl);
      unitTestPath = changedFiles.find((file) => TEST_FILE_PATTERN.test(file)) ?? null;
    } catch (error) {
      console.warn(`[harness-report-writeback] PR files unavailable: ${error.message}`);
    }
  }

  const updated = await db.query(
    `UPDATE journey_features
        SET status = 'done',
            unit_test_path = CASE
              WHEN unit_test_path IS NULL AND workflow_ref IS NULL AND guard_ref IS NULL
                THEN COALESCE($2, unit_test_path)
              ELSE unit_test_path
            END,
            notion_synced_at = NULL,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [featureId, unitTestPath],
  );
  return { updated: updated.rows.length === 1, unitTestPath };
}
