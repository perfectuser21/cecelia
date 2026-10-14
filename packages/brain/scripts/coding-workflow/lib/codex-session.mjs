// Claude 调用形状的显式翻译；返回原生 Codex CLI，不制造 Claude transcript。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { previewCapability } from './preview-bridge.mjs';

const READ_SERVER = fileURLToPath(new URL('./codex-files.mjs', import.meta.url));
const MUTATIONS = ['git commit', 'git reset', 'git checkout', 'git rebase'];
const DENIALS = new Set(['Bash', 'Bash(git push:*)', 'Bash(gh:*)', ...MUTATIONS.map((c) => `Bash(${c}:*)`)]);
const DISABLED = ['apps', 'enable_mcp_apps', 'plugins', 'hooks', 'browser_use', 'computer_use', 'standalone_web_search', 'image_generation', 'multi_agent', 'multi_agent_v2', 'request_permissions_tool', 'skill_mcp_dependency_install'];

function parse(args) {
  const out = { denied: [], allowed: [], addDirs: [] };
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === '-p') out.prompt = args[++i];
    else if (key === '--permission-mode') { if (args[++i] !== 'acceptEdits') throw new Error('codex_permission_unsupported'); }
    else if (key === '--output-format') { if (!['json', 'stream-json'].includes(args[++i])) throw new Error('codex_format_unsupported'); }
    else if (key === '--setting-sources') { if (args[++i] !== 'user') throw new Error('codex_settings_unsupported'); }
    else if (key === '--verbose') { /* Codex --json 始终保留原生事件 */ }
    else if (key === '--add-dir') out.addDirs.push(args[++i]);
    else if (key === '--allowedTools' || key === '--disallowedTools') {
      const list = key === '--allowedTools' ? out.allowed : out.denied;
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) list.push(args[++i]);
    } else throw new Error(`codex_argument_unsupported:${key}`);
  }
  if (typeof out.prompt !== 'string') throw new Error('codex_prompt_missing');
  if (out.allowed.some((x) => x !== 'Bash')) throw new Error('codex_allowed_tool_unsupported');
  if (out.denied.some((x) => !DENIALS.has(x) && !/^Read\(\/\/.+\)$/.test(x))) throw new Error('codex_denied_tool_unsupported');
  return out;
}
function gitDirectories(cwd) {
  const git = path.join(cwd, '.git');
  if (!fs.existsSync(git)) return [];
  if (fs.statSync(git).isDirectory()) return [fs.realpathSync(git)];
  return [...new Set(['--absolute-git-dir', '--git-common-dir'].map((flag) => path.resolve(cwd, execFileSync('git', ['rev-parse', flag], { cwd, encoding: 'utf8' }).trim())))];
}
export function prepareCodexSession({ args, cwd, env = process.env, nativeOptions = {} }) {
  const input = parse(args);
  const judge = nativeOptions.access === 'judge';
  if (nativeOptions.access && !judge) throw new Error('codex_access_unsupported');
  const preview = nativeOptions.previewCapability ? previewCapability(nativeOptions.previewCapability) : null;
  if (preview && (judge || !input.denied.includes('Bash(git commit:*)'))) throw new Error('codex_preview_requires_qa');
  if (/^PREVIEW_URL:\s*\S+/m.test(input.prompt) && !preview) throw new Error('codex_qa_local_only');
  const noShell = judge || input.denied.includes('Bash');
  if (noShell && input.denied.some((s) => s.startsWith('Read('))) throw new Error('codex_read_denial_with_mcp_unsupported');
  const readGit = noShell || MUTATIONS.some((c) => input.denied.includes(`Bash(${c}:*)`));
  const native = ['exec', '--json', '--ignore-user-config', '--ignore-rules', '--ephemeral'];
  const toml = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}` : JSON.stringify(value);
  const config = (key, value) => native.push('-c', `${key}=${toml(value)}`);
  config('approval_policy', 'never');
  config('default_permissions', 'coding');
  const filesystem = {};
  filesystem[path.join(env.HOME || os.homedir(), '.credentials')] = 'deny';
  config('web_search', 'disabled');
  config('shell_environment_policy.ignore_default_excludes', false);
  // 不读取 worktree 中的 .codex 配置/钩子；本仓规矩已由 runner 注入 prompt。
  config('projects', { [cwd]: { trust_level: 'untrusted' } });
  for (const feature of DISABLED) native.push('--disable', feature);
  for (const dir of gitDirectories(cwd)) filesystem[dir] = readGit ? 'read' : 'write';
  for (const denial of input.denied.filter((s) => s.startsWith('Read('))) filesystem[denial.slice(6, -1)] = 'deny';
  let network = { enabled: false };
  if (preview) {
    native.push('--enable', 'network_proxy');
    filesystem[preview.runtimeDir] = 'read';
    network = { enabled: true, domains: {}, enable_socks5: false, enable_socks5_udp: false,
      allow_local_binding: false, allow_upstream_proxy: false, dangerously_allow_all_unix_sockets: false,
      unix_sockets: { [preview.socketPath]: 'allow' } };
  }
  config('permissions', { coding: { extends: judge ? ':read-only' : ':workspace', filesystem, network } });
  for (const dir of input.addDirs) native.push('--add-dir', path.resolve(dir));
  if (noShell) {
    native.push('--disable', 'shell_tool', '--disable', 'unified_exec');
    if (!judge) {
      config('mcp_servers.coding_files.command', process.execPath);
      config('mcp_servers.coding_files.args', [READ_SERVER, fs.realpathSync(cwd)]);
      config('mcp_servers.coding_files.enabled_tools', ['read_file', 'list_files']);
    }
  }
  if (judge) {
    native.push('--skip-git-repo-check');
    if (nativeOptions.outputLastMessage) native.push('--output-last-message', path.resolve(nativeOptions.outputLastMessage));
  }
  if (env.CODING_WF_CODEX_MODEL) native.push('--model', env.CODING_WF_CODEX_MODEL);
  native.push('-');
  return { bin: env.CODING_WF_CODEX_BIN || 'codex', args: native, stdin: input.prompt,
    env: { ...(env.CODING_WF_CODEX_HOME ? { CODEX_HOME: env.CODING_WF_CODEX_HOME } : {}), ...(preview ? { CURL_HOME: preview.runtimeDir } : {}) } };
}
