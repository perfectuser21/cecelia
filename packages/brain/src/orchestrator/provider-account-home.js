import os from 'node:os';
import path from 'node:path';

// 账号 → 宿主目录名的单一真身。resolveProviderAccountHome 给执行体挂载用（宿主 administrator 的 home）；
// resolveCredentialAccountHome 给凭据 loader 用：fleet-worker 以 _cecelia（HOME=/var/empty）起 run.js 时，
// 凭据仍在 administrator 目录，经 CECELIA_CREDENTIAL_HOME_ROOT 指过去（决策 fbe2146c）。
export function providerAccountDirName(provider, account) {
  const value = String(account);
  if (provider === 'codex') {
    const number = value.match(/^(?:codex-)?team([1-9]\d*)$/)?.[1] ?? value.match(/^([1-9]\d*)$/)?.[1];
    if (!number) throw new Error(`invalid codex account: ${value}`);
    return `.codex-team${number}`;
  }
  if (provider === 'claude') {
    const number = value.match(/^(?:claude-)?account([1-9]\d*)$/)?.[1] ?? value.match(/^([1-9]\d*)$/)?.[1];
    if (!number) throw new Error(`invalid claude account: ${value}`);
    return `.claude-account${number}`;
  }
  if (provider === 'grok' && ['grok', 'default'].includes(value)) return '.grok';
  throw new Error(`invalid ${provider} account: ${value}`);
}

export function resolveProviderAccountHome(provider, account) {
  if (!account) return null;
  return path.join(os.homedir(), providerAccountDirName(provider, account));
}

export function resolveCredentialHomeRoot(env = process.env) {
  const root = env?.CECELIA_CREDENTIAL_HOME_ROOT;
  return typeof root === 'string' && root.length > 0 && path.isAbsolute(root) ? root : os.homedir();
}

export function resolveCredentialAccountHome(provider, account, { env = process.env } = {}) {
  if (!account) return null;
  return path.join(resolveCredentialHomeRoot(env), providerAccountDirName(provider, account));
}

export function parseTrustedUids(env = process.env) {
  const raw = env?.CECELIA_CREDENTIAL_TRUSTED_UIDS;
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];
  return raw.split(',').map((part) => {
    const text = part.trim();
    if (!/^\d+$/.test(text)) throw new Error('credential_trusted_uids_invalid');
    return Number(text);
  });
}
