/**
 * 测试 Express App 工厂
 */
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_EVALS_PATH = join(__dirname, '../../../src/routes/skill-evals.js');

export async function createTestApp({
  db, MAX_ZIP_MB = 10, SKILL_EVAL_PENDING_LIMIT = 20,
  SKILL_EVAL_PROXY_TOKEN = 'test-proxy-token', MAX_CONCURRENT_SKILL_EVAL = 1,
  SKILL_EVAL_TIMEOUT = 1800, SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS = 3,
  SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS = 14,
} = {}) {
  process.env.MAX_ZIP_MB = String(MAX_ZIP_MB);
  process.env.SKILL_EVAL_PENDING_LIMIT = String(SKILL_EVAL_PENDING_LIMIT);
  process.env.SKILL_EVAL_PROXY_TOKEN = SKILL_EVAL_PROXY_TOKEN;
  process.env.MAX_CONCURRENT_SKILL_EVAL = String(MAX_CONCURRENT_SKILL_EVAL);
  process.env.SKILL_EVAL_TIMEOUT = String(SKILL_EVAL_TIMEOUT);
  process.env.SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS = String(SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS);
  process.env.SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS = String(SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS);

  const { createSkillEvalRouter, getSkillEvalConfigHandler } = await import(/* @vite-ignore */ SKILL_EVALS_PATH);
  const express = (await import('express')).default;
  const app = express();

  app.use('/api/brain/skill-evals', createSkillEvalRouter({ db }));
  app.get('/api/brain/config', getSkillEvalConfigHandler());
  return app;
}
