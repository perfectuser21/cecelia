/**
 * 合同测试入口（sprint 脚手架）— watchdog-gh-compat
 *
 * 真实测试文件已毕业进 CI：
 * /workspace/tests/regression/watchdog-gh-compat/harness-relay-watchdog-ghcompat.test.js
 *
 * 根据 packages/brain/vitest.config.js 规定：
 * sprints/ 路径已于 07-10 从 include 移除，新 sprint 测试必须进
 * tests/regression/<sprint-slug>/ 才能被 vitest 自动发现。
 *
 * 验收方式：
 *   cd /workspace/packages/brain
 *   NODE_OPTIONS="--max-old-space-size=3072" npx vitest run \
 *     /workspace/tests/regression/watchdog-gh-compat/harness-relay-watchdog-ghcompat.test.js
 */

// 重导出路径引用（文档性，非实际测试）
export const CONTRACT_TEST_PATH = '../../tests/regression/watchdog-gh-compat/harness-relay-watchdog-ghcompat.test.js';
export const SPRINT_SLUG = '07162330-watchdog-gh-compat';
export const STATUS = 'FAILING_BEFORE_FIX'; // B1-fallback-ci-red, B2-exact 修复前 FAIL
