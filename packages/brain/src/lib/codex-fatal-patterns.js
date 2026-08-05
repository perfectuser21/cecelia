/**
 * CODEX_FATAL_PATTERNS — codex CLI 环境级致命错误特征（SSOT）。
 *
 * 这些错误与任务内容无关（config 不兼容 / CLI 版本过旧 / cwd 不受信任），
 * 不应计入任务失败或触发 quarantine——应安全回队 + 响亮告警（决策 e9cf7877）。
 * 事故背景：镜像 codex 0.116.0 读宿主 0.146.0 维护的 config 启动即死，
 * arch_review 全量被烧进 quarantine 死循环（2026-08-05）。
 */
export const CODEX_FATAL_PATTERNS = [
  { pattern: /requires a newer version of Codex/i, reason: 'codex_version_too_old' },
  { pattern: /default_permissions requires a `?\[permissions\]`? table/i, reason: 'codex_config_incompatible' },
  { pattern: /error(?::| in) [^\n]*config\.toml/i, reason: 'codex_config_parse_error' },
  { pattern: /Not inside a trusted directory/i, reason: 'codex_untrusted_cwd' },
];

/**
 * 分类 codex 非零退出的输出。命中环境级致命错误返回 { configError, reason }，否则 null。
 * stdout 与 stderr 都扫：版本 400 错误走 stdout 的 ERROR JSON 行，config 解析错走 stderr（均生产实测）。
 */
export function classifyCodexFailure(stdout, stderr) {
  const text = `${stderr || ''}\n${stdout || ''}`;
  for (const { pattern, reason } of CODEX_FATAL_PATTERNS) {
    if (pattern.test(text)) return { configError: true, reason };
  }
  return null;
}
