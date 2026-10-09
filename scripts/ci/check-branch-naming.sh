#!/usr/bin/env bash
# check-branch-naming.sh — /dev 工作流分支命名规范校验
# 从 .github/workflows/ci.yml 的 branch-naming job 抽取，供 CI 复用 + 单测覆盖
set -euo pipefail

BRANCH="${1:?usage: check-branch-naming.sh <branch-name>}"

# 基础分支直接跳过
if echo "$BRANCH" | grep -qE '^(main|master|develop|staging|release)$'; then
  echo "✅ 基础分支，跳过命名检查: $BRANCH"
  exit 0
fi

# Dependabot 官方固定分支名格式（dependabot/npm_and_yarn/xxx），非 /dev 工作流产出，
# 单独放行——其余 CI job（测试/依赖冲突扫描等）对 Dependabot PR 照常跑，不豁免
if echo "$BRANCH" | grep -qE '^dependabot/'; then
  echo "✅ Dependabot 分支，跳过命名检查: $BRANCH"
  exit 0
fi

# auto-version.yml bot 的版本 bump 分支（auto-version-bump-<semver>），机器产出、
# 合并即删——历史上 bot PR 全部死在本闸(从未合并成功),碎片化发版(PR#5179)后 bot PR
# 成为版本发布唯一通道,必须放行
if echo "$BRANCH" | grep -qE '^auto-version-bump-[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "✅ auto-version bot 分支，跳过命名检查: $BRANCH"
  exit 0
fi

# kernel Work Router 受信分支（r41 案卷 run 5bfc1af9 / PR #5006）：
# 受信 publisher 按 routing receipt 的 cp-route-api-<hex8> 发布，是合法造分支方。
if echo "$BRANCH" | grep -qE '^cp-route-api-[0-9a-f]{8}$'; then
  echo "✅ kernel 受信分支: $BRANCH"
  exit 0
fi

# 兼容 8 位 (MMDDHHNN) 与 10 位 (MMDDHHMMSS) 时间戳
if echo "$BRANCH" | grep -qE '^cp-[0-9]{8,10}-[a-z0-9-]+$'; then
  echo "✅ 分支命名规范: $BRANCH"
else
  echo "::error::分支名 '$BRANCH' 不符合 /dev 工作流规范"
  echo "  当前分支: $BRANCH"
  echo "  要求格式: cp-XXXXXXXX-task-name（8 或 10 位时间戳）"
  echo "  所有代码改动必须通过 /dev 工作流创建分支"
  exit 1
fi
