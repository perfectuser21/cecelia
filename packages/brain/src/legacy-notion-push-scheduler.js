import { runNotionPushSync, runNotionTaskPull } from './notion-push-sync.js';

// 2026-09-14：push 与 Tasks 拉取（主理人 Notion 排单接手）并联为默认周期动作
async function runPushAndPull(pool) {
  await runNotionPushSync(pool);
  await runNotionTaskPull(pool);
}

export function scheduleLegacyNotionPush(pool, {
  env = process.env,
  setIntervalFn = setInterval,
  run = runPushAndPull,
  logger = console,
} = {}) {
  if (env.NOTION_LEGACY_PUSH_ENABLED !== 'true') {
    logger.log('[legacy-notion-push] disabled; canonical Tasks/Projects projection remains active');
    return { enabled: false, timer: null };
  }

  const execute = async () => {
    try {
      await run(pool);
    } catch (error) {
      logger.warn('[legacy-notion-push] run failed:', error.message);
    }
  };
  const timer = setIntervalFn(execute, 5 * 60 * 1000);
  if (typeof timer?.unref === 'function') timer.unref();
  logger.log('[legacy-notion-push] enabled (5min interval)');
  return { enabled: true, timer };
}
