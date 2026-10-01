// docker-prune 已取消（2026-07-08 用户拍板：旧机制 + 部署自杀竞态 Issue 97cf5a41）。
// 框架保留：新 job import 后加进 REGISTRY 即可。
const REGISTRY = [];

export async function getJobs(pool) {
  const { rows: configs } = await pool.query(
    'SELECT job_id, enabled FROM janitor_config WHERE job_id = ANY($1)',
    [REGISTRY.map(j => j.JOB_ID)]
  );
  const { rows: lastRuns } = await pool.query(`
    SELECT DISTINCT ON (job_id) job_id, status, started_at, finished_at, freed_bytes
    FROM janitor_runs ORDER BY job_id, started_at DESC
  `);
  const configMap = Object.fromEntries(configs.map(c => [c.job_id, c]));
  const runMap = Object.fromEntries(lastRuns.map(r => [r.job_id, r]));

  return {
    jobs: REGISTRY.map(job => ({
      id: job.JOB_ID,
      name: job.JOB_NAME,
      enabled: configMap[job.JOB_ID]?.enabled === true,
      last_run: runMap[job.JOB_ID] ?? null
    }))
  };
}

export async function getJobHistory(pool, jobId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, status, started_at, finished_at, duration_ms, output, freed_bytes
     FROM janitor_runs WHERE job_id=$1 ORDER BY started_at DESC LIMIT $2`,
    [jobId, limit]
  );
  return { job_id: jobId, history: rows };
}

function failure(code, status = 409) {
  return Object.assign(new Error(code === 'JANITOR_UNKNOWN_JOB' ? 'Unknown job' : code), { code, status });
}

export function createJanitor(registry) {
  const jobs = new Map();
  for (const entry of registry) {
    if (!entry || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.JOB_ID)
        || typeof entry.JOB_NAME !== 'string' || !entry.JOB_NAME.trim()
        || typeof entry.run !== 'function' || jobs.has(entry.JOB_ID)) {
      throw failure('JANITOR_INVALID_REGISTRY', 500);
    }
    jobs.set(entry.JOB_ID, Object.freeze({ ...entry }));
  }
  const find = id => {
    if (!jobs.has(id)) throw failure('JANITOR_UNKNOWN_JOB', 404);
    return jobs.get(id);
  };

  async function locked(pool, id, callback) {
    const client = await pool.connect();
    const controller = new AbortController();
    let acquired = false;
    let broken = false;
    const onError = () => { broken = true; controller.abort(); };
    client.on?.('error', onError);
    const ensureConnected = () => {
      if (broken) throw failure('JANITOR_UNCONFIRMED');
    };
    try {
      const { rows: [lock] } = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [`janitor:${id}`],
      );
      ensureConnected();
      if (!lock?.locked) throw failure('JANITOR_BUSY', 423);
      acquired = true;
      return await callback(client, ensureConnected, controller.signal);
    } finally {
      let unlockFailed = false;
      if (acquired && !broken) {
        try {
          const { rows: [unlocked] } = await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked', [`janitor:${id}`],
          );
          if (!unlocked?.unlocked) unlockFailed = true;
        } catch { unlockFailed = true; }
      }
      client.removeListener?.('error', onError);
      client.release(broken || unlockFailed);
      if (unlockFailed) throw failure('JANITOR_LOCK_RELEASE_FAILED', 503);
    }
  }

  async function runJob(pool, jobId) {
    const job = find(jobId);
    return locked(pool, jobId, async (client, ensureConnected, signal) => {
      const { rows: [config] } = await client.query('SELECT enabled FROM janitor_config WHERE job_id = $1', [jobId]);
      ensureConnected();
      if (config?.enabled !== true) throw failure('JANITOR_DISABLED');
      const { rows: previous } = await client.query(
        "SELECT id FROM janitor_runs WHERE job_id = $1 AND status = 'running' LIMIT 1", [jobId],
      );
      if (previous.length) throw failure('JANITOR_UNCONFIRMED');
      const { rows: [run] } = await client.query(
        "INSERT INTO janitor_runs (job_id, job_name, status) VALUES ($1, $2, 'running') RETURNING id", [jobId, job.JOB_NAME],
      );
      ensureConnected();
      if (!run?.id) throw failure('JANITOR_UNCONFIRMED');
      const started = Date.now();
      let result;
      let actionError;
      try {
        result = await job.run({ run_id: run.id, signal });
        if (!result || !['success', 'failed', 'skipped'].includes(result.status)
            || (result.freed_bytes != null && (!Number.isSafeInteger(result.freed_bytes) || result.freed_bytes < 0))) {
          throw failure('JANITOR_INVALID_RESULT', 500);
        }
      } catch (err) {
        actionError = failure(err?.code === 'JANITOR_INVALID_RESULT' ? err.code : 'JANITOR_ACTION_FAILED', 500);
        result = { status: 'failed', freed_bytes: null };
      }
      ensureConnected();
      // Only fixed status codes enter this generic receipt. Policy-specific evidence
      // belongs to its task receipt; arbitrary exception/output text is not persisted.
      const output = actionError?.code ?? `JANITOR_${result.status.toUpperCase()}`;
      try {
        const update = await client.query(
          "UPDATE janitor_runs SET status=$1, output=$2, freed_bytes=$3, finished_at=NOW(), duration_ms=$4 WHERE id=$5 AND status='running'",
          [result.status, output, result.freed_bytes ?? null, Math.min(Date.now() - started, 2147483647), run.id],
        );
        ensureConnected();
        if (update.rowCount !== 1) throw failure('JANITOR_UNCONFIRMED');
      } catch { throw failure('JANITOR_UNCONFIRMED'); }
      if (actionError) throw actionError;
      return { run_id: run.id, status: result.status, freed_bytes: result.freed_bytes ?? null, output };
    });
  }

  async function setJobConfig(pool, jobId, { enabled }) {
    find(jobId);
    if (typeof enabled !== 'boolean') throw failure('JANITOR_INVALID_CONFIG', 400);
    return locked(pool, jobId, async (client, ensureConnected) => {
      await client.query(
        `INSERT INTO janitor_config (job_id, enabled, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (job_id) DO UPDATE SET enabled=$2, updated_at=NOW()`, [jobId, enabled],
      );
      ensureConnected();
      return { job_id: jobId, enabled };
    });
  }
  return Object.freeze({ runJob, setJobConfig });
}

export const { runJob, setJobConfig } = createJanitor(REGISTRY);
