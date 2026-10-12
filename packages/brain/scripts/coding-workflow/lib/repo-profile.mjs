// 活动层与提示词的仓库口径（C6）：repos.json 条目由 runner 经信封 input.repo_profile（链上活动）/ cfg.repoProfile（门禁）传入，
// 这里把它翻成各处要的口径：QA 模式、版本碎片规则、回归 smoke 目录、碰生产判定、预检清单名、本仓规矩提示词。
// 没传（旧信封、旧调用方、单测手搓的 cfg）一律按默认仓（cecelia），行为不变。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepos, reposFile } from '../runner/lib/repos.mjs';

const WORKFLOW_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// lib/ci-precheck.mjs 认得的预检清单名（repos.json prechecks）
export const PRECHECK_SETS = ['cecelia', 'zenithjoy'];

let cachedDefault = null;
/** 默认仓的 repos.json 条目（CODING_WF_REPOS_FILE 覆盖配置表时读覆盖的那份）。 */
export function defaultProfile() {
  cachedDefault ??= loadRepos(reposFile()).find((r) => r.default);
  return cachedDefault;
}

/** 传入的是 repos.json 条目（带字符串 key）就用它，否则默认仓。 */
export function profileOf(profile) {
  return profile && typeof profile === 'object' && typeof profile.key === 'string' ? profile : defaultProfile();
}

/** QA 模式：brain_preview（PR 预览环境）/ local（PR worktree 内黑盒，zenithjoy 第一阶段）。 */
export function qaMode(profile) {
  return profileOf(profile).preview?.type ?? 'brain_preview';
}

/** 回归 smoke 的目录与登记文件 { dir, allowlist, write_targets }；本仓不固化返回 null。 */
export function qaSmokeOf(profile) {
  return profileOf(profile).qa_smoke ?? null;
}

/** 碰生产判定的正则片段：本仓 ∪ 默认仓（MMV 本机 localhost:5221 永远是 cecelia 生产 Brain，任何仓库的 QA 都不许碰）。 */
export function productionPatterns(profile) {
  return [...new Set([...profileOf(profile).production_re, ...defaultProfile().production_re])];
}

/** 本仓规矩提示词（注入 {{REPO_RULES}}）。 */
export function repoRules(profile) {
  return fs.readFileSync(path.join(WORKFLOW_DIR, profileOf(profile).rules_prompt), 'utf8').trim();
}
