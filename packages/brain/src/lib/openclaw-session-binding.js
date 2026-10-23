/** 会话级账号固定：只使用 Gateway 已验证的 user pin，不修改 Agent 全局账号顺序。 */
import { execFileSync } from 'node:child_process';

export function bindOpenclawSession({ binPath, key, agentId, model, profileId }, run = execFileSync) {
  const patch = JSON.parse(run(binPath, ['gateway', 'call', 'sessions.patch', '--params',
    JSON.stringify({ key, agentId, model: `${model}@${profileId}` }), '--json'],
  { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }));
  const entry = patch.entry;
  const split = model.indexOf('/');
  if (patch.ok !== true || patch.key !== key || !entry?.sessionId ||
      entry.authProfileOverride !== profileId || entry.authProfileOverrideSource !== 'user' ||
      entry.providerOverride !== model.slice(0, split) || entry.modelOverride !== model.slice(split + 1)) {
    throw new Error('openclaw_session_binding_mismatch');
  }
  // 只回传绑定事实，Gateway 其他响应字段不写入日志。
  return { key, sessionId: entry.sessionId, model, profileId, source: 'user' };
}

export function sessionBindingCommand(options) {
  const source = `const execFileSync=require("node:child_process").execFileSync;const bind=${bindOpenclawSession.toString()};try{console.log(JSON.stringify(bind(${JSON.stringify(options)},execFileSync)))}catch(e){console.error("openclaw_session_binding_failed: "+e.message);process.exit(1)}`;
  // base64 只用于安全传递脚本；不含 token，账号标识也不作为 shell 片段插值。
  return `node -e "eval(Buffer.from(\\"${Buffer.from(source).toString('base64')}\\",\\"base64\\").toString())"`;
}
