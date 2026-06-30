# Sprint PRD — per-branch Review 预览环境

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 质量提升
- **当前进度**：待查
- **本次推进预期**：为每个 PR/branch 提供独立可访问的预览环境，加速 review 效率

## 背景

当前 PR review 无自动化预览环境，reviewer 需本地拉 branch 手动运行才能验证变更。引入 per-branch 预览环境后，每次 push 到 PR branch，自动部署该 branch 的运行版本并产出可访问 URL，reviewer 直接点链接验证，无需本地搭环境。

## Golden Path（核心场景）

开发者从 [推送代码到 PR branch] → 经过 [CI 自动触发预览部署] → 到达 [PR 评论区出现可访问的预览 URL]

具体：
1. 开发者向 `cp-*` 或 `feature/*` branch 推送 commit，或打开/更新 PR
2. GitHub Actions 检测到 PR 事件，拉取该 branch 代码，启动预览部署流程
3. 部署完成后，CI 向 PR 写入评论或更新 GitHub Environment，附上该 branch 的预览访问 URL
4. Reviewer 点击 URL，可访问该 branch 当前版本（Dashboard 或 Brain API）
5. PR merge 或 close 后，预览环境自动清理，占用资源释放

## 边界情况

- 多个 PR 并发时：各自独立端口/命名空间，互不干扰
- Branch 删除：清理 job 触发，预览环境销毁
- 部署失败：PR 评论标注失败原因，不产出无效 URL
- main 分支推送：不触发 per-branch 预览（main 走 staging/prod 流程）

## 范围限定

**在范围内**：
- GitHub Actions workflow 实现 per-branch 预览部署触发逻辑
- PR 评论写入预览 URL（或 GitHub Environments 集成）
- Branch merge/close 时自动清理预览环境

**不在范围内**：
- 生产环境部署变更
- 预览环境的权限控制（公开访问即可）
- 跨 PR 的环境共享
- 数据库数据隔离（共享只读 dev DB 或 mock 数据）

## 假设

- [ASSUMPTION: 预览部署目标为 hk-vps，通过 SSH 部署 + 动态端口隔离，或使用 GitHub Pages / Environments]
- [ASSUMPTION: 每个预览环境仅部署 apps/dashboard（React 静态构建），不含完整 Brain 后端]
- [ASSUMPTION: 端口分配规则由 branch name hash 决定，范围 8000-9000]
- [ASSUMPTION: 预览 URL 格式为 `http://hk-vps:<port>` 或 GitHub Environments 的标准 URL]
- [ASSUMPTION: CI 使用已有 hk-vps SSH key secret（已在 GitHub repo secrets 中配置）]

## 预期受影响文件

- `.github/workflows/preview-deploy.yml`：新增 per-branch 预览部署 workflow
- `.github/workflows/preview-cleanup.yml`：新增 branch close/merge 清理 workflow
- `scripts/preview-deploy.sh`：预览部署脚本（build + 上传 + 启动）
- `scripts/preview-cleanup.sh`：清理脚本（停止进程 + 删端口占用）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；建议部署超时 5 分钟）
- 频控: 待定（同一 branch 多次 push 是否防抖去重）
- 版本要求: 无特殊版本约束
- 可观测: 部署失败必须在 PR 评论中写明失败原因

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实验证脚本
# 期望验收点（自然语言）：
# 1. 向测试 branch push 一个 commit 后，GitHub Actions 触发 preview-deploy workflow
# 2. Workflow 执行成功（exit 0），PR 评论区出现含 URL 的预览链接
# 3. curl 该 URL 返回 HTTP 200（Dashboard 静态页面可访问）
# 4. 关闭 PR 后，cleanup workflow 触发，该端口不再响应
```

## journey_type: dev_pipeline
## journey_type_reason: 本 sprint 核心交付物是 GitHub Actions CI workflow 文件，属于开发流水线基础设施，归 packages/engine/ 职责范畴
## target_environment: local_api
## target_environment_reason: E2E 通过 curl GitHub API + 验证 PR comment 写入情况验证，在本地 evaluator 对 GitHub API 发请求即可；无需跑浏览器或远端 VM
## journey_id: （来源 task.payload.journey_id，Cecelia Harness Pipeline Line）
## step_id: （来源 PrepPRD Golden Path 锚定结果，待 proposer 补全）
