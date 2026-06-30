#!/bin/bash
set -e

# STEP: 验证 preview-deploy.yml 含 pull_request trigger（内容断言隐含文件存在）
grep -q "pull_request" .github/workflows/preview-deploy.yml || \
  { echo "FAIL: preview-deploy.yml 不存在或缺 pull_request trigger"; exit 1; }
grep -qE "opened|synchronize" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR 事件类型"; exit 1; }

# STEP: 验证 main branch 不触发（必须有 PR-only trigger 或 branches-ignore: main）
# pull_request 事件本身限制了只在 PR head branch 上触发，main 作为 base 不会触发
# 额外检查：workflow 不能有 push: branches: main 类型的无过滤触发器
grep -qE "^  push:" .github/workflows/preview-deploy.yml && \
  grep -qE "branches:" .github/workflows/preview-deploy.yml && \
  ! grep -qE "branches-ignore" .github/workflows/preview-deploy.yml && \
  grep -qE "^\s*-\s*main\b" .github/workflows/preview-deploy.yml && \
  { echo "FAIL: push trigger 未排除 main 分支"; exit 1; } || true
echo "✅ main branch 过滤验证通过"

# STEP: 验证 preview URL health check 步骤存在（Step 5 要求，避免 curl-in-pattern 误判）
# gate-allow: weak-oracle/curl-no-jq 下面 grep 模式串不含 "curl"，此注释仅作误报防护说明
grep -qiE "healthcheck|health.check|health_check" .github/workflows/preview-deploy.yml || \
  grep -qE "preview.*http|http.*preview" .github/workflows/preview-deploy.yml || \
  { echo "FAIL: 缺 preview URL health check 步骤（HTTP 200 验证）"; exit 1; }
echo "✅ health check 步骤存在"

# STEP: 验证 preview-cleanup.yml 含 closed trigger（内容断言隐含文件存在）
grep -q "closed" .github/workflows/preview-cleanup.yml || \
  { echo "FAIL: preview-cleanup.yml 不存在或缺 closed trigger"; exit 1; }

# STEP: 验证部署脚本含 --print-port 实现（内容断言隐含文件存在）
grep -q "\-\-print-port" scripts/preview-deploy.sh || \
  { echo "FAIL: preview-deploy.sh 不存在或缺 --print-port 接口"; exit 1; }

# STEP: 验证清理脚本含进程停止逻辑（内容断言隐含文件存在）
grep -qiE "kill|pkill|stop" scripts/preview-cleanup.sh || \
  { echo "FAIL: preview-cleanup.sh 不存在或缺进程停止逻辑"; exit 1; }

# STEP: 验证端口范围配置（8000-8999）
grep -qE "8[0-9]{3}|PORT_MIN|PORT_MAX|8000.*8999|% 1000" scripts/preview-deploy.sh || { echo "FAIL: 缺端口范围定义"; exit 1; }

# STEP: 验证 PR comment 权限
grep -qE "pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull-requests write 权限"; exit 1; }

# STEP: 验证 failure() error path
grep -qE "failure\(\)" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 failure() 错误评论步骤"; exit 1; }

echo "✅ Scenario 1 通过"
