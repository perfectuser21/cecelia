/**
 * 执行记录总记录读接口（任务 05cfbcde）。
 *
 * GET /api/brain/runs/:run_id[?include=spans]  内网/回环鉴权；顶层平铺 runs 行全部列，include 含 spans 时同一只读快照附明细
 * 只匹配单段路径，/:run_id/definition、/:run_id/reconciliation 落到后面挂的原路由。
 */
import { Router } from 'express';
import defaultPool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

const MAX_RUN_ID_LENGTH = 200;
// NUL 等控制字符 PostgreSQL text 参数收不了（会 500 并回显驱动原始错误），入参阶段判 400
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function wantsSpans(include) {
  const values = Array.isArray(include) ? include : [include];
  return values.filter(v => typeof v === 'string').flatMap(v => v.split(',')).some(v => v.trim() === 'spans');
}

async function readRunWithSpans(pool, runId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const run = (await client.query('SELECT * FROM runs WHERE run_id = $1', [runId])).rows[0] || null;
    const spans = run ? (await client.query('SELECT * FROM spans WHERE run_id = $1 ORDER BY started_at ASC, created_at ASC, id ASC', [runId])).rows : [];
    await client.query('COMMIT');
    return run && { ...run, spans };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export function createRunsReadRouter({ pool = defaultPool } = {}) {
  const router = Router();
  router.use(internalAuthOrLoopback);
  router.get('/', (req, res) => res.status(400).json({ error: 'run_id is required' }));
  router.get('/:run_id', async (req, res) => {
    const runId = req.params.run_id.trim();
    if (!runId) return res.status(400).json({ error: 'run_id is required' });
    if (runId.length > MAX_RUN_ID_LENGTH) return res.status(400).json({ error: `run_id must be at most ${MAX_RUN_ID_LENGTH} characters` });
    if (CONTROL_CHARS.test(runId)) return res.status(400).json({ error: 'run_id must not contain control characters' });
    try {
      const run = wantsSpans(req.query.include)
        ? await readRunWithSpans(pool, runId)
        : (await pool.query('SELECT * FROM runs WHERE run_id = $1', [runId])).rows[0];
      if (!run) return res.status(404).json({ error: `run not found: ${runId}` });
      return res.json(run);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
  // Express 解码 :run_id 遇非法百分号编码抛 URIError，局部转 400；其它错误交还全局
  router.use((err, req, res, next) => {
    if (err instanceof URIError) return res.status(400).json({ error: 'run_id is not valid URL encoding' });
    return next(err);
  });
  return router;
}

export default createRunsReadRouter;
