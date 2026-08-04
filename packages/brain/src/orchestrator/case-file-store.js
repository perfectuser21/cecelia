/**
 * case-file-store.js —— gan_case_file 读写薄层（append-only）。
 *
 * 语义 SSOT：docs/superpowers/specs/2026-08-04-gan-case-file-design.md §数据模型。
 * 写路径唯一调用者是 attempt-store.js recordCallbackTerminal（同事务 INSERT，
 * 对 initiative_runs 行不产生第二条 UPDATE——死锁定律见该文件注释）。
 * 读路径唯一调用者是 ground-truth.js collectGroundTruth（供 dispatcher 注入
 * bundle.inputs.case_file）。
 */

export async function insertCaseFileRow(client, {
  runId,
  round,
  authorRole,
  attemptId,
  contractSha = null,
  rubricScores = null,
  blockers = [],
  feedbackMd = null,
}) {
  if (!runId || !Number.isInteger(round) || !authorRole || !attemptId) {
    throw new Error(
      'insertCaseFileRow requires runId, round (integer), authorRole, attemptId',
    );
  }
  await client.query(
    `INSERT INTO gan_case_file
       (run_id, round, author_role, attempt_id, contract_sha, rubric_scores, blockers, feedback_md)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     ON CONFLICT (run_id, round, author_role) DO NOTHING`,
    [
      runId,
      round,
      authorRole,
      attemptId,
      contractSha,
      rubricScores == null ? null : JSON.stringify(rubricScores),
      JSON.stringify(blockers ?? []),
      feedbackMd,
    ],
  );
}

/** 案卷视图 = 按 round, author_role 升序全量行（design doc §数据模型）。 */
export async function loadCaseFile(pool, runId) {
  const result = await pool.query(
    `SELECT id, run_id, round, author_role, attempt_id, contract_sha,
            rubric_scores, blockers, feedback_md, created_at
       FROM gan_case_file
      WHERE run_id = $1
      ORDER BY round ASC, author_role ASC`,
    [runId],
  );
  return result.rows;
}
