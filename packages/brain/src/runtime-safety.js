// 测试/预览实例只能提供被动 API；不能继承宿主的后台自动化和模型账号。
const enabled = value => value === '1' || value === 'true';
const isolatedDatabase = name => /(?:^|[_-])(test|testing|dev|scratch|staging|preview|eval|evaluator)(?:$|[_-])/i.test(name);

export function isIsolatedRuntime(env = process.env) {
  if (['test', 'development'].includes(env.NODE_ENV)) return true;
  if (enabled(env.VITEST)) return true;
  if (enabled(env.BRAIN_PREVIEW) || enabled(env.BRAIN_EVALUATOR_MODE)) return true;
  if (isolatedDatabase(env.DB_NAME || '') || isolatedDatabase(env.PGDATABASE || '')) return true;
  if (env.DATABASE_URL) {
    try {
      if (isolatedDatabase(decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)))) return true;
    } catch {
      return true; // 无法辨认数据库归属时禁止外部副作用。
    }
  }
  return false;
}

export function assertLiveLLMAllowed(env = process.env) {
  if (isIsolatedRuntime(env) || enabled(env.CECELIA_LLM_DISABLED)) {
    const error = new Error('当前测试/预览实例禁止真实模型调用');
    error.code = 'LLM_RUNTIME_ISOLATED';
    throw error;
  }
}

export function assertExternalExecutionAllowed(env = process.env) {
  if (isIsolatedRuntime(env)) {
    const error = new Error('当前测试/预览实例禁止派发真实执行者');
    error.code = 'EXECUTION_RUNTIME_ISOLATED';
    throw error;
  }
}
