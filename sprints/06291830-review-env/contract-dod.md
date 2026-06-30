---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: per-branch Review 预览环境

**范围**: 新建 `.github/workflows/preview-deploy.yml` + `.github/workflows/preview-cleanup.yml` + `scripts/preview-deploy.sh` + `scripts/preview-cleanup.sh`，实现 PR branch push → dashboard 自动预览部署到 hk-vps 唯一端口 → PR 评论写入 URL → PR close/merge → 自动清理
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/preview-deploy.yml` 存在（新建 CI workflow）
  Test: node -e "require('fs').accessSync('.github/workflows/preview-deploy.yml')"

- [ ] [ARTIFACT] `.github/workflows/preview-cleanup.yml` 存在（新建清理 workflow）
  Test: node -e "require('fs').accessSync('.github/workflows/preview-cleanup.yml')"

- [ ] [ARTIFACT] `scripts/preview-deploy.sh` 存在（可执行部署脚本）
  Test: node -e "require('fs').accessSync('scripts/preview-deploy.sh')"

- [ ] [ARTIFACT] `scripts/preview-cleanup.sh` 存在（可执行清理脚本）
  Test: node -e "require('fs').accessSync('scripts/preview-cleanup.sh')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] `preview-deploy.yml` 包含 `pull_request` trigger + `opened`/`synchronize` 事件类型，确保 PR push 时自动触发
  Test: manual:bash -c 'grep -qE "pull_request" .github/workflows/preview-deploy.yml && grep -qE "opened|synchronize" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR trigger 或事件类型"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `preview-deploy.yml` 包含 `pull-requests: write` 权限声明，允许 CI 向 PR 写评论
  Test: manual:bash -c 'grep -qE "pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull-requests write 权限"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `preview-deploy.yml` 包含 SSH 部署步骤并引用 hk-vps SSH key secret
  Test: manual:bash -c 'grep -qE "ssh|appleboy/ssh-action|SSH_ACTION" .github/workflows/preview-deploy.yml && grep -qE "HK_VPS|SSH_KEY|PREVIEW_SSH" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 SSH 步骤或 key secret"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `preview-deploy.yml` 包含 `if: failure()` 条件步骤，部署失败时向 PR 写明失败原因（error path — PRD NFR 约束）
  Test: manual:bash -c 'grep -qE "failure\(\)|if.*failure" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 failure() 错误评论步骤"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `preview-cleanup.yml` 包含 `closed` PR 事件 trigger，确保 PR merge 或 close 时触发清理
  Test: manual:bash -c 'grep -qE "pull_request" .github/workflows/preview-cleanup.yml && grep -qE "closed" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 cleanup closed trigger"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `scripts/preview-deploy.sh` 含端口哈希计算逻辑（范围 8000-8999），确保同 branch 幂等、多 PR 并发不冲突
  Test: manual:bash -c 'grep -qE "8[0-9]{3}|PORT_MIN.*8000|PORT_MAX.*8999|% 1000" scripts/preview-deploy.sh || { echo "FAIL: 缺 8000-8999 端口范围定义"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `preview-deploy.yml` 包含 PR comment 写入步骤（`github-script` 或等效），写入含预览 URL 的评论
  Test: manual:bash -c 'grep -qE "github-script|create-comment|comment.*body|pr.*comment" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR comment 写入步骤"; exit 1; }; echo OK'
  期望: OK

---

## 接缝清单（dev_pipeline 特殊接缝 — 逻辑 vs 环境边界）

本 sprint 接缝全部属于 **CI/外部系统接缝**：

1. **GitHub Actions 触发器** — 接缝：`push` / `pull_request` 事件是否真实触发 → 真目标验证：创建真实 PR 后在 GitHub Actions 页面确认 workflow 进入队列。CI runner 内部逻辑（yaml 解析/步骤执行）属逻辑层，workflow 文件内容正确即可。
2. **hk-vps SSH 连接** — 接缝：SSH secret + Tailscale 网络是否可达 hk-vps → 真目标验证：evaluator 在本机 curl GitHub API 看 workflow run 结果（success/failure）。SSH 能否连通属真机接缝，合同 E2E Scenario 3 通过 GitHub API 间接验证 workflow 成功执行。
3. **PR comment 写入** — 接缝：GitHub API 写评论权限是否授予 → 真目标验证：Scenario 3 通过 `GH_TOKEN` curl GitHub API 验证 comment 是否存在。

**logic-done-pending 标注规则**：
- 接缝 1/2/3 在 workflow 文件合并后才能真机验证（需要真实 PR + GH Actions 运行）。
- workflow 文件结构验证（Scenario 1/2）可在本地验证，标 **logic-done**。
- 真实端到端（PR 触发 → comment 写入）标 **logic-done-pending**，需合并后 evaluator 用 `GH_TOKEN` 触发 Scenario 3 验证。
