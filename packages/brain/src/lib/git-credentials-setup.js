/**
 * git-credentials-setup.js — Brain 容器内 git 凭据初始化。
 *
 * 问题：docker-compose 把宿主 ~/.gitconfig 只读挂进 Brain 容器（HOME 对齐宿主路径），
 * 宿主 gitconfig 配了 credential.helper = git-credential-gh-token（只在宿主存在的二进制）。
 * 容器内该 helper 不存在 → 所有 https://github.com clone/fetch/push 报
 * "could not read Username" → harness GitHub-URL base_repo 路径（西安 Codex 路由）全挂。
 *
 * 修法：启动时写一个可写的 GIT_CONFIG_GLOBAL，用 url.insteadOf 把 github.com 操作
 * 自动注入 x-access-token 凭据。GIT_CONFIG_GLOBAL 替代 $HOME/.gitconfig 的 global 查找，
 * 既绕过坏 helper，又给 clone/fetch/push 一处统一注入 token。
 */
import { writeFileSync } from 'node:fs';

/**
 * 配置容器内 git 全局凭据（token 注入）。
 *
 * @param {object} opts
 * @param {string} opts.token        GITHUB_TOKEN（空则 no-op）
 * @param {string} opts.configPath   GIT_CONFIG_GLOBAL 目标路径（可写，如 /tmp/brain-gitconfig）
 * @param {object} opts.env          要写入 GIT_CONFIG_GLOBAL 的 env 对象（通常 process.env）
 * @param {function} [opts.writeFileFn]  注入用（测试）
 * @returns {boolean}  true=已配置，false=无 token 跳过
 */
export function setupGitCredentials(opts = {}) {
  const { token, configPath, env } = opts;
  const writeFileFn = opts.writeFileFn || writeFileSync;

  if (!token) return false;

  // url.insteadOf：所有 https://github.com/ 前缀的 git 操作自动改写为带 token 的 URL。
  // 覆盖 clone / fetch / push 全部，无需逐个调用点注入。
  const content =
    `[url "https://x-access-token:${token}@github.com/"]\n` +
    `\tinsteadOf = https://github.com/\n`;

  writeFileFn(configPath, content, { mode: 0o600 });

  // GIT_CONFIG_GLOBAL 让后续所有 git 子进程用此文件作 global config（替代坏的 $HOME/.gitconfig）。
  if (env) env.GIT_CONFIG_GLOBAL = configPath;

  return true;
}
