/**
 * case-file-store.js —— gan_case_file 读写薄层（append-only）。
 *
 * 语义 SSOT：docs/superpowers/specs/2026-08-04-gan-case-file-design.md §数据模型。
 * 写路径唯一调用者是 attempt-store.js recordCallbackTerminal（同事务 INSERT，
 * 对 initiative_runs 行不产生第二条 UPDATE——死锁定律见该文件注释）。
 * 读路径唯一调用者是 ground-truth.js collectGroundTruth（供 dispatcher 注入
 * bundle.inputs.case_file）。
 */
import { CASE_FILE_FULL_TEXT_ROUNDS } from './constants.js';

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

/**
 * 案卷视图 = 按 round, author_role 升序全量行（design doc §数据模型）。
 *
 * TaskBundle 膨胀闸1（P2-3）：只有最近 fullTextRounds 轮带 feedback_md 全文，
 * 更早的轮次截断为 NULL，只留结构化字段（round/author_role/contract_sha/
 * rubric_scores/blockers）——rubric 历史与 blocker 台账仍然是全量的，收窄的
 * 只是最占字节的自由文本反馈。
 */
export async function loadCaseFile(pool, runId, { fullTextRounds = CASE_FILE_FULL_TEXT_ROUNDS } = {}) {
  const result = await pool.query(
    `WITH bounds AS (
       SELECT COALESCE(MAX(round), 0) - $2::integer AS cutoff_round
         FROM gan_case_file
        WHERE run_id = $1
     )
     SELECT gcf.id, gcf.run_id, gcf.round, gcf.author_role, gcf.attempt_id, gcf.contract_sha,
            gcf.rubric_scores, gcf.blockers,
            CASE WHEN gcf.round > bounds.cutoff_round THEN gcf.feedback_md ELSE NULL END AS feedback_md,
            gcf.created_at
       FROM gan_case_file gcf, bounds
      WHERE gcf.run_id = $1
      ORDER BY gcf.round ASC, gcf.author_role ASC`,
    [runId, fullTextRounds],
  );
  return result.rows;
}
