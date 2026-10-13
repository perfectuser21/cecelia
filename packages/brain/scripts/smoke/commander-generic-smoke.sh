#!/usr/bin/env bash
# 运行正式合同、反馈HTTP入口及登记/发布适配的回归；不触生产或手机。
set -euo pipefail
cd "$(dirname "$0")/../.."
npx vitest run src/lib/__tests__/commander-v2*.test.js \
  src/lib/__tests__/commander-verification-transport.test.js \
  src/routes/__tests__/workflow-commander.test.js \
  src/workflow-authoring/freeze.test.js \
  src/workflow-authoring/fixed-git-source.test.js \
  src/workflow-authoring/registration-freeze.test.js \
  src/workflow-authoring/ci-adapter.test.js \
  src/lib/__tests__/pilot-release-verification.test.js
