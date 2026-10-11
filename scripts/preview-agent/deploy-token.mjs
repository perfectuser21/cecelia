#!/usr/bin/env node
/**
 * deploy-token.mjs — 预览代理的部署令牌从哪来（任务 6f937566 ②）
 *
 * 过去 preview-agent-install.sh 把 DEPLOY_TOKEN 明文写进 launchd plist 的 EnvironmentVariables，
 * preview-agent.mjs 只认环境变量——令牌于是常年躺在 ~/Library/LaunchAgents 里。
 * 现在：环境变量优先（CI/手工调试），否则读凭据文件（默认 ~/.credentials/cecelia-deploy-token.env，
 * 与 coding-workflow runner 是同一个文件，同值才不会 401），两处都没有就拒绝启动。
 *
 * 令牌原文只放在返回对象的不可枚举属性 token 上：JSON.stringify / console.log 一个结果对象
 * 不会把令牌带出去；要打日志用 describeTokenSource()。
 *
 * CLI（发布脚本用，令牌只在本进程内存里，不进 argv / 不落盘）：
 *   node deploy-token.mjs check          有令牌退出 0，否则 1（只打印来源）
 *   node deploy-token.mjs probe <url>    带 Bearer POST 该地址，打印 HTTP 码；200 退出 0
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultTokenFile = (home = homedir()) => join(home, '.credentials', 'cecelia-deploy-token.env');

const LINE_RE = /^\s*(?:export\s+)?DEPLOY_TOKEN\s*=(.*)$/;

/** 只解析 DEPLOY_TOKEN= 这一行（可带 export 前缀与成对引号），找不到返回 null */
export function parseDeployTokenFile(text) {
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    let v = m[1].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    return v || null;
  }
  return null;
}

function result(token, fields) {
  const r = { ...fields };
  Object.defineProperty(r, 'token', { value: token, enumerable: false });
  return r;
}

export function loadDeployToken({
  env = process.env,
  home = homedir(),
  readFile = (p) => readFileSync(p, 'utf8'),
} = {}) {
  if (env.DEPLOY_TOKEN) return result(env.DEPLOY_TOKEN, { source: 'env', file: null });
  const file = env.DEPLOY_TOKEN_FILE || defaultTokenFile(home);
  let text;
  try {
    text = readFile(file);
  } catch (err) {
    return result(null, { source: null, file, reason: err?.code === 'ENOENT' ? 'file_missing' : 'file_unreadable' });
  }
  const token = parseDeployTokenFile(text);
  if (!token) return result(null, { source: null, file, reason: 'no_deploy_token_line' });
  return result(token, { source: 'file', file });
}

export function describeTokenSource(r) {
  if (r?.source === 'env') return '环境变量 DEPLOY_TOKEN';
  if (r?.source === 'file') return `凭据文件 ${r.file}`;
  return `未找到（${r?.reason || 'unknown'}${r?.file ? `，文件 ${r.file}` : ''}）`;
}

const SHA_RE = /^[0-9a-f]{40}$/;

/** 代理当前跑的代码版本：发布目录里的 .release-sha 优先，其次 git HEAD；都拿不到返回 null */
export function resolveReleaseSha({
  root,
  readFile = (p) => readFileSync(p, 'utf8'),
  gitHead = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
} = {}) {
  for (const read of [() => readFile(join(root, '.release-sha')), () => gitHead(root)]) {
    try {
      const v = String(read()).trim();
      if (SHA_RE.test(v)) return v;
    } catch { /* 下一来源 */ }
  }
  return null;
}

async function cli(argv) {
  const [cmd, url] = argv;
  const r = loadDeployToken();
  if (!r.token) {
    console.error(`[deploy-token] 部署令牌${describeTokenSource(r)}`);
    return 1;
  }
  if (cmd === 'check') {
    console.log(`[deploy-token] OK：来源 ${describeTokenSource(r)}`);
    return 0;
  }
  if (cmd === 'probe' && url) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${r.token}` }, signal: AbortSignal.timeout(10_000) });
      console.log(`HTTP ${res.status}`);
      return res.status === 200 ? 0 : 1;
    } catch (err) {
      console.error(`[deploy-token] probe 失败：${err?.name || 'error'}`);
      return 1;
    }
  }
  console.error('用法：deploy-token.mjs check | probe <url>');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await cli(process.argv.slice(2));
}
