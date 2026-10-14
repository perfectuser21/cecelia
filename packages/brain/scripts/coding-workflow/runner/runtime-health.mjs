// 无任务/无推理的启动预检；只接受指定账户的 ChatGPT 登录，不回退 API key 或 Claude。
import fs from 'node:fs';
import path from 'node:path';
import { runtimeProcess } from './runtime-process.mjs';
import { pathToFileURL } from 'node:url';

export function codexEnvironment(env) {
  const clean = { ...env, CODEX_HOME: env.CODING_WF_CODEX_HOME };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_ACCESS_TOKEN']) delete clean[key];
  return clean;
}

export async function checkRuntimeHealth(env = process.env, { signal } = {}) {
  const provider = env.CODING_WF_PROVIDER || 'claude';
  if (!['codex', 'claude'].includes(provider)) throw new Error('runtime_provider_unknown');
  if (provider === 'claude') return { provider };
  const account = env.CODING_WF_CODEX_HOME;
  if (!account || !path.isAbsolute(account) || !fs.existsSync(account) || !fs.statSync(account).isDirectory()) {
    throw new Error('runtime_codex_home_missing');
  }
  if (!env.CODING_WF_CODEX_MODEL?.trim() || !env.CODING_WF_JUDGE_MODEL?.trim()) throw new Error('runtime_models_missing');
  if (env.CODING_WF_CODEX_MODEL.trim() === env.CODING_WF_JUDGE_MODEL.trim()) throw new Error('runtime_judge_model_not_independent');
  if (env.CODING_WF_JUDGE_PROVIDER !== 'codex') throw new Error('runtime_judge_provider_not_codex');
  const status = await runtimeProcess(env.CODING_WF_CODEX_BIN || 'codex', ['login', 'status'], {
    env: codexEnvironment(env), signal, timeoutMs: 15000,
  });
  if (status.code !== 0 || status.terminated || `${status.stdout ?? ''}\n${status.stderr ?? ''}`.trim() !== 'Logged in using ChatGPT') {
    throw new Error('runtime_codex_chatgpt_login_required');
  }
  return { provider, authentication: 'chatgpt', model: env.CODING_WF_CODEX_MODEL, judgeModel: env.CODING_WF_JUDGE_MODEL };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify({ ok: true, ...await checkRuntimeHealth() })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
