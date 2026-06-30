contract_branch: cp-harness-propose-r4-4fed44f7-a0
sprint_dir: sprints/06291830-review-env

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: per-branch Review 预览环境

**范围**: 新建 `.github/workflows/preview-deploy.yml` + `.github/workflows/preview-cleanup.yml` + `scripts/preview-deploy.sh` + `scripts/preview-cleanup.sh`，实现 PR branch push → dashboard 自动预览部署到 hk-vps 唯一端口 → preview URL health check HTTP 200 → PR 评论写入 URL → PR close/merge → 自动清理
**大小**: M

---

## ARTIFACT 条目

- [x] [ARTIFACT] `.github/workflows/preview-deploy.yml` 存在且含 `pull_request` trigger
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/preview-deploy.yml','utf8');if(!c.includes('pull_request'))process.exit(1)"

- [x] [ARTIFACT] `.github/workflows/preview-cleanup.yml` 存在且含 `closed` 事件 trigger
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/preview-cleanup.yml','utf8');if(!c.includes('closed'))process.exit(1)"

- [x] [ARTIFACT] `scripts/preview-deploy.sh` 存在且实现 `--print-port` CLI 接口
  Test: node -e "const c=require('fs').readFileSync('scripts/preview-deploy.sh','utf8');if(!c.includes('--print-port'))process.exit(1)"

- [x] [ARTIFACT] `scripts/preview-cleanup.sh` 存在且含进程停止逻辑
  Test: node -e "const c=require('fs').readFileSync('scripts/preview-cleanup.sh','utf8');if(!/kill|pkill|stop/i.test(c))process.exit(1)"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] `preview-deploy.yml` 包含 `pull_request` trigger + `opened`/`synchronize` 事件类型，确保 PR push 时自动触发；main 分支推送不触发（通过 PR-only trigger 或 branches-ignore 实现）
  Test: manual:bash -c 'grep -qE "pull_request" .github/workflows/preview-deploy.yml && grep -qE "opened|synchronize" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR trigger 或事件类型"; exit 1; }; grep -qE "push:" .github/workflows/preview-deploy.yml && grep -qE "^\s*-\s*main\b" .github/workflows/preview-deploy.yml && ! grep -qE "branches-ignore" .github/workflows/preview-deploy.yml && { echo "FAIL: push trigger 未排除 main"; exit 1; } || true; echo OK'
  期望: OK

- [x] [BEHAVIOR] `preview-deploy.yml` 包含 `pull-requests: write` 权限声明，允许 CI 向 PR 写评论
  Test: manual:bash -c 'grep -qE "pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull-requests write 权限"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] `preview-deploy.yml` 包含 SSH 部署步骤并引用 hk-vps SSH key secret
  Test: manual:bash -c 'grep -qE "ssh|appleboy/ssh-action|SSH_ACTION" .github/workflows/preview-deploy.yml && grep -qE "HK_VPS|SSH_KEY|PREVIEW_SSH" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 SSH 步骤或 key secret"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] `preview-deploy.yml` 包含 preview URL health check 步骤，在 PR comment 写入之前执行；health check 失败则不写入有效 URL（Step 5 核心约束）
  Test: manual:bash -c 'grep -qiE "healthcheck|health.check|health_check" .github/workflows/preview-deploy.yml || grep -qE "preview.*http|http.*preview" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 preview URL health check 步骤"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] `preview-deploy.yml` 包含 `if: failure()` 条件步骤，部署/health check 失败时向 PR 写明失败原因（error path — PRD NFR 约束）
  Test: manual:bash -c 'grep -qE "failure\(\)|if.*failure" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 failure() 错误评论步骤"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] `preview-cleanup.yml` 包含 `closed` PR 事件 trigger，确保 PR merge 或 close 时触发清理
  Test: manual:bash -c 'grep -qE "pull_request" .github/workflows/preview-cleanup.yml && grep -qE "closed" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 cleanup closed trigger"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] `scripts/preview-deploy.sh` 含端口哈希计算逻辑（范围 8000-8999）+ 实现 `--print-port <BRANCH>` CLI 接口（stdout 输出4位端口，exit 0）；同 branch 幂等，多 PR 并发端口独立
  Test: manual:bash -c 'grep -qE "\-\-print-port" scripts/preview-deploy.sh || { echo "FAIL: 缺 --print-port 接口"; exit 1; }; grep -qE "8[0-9]{3}|% 1000|8000.*8999" scripts/preview-deploy.sh || { echo "FAIL: 缺 8000-8999 端口范围定义"; exit 1; }; PORT=$(bash scripts/preview-deploy.sh --print-port "cp-test-abc" 2>/dev/null); echo "$PORT" | grep -qE "^[0-9]{4}$" || { echo "FAIL: --print-port 输出非4位数字"; exit 1; }; [ "$PORT" -ge 8000 ] && [ "$PORT" -le 8999 ] || { echo "FAIL: 端口超范围 PORT=$PORT"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] `preview-deploy.yml` 包含 PR comment 写入步骤（`github-script` 或等效），写入含预览 URL 的评论（仅在 health check 成功后执行）
  Test: manual:bash -c 'grep -qE "github-script|create-comment|comment.*body|pr.*comment" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR comment 写入步骤"; exit 1; }; echo OK'
  期望: OK

---

## 接缝清单（dev_pipeline — 逻辑 vs 环境边界）

本 sprint 接缝全部属于 **CI/外部系统接缝**：

1. **GitHub Actions 触发器** — 接缝：`pull_request` 事件真实触发，main 推送真实不触发 → 真目标验证：合并后在真实 PR 上推送 commit，GitHub Actions 页面确认 preview-deploy workflow 进入队列，且向 main 推送时不出现。CI runner 内部逻辑属逻辑层，workflow 文件内容正确即可。

2. **hk-vps SSH 连接 + preview URL HTTP 200** — 接缝：SSH secret 可达 hk-vps + 静态服务启动后 curl 真实返回 200 → 真目标验证：Scenario 3（需 GH_TOKEN）通过 GitHub API 查看 workflow run 结果（success/failure）间接验证；直接 HTTP 200 测试需 hk-vps 网络访问权限（超出 local_api 范围）。

3. **PR comment 真实写入 GitHub** — 接缝：GitHub API `pull-requests: write` 权限 + comment 写入成功 → 真目标验证：Scenario 3（GH_TOKEN 必须提供，exit 1 如缺失）通过 GitHub API 检查 PR comment 存在。此接缝为核心终态验收点，GH_TOKEN 缺失 = 评估环境未就绪 = FAIL。

**logic-done-pending 标注规则**：
- 接缝 1/2/3 在 workflow 文件合并 + 真实 PR 触发后才能真机验证。
- Scenario 1（文件结构静态检查）和 Scenario 2（--print-port 本地执行）标 **logic-done**。
- 接缝 2 的 HTTP 200 真实可访问性标 **logic-done-pending**（需 hk-vps 网络访问）。
- 接缝 3 的 PR comment 写入标 **logic-done-pending**（需 GH_TOKEN + 真实 PR 触发后 Scenario 3 验证）。
