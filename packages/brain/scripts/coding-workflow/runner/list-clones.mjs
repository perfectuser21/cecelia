#!/usr/bin/env node
// 列出要补的仓库 clone（runner.sh / install.sh 用）：已启用（repos.json enabled + CODING_WF_REPOS）的非默认仓库，
// 每行「<clone 绝对路径>\t<origin>」。默认仓（cecelia）的 clone 由 runner.sh / install.sh 自己管（自更新）。
// 只读配置表，不碰任何目录；配置表坏了非 0 退出（调用方记日志、不 clone）。
import { loadRepos, enabledRepos, resolveEntry, reposFile } from './lib/repos.mjs';

const env = process.env;
const repos = loadRepos(reposFile(env));
for (const entry of enabledRepos(env, repos)) {
  if (entry.default) continue;
  const rc = resolveEntry(entry, env);
  process.stdout.write(`${rc.clone}\t${rc.origin}\n`);
}
