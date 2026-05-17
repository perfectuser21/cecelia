import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFile = promisify(execFileCb);

const DEFAULT_CREDS_FILE = path.join(os.homedir(), '.credentials', 'github.env');

async function tryGhAuthToken() {
  const { stdout } = await execFile('gh', ['auth', 'token'], { timeout: 5000 });
  return String(stdout || '').trim();
}

async function tryReadCredsFile(filePath = DEFAULT_CREDS_FILE) {
  const content = await readFile(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(\S+)\s*$/);
    if (m && m[1]) return m[1];
  }
  return '';
}

/**
 * 按 env -> gh CLI -> credentials file 顺序解析 GitHub token。
 * 全失败抛 'github_token_unavailable'。
 *
 * @param {object} [deps]
 * @param {Function} [deps.execFn]       测试注入 gh CLI 调用（返回 stdout string）
 * @param {Function} [deps.readFileFn]   测试注入凭据文件读取（返回文件内容 string）
 * @param {string}   [deps.credsPath]    测试注入凭据文件路径
 * @returns {Promise<string>}
 */
export async function resolveGitHubToken(deps = {}) {
  const execFn = deps.execFn || tryGhAuthToken;
  const readFileFn = deps.readFileFn || (() => tryReadCredsFile(deps.credsPath));

  const envTok = process.env.GITHUB_TOKEN;
  if (envTok && envTok.trim()) return envTok.trim();

  try {
    const ghTok = await execFn();
    if (ghTok && String(ghTok).trim()) return String(ghTok).trim();
  } catch { /* fallthrough */ }

  try {
    const fileContent = await readFileFn();
    if (typeof fileContent === 'string') {
      for (const line of fileContent.split(/\r?\n/)) {
        const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(\S+)\s*$/);
        if (m && m[1]) return m[1];
      }
    }
  } catch { /* fallthrough */ }

  throw new Error('github_token_unavailable');
}
