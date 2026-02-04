/**
 * 共享常量和工具函数 - 避免在多个脚本中重复硬编码
 */

// Debug 模式（通过 DEBUG=1 环境变量启用）
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

/**
 * Debug 日志（仅在 DEBUG=1 时输出到 stderr）
 * @param {...any} args - 日志参数
 */
function debugLog(...args) {
  if (DEBUG) {
    console.error('[DEBUG]', ...args);
  }
}

module.exports = {
  // Debug 工具
  DEBUG,
  debugLog,

  // Git 默认值
  DEFAULT_BASE_BRANCH: 'develop',
  DEFAULT_HEAD_REF: 'HEAD',

  // 文件路径
  QA_DECISION_PATH: 'docs/QA-DECISION.md',
  FEATURE_REGISTRY_PATH: 'features/feature-registry.yml',
  REGRESSION_CONTRACT_PATH: 'regression-contract.yaml',

  // 目录
  ARCHIVE_DIR: '.archive',
  DOCS_DIR: 'docs',
  SCRIPTS_DIR: 'scripts',
};
