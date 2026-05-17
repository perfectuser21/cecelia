import * as dockerPrune from './janitor-jobs/docker-prune.js';

const REGISTRY = [dockerPrune];

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
      enabled: configMap[job.JOB_ID]?.enabled ?? true,
      last_run: runMap[job.JOB_ID] ?? null
    }))
  };
}

export async function runJob(pool, jobId) {
  const job = REGISTRY.find(j => j.JOB_ID === jobId);
  if (!job) throw new Error(`Unknown job: ${jobId}`);

  const { rows: [run] } = await pool.query(
    `INSERT INTO janitor_runs (job_id, job_name, status)
     VALUES ($1, $2, 'running') RETURNING id, job_id`,
    [job.JOB_ID, job.JOB_NAME]
  );

  const started = Date.now();
  const result = await job.run();

  await pool.query(
    `UPDATE janitor_runs
     SET status=$1, output=$2, freed_bytes=$3,
         finished_at=NOW(), duration_ms=$4
     WHERE id=$5`,
    [result.status, result.output ?? null, result.freed_bytes ?? null,
     Date.now() - started, run.id]
  );

  return { run_id: run.id, ...result };
}

export async function setJobConfig(pool, jobId, { enabled }) {
  await pool.query(
    `INSERT INTO janitor_config (job_id, enabled, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (job_id) DO UPDATE SET enabled=$2, updated_at=NOW()`,
    [jobId, enabled]
  );
  return { job_id: jobId, enabled };
}

export async function getJobHistory(pool, jobId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, status, started_at, finished_at, duration_ms, output, freed_bytes
     FROM janitor_runs WHERE job_id=$1 ORDER BY started_at DESC LIMIT $2`,
    [jobId, limit]
  );
  return { job_id: jobId, history: rows };
}
