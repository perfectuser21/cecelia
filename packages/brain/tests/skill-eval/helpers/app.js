/**
 * 测试 Express App 工厂
 * 创建带配置注入的 Brain 测试实例
 */

/**
 * 创建用于测试的 Brain Express app
 * @param {Object} opts
 * @param {Object} opts.db - pg-promise 数据库实例
 * @param {number} opts.MAX_ZIP_MB
 * @param {number} opts.SKILL_EVAL_PENDING_LIMIT
 * @param {string} opts.SKILL_EVAL_PROXY_TOKEN
 * @param {number} opts.MAX_CONCURRENT_SKILL_EVAL
 */
export async function createTestApp({
  db,
  MAX_ZIP_MB = 10,
  SKILL_EVAL_PENDING_LIMIT = 20,
  SKILL_EVAL_PROXY_TOKEN = 'test-proxy-token',
  MAX_CONCURRENT_SKILL_EVAL = 1,
} = {}) {
  // 注入测试环境变量
  process.env.MAX_ZIP_MB = String(MAX_ZIP_MB);
  process.env.SKILL_EVAL_PENDING_LIMIT = String(SKILL_EVAL_PENDING_LIMIT);
  process.env.SKILL_EVAL_PROXY_TOKEN = SKILL_EVAL_PROXY_TOKEN;
  process.env.MAX_CONCURRENT_SKILL_EVAL = String(MAX_CONCURRENT_SKILL_EVAL);

  // 懒加载 Brain 的 skill-eval 路由模块
  // 实际路径在实现后为：packages/brain/src/routes/skill-evals.js
  const { createSkillEvalRouter } = await import(
    '../../../../packages/brain/src/routes/skill-evals.js'
  );

  const express = (await import('express')).default;
  const app = express();

  app.use('/api/brain/skill-evals', createSkillEvalRouter({ db }));

  return app;
}
