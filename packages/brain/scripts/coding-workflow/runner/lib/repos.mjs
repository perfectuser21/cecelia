// 仓库配置表（C4）：coding-workflow/repos.json 是 runner 多仓库口径的唯一来源。
// 本模块负责：读表校验、仓库名别名归一（短名 / owner/repo / https / ssh URL / 缺省）、CODING_WF_REPOS 开关、
// 每仓库运行时视图（repoView：把 cfg 的 clone / worktree 根 / 状态命名空间换成该仓库的），以及按仓库分命名空间的状态路径。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPOS_FILE = path.join(HERE, '../../repos.json');

/** 配置表路径：CODING_WF_REPOS_FILE 覆盖（测试 / 演练用；生产不设）。 */
export function reposFile(env = process.env) {
  return env.CODING_WF_REPOS_FILE || REPOS_FILE;
}
export const REQUIRED_FIELDS = ['key', 'default', 'enabled', 'slug', 'origin', 'aliases', 'clone', 'worktree_base', 'state_ns',
  'required_checks', 'base_fresh_check', 'install', 'qa_smoke', 'version_fragment', 'preview', 'production_re', 'automerge',
  'prechecks', 'rules_prompt'];

/** 仓库名归一：去空白、小写、去 github 前缀（https / ssh）、去 .git 与尾斜杠。非字符串返回 ''。 */
export function normalizeRepoName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

/** 读并校验 repos.json：缺字段、key/slug/clone/worktree_base/state_ns 重复、默认仓不是恰好一个 → 抛错（配置错不能带病跑）。 */
export function loadRepos(file = reposFile()) {
  const repos = JSON.parse(fs.readFileSync(file, 'utf8'))?.repos;
  if (!Array.isArray(repos) || repos.length === 0) throw new Error(`repos_config_invalid: ${file} 没有 repos`);
  for (const r of repos) {
    const missing = REQUIRED_FIELDS.filter((f) => !(f in (r ?? {})));
    if (missing.length) throw new Error(`repos_config_invalid: ${r?.key ?? '?'} 缺 ${missing.join(',')}`);
  }
  for (const f of ['key', 'slug', 'clone', 'worktree_base', 'state_ns']) {
    if (new Set(repos.map((r) => r[f])).size !== repos.length) throw new Error(`repos_config_invalid: ${f} 重复`);
  }
  if (repos.filter((r) => r.default).length !== 1) throw new Error('repos_config_invalid: 默认仓必须恰好一个');
  return repos;
}

let cached = null;
const allRepos = () => (cached ??= loadRepos());

/** 任务 payload.repo → 仓库 key；缺省（null/undefined/空串）归默认仓；未登记返回 null（不猜）。 */
export function resolveRepo(value, repos = allRepos()) {
  if (value === null || value === undefined || value === '') return repos.find((r) => r.default).key;
  const name = normalizeRepoName(value);
  if (!name) return null;
  const hit = repos.find((r) => [r.key, r.slug, r.origin, ...r.aliases].some((a) => normalizeRepoName(a) === name));
  return hit?.key ?? null;
}

/**
 * 启用的仓库（按 repos.json 顺序）：CODING_WF_REPOS（逗号分隔，接受别名）缺省 = 表里 enabled=true 的全部。
 * 双闸：表里 enabled=false 的即使列进环境变量也不启用；未登记的名字忽略。
 */
export function enabledRepos(env = process.env, repos = allRepos()) {
  const raw = String(env.CODING_WF_REPOS ?? '').trim();
  const wanted = raw ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => resolveRepo(s, repos)).filter(Boolean)) : null;
  return repos.filter((r) => r.enabled === true && (!wanted || wanted.has(r.key)));
}

const expandHome = (p, home) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

/** 表条目 → 运行时配置（展开 ~）；默认仓的 clone / worktree 根兼容旧环境变量 CODING_WF_REPO / CODING_WF_WORKTREE_BASE。 */
export function resolveEntry(entry, env = process.env) {
  const home = env.HOME || os.homedir();
  return {
    key: entry.key,
    slug: entry.slug,
    origin: entry.origin,
    clone: (entry.default && env.CODING_WF_REPO) || expandHome(entry.clone, home),
    worktreeBase: (entry.default && env.CODING_WF_WORKTREE_BASE) || expandHome(entry.worktree_base, home),
    stateNs: entry.state_ns || '',
    automerge: entry.automerge === true,
    baseFreshCheck: entry.base_fresh_check ?? null,
    requiredChecks: entry.required_checks,
    install: entry.install,
    previewType: entry.preview?.type ?? null,
    previewBaseRepo: entry.preview?.base_repo ?? null,
    profile: entry,
  };
}

/** 仓库相关的 cfg 字段（loadConfig 的默认仓视图与 repoView 共用）。trustedRepo（判卷代码 clone）不在其中，永远是默认仓。 */
export function repoFields(rc) {
  return {
    repo: rc.clone, worktreeBase: rc.worktreeBase, repoKey: rc.key, repoSlug: rc.slug, stateNs: rc.stateNs,
    repoAutomerge: rc.automerge, baseFreshCheck: rc.baseFreshCheck, install: rc.install,
    previewType: rc.previewType, previewBaseRepo: rc.previewBaseRepo,
    // 活动层与提示词按仓库参数化（C6）：repos.json 原条目，经信封 input.repo_profile 交给各活动（lib/repo-profile.mjs）
    repoProfile: rc.profile,
  };
}

/** 某仓库的 cfg 视图：所有按 cfg.repo / cfg.worktreeBase / 状态目录 / gh 仓库工作的函数拿它即作用到该仓库。 */
export function repoView(cfg, rc) {
  return { ...cfg, ...repoFields(rc), trustedRepo: cfg.trustedRepo ?? cfg.repo };
}

/** 门禁按仓库遍历的视图（cfg.repos 顺序）；cfg 没带 repos（旧调用方 / 单测）时就是 cfg 本身。 */
export function repoViews(cfg) {
  return Array.isArray(cfg.repos) ? cfg.repos.map((rc) => repoView(cfg, rc)) : [cfg];
}

/** 任务所在仓库的视图（task.repoKey，缺省或不在已启用列表 → 默认仓 cfg 本身）。 */
export function taskView(cfg, task) {
  const rc = (cfg.repos ?? []).find((r) => r.key === task?.repoKey);
  return rc ? repoView(cfg, rc) : cfg;
}

/** 日志/通知里的 PR 称呼：默认仓（命名空间为空）只写 PR #n，其他仓库带仓库名。 */
export function prLabel(cfg, number) {
  return cfg.stateNs ? `${cfg.repoKey} PR #${number}` : `PR #${number}`;
}

/** 状态目录：命名空间为空（cecelia）= logDir 本身（沿用旧路径，零迁移）；否则 <logDir>/<ns>/。 */
export function stateDir(cfg) {
  return cfg.stateNs ? path.join(cfg.logDir, cfg.stateNs) : cfg.logDir;
}

/** 按 PR 的状态/会话文件路径（qa-<pr>.json、cifix-<pr>.json、commander-<pr>.json 及其会话日志）。 */
export function prFile(cfg, name) {
  return path.join(stateDir(cfg), name);
}
