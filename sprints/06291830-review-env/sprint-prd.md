# Sprint PRD — evaluator PASS 后自动分配端口启动 Dashboard 静态 Review 环境

## OKR 对齐

- **对应 KR**：Harness Pipeline 自动化验收闭环
- **当前进度**：待 Brain context 同步
- **本次推进预期**：为每个 evaluator PASS 的 PR 提供可浏览的 Dashboard Review 环境

## 背景

Harness evaluator PASS 后，人工验收者需要一个可直接访问的 Dashboard 静态服务，才能在浏览器里核查 UI 变化。现在没有自动化的 Review 环境，验收者只能在本机手动 build + serve，效率低且容易漏验。本次 sprint 让 Brain 在 evaluator PASS 时自动分配 5300-5399 段内一个空闲端口、启动 Dashboard 静态服务；PR close（合并或拒绝）后自动停止服务并释放端口。

## Golden Path（核心场景）

验收者从 [evaluator PASS 通知] → 经过 [Brain 自动分配端口并启动服务] → 到达 [在浏览器打开 localhost:53xx 看到 Dashboard]；PR close 后服务自动停止、端口归还。

具体：
1. evaluator 回调写入 verdict=PASS，Brain 接收 PASS 事件
2. Brain 在 5300-5399 范围内扫描空闲端口，记录分配结果（initiative_id → port）到持久化存储
3. Brain 在分配的端口上启动 Dashboard 静态文件服务（服务目录：apps/dashboard 的 build 产物）
4. 验收者打开 `http://localhost:<port>` 看到 Dashboard 页面
5. shepherd 检测到 PR state = CLOSED（合并或关闭），触发端口释放：停止静态服务进程、从存储中移除该分配记录
6. 端口归还到空闲池，可被下一个 PASS 的 initiative 使用

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：端口分配 + 服务启动须在 evaluator PASS 回调 10 秒内完成
- 端口范围：严格限制在 5300-5399（共 100 个槽位），满槽时 PASS 事件仍正常完成，仅跳过 Review 环境并记录日志
- 可观测：端口分配/释放必须写 Brain 日志（console.log + db 记录）；服务进程 pid 须持久化，防止进程孤立
- 版本要求：不依赖额外 npm 包，使用 Node.js 内置 `http`/`fs`/`path` 或已有依赖

## 边界情况

- 端口范围已全部占用：跳过启动，写日志 `[review-env] 端口耗尽（5300-5399 已满）`，不影响 evaluator PASS 主流程
- Dashboard build 产物不存在（未构建）：跳过启动，写日志 `[review-env] Dashboard dist 目录不存在，跳过`
- PR close 时服务进程已死（意外崩溃）：仅清除 DB 记录，不报错
- 同一 initiative 二次 PASS（fix 轮重测）：释放旧端口再重新分配，不累积孤立进程
- Brain 重启：Brain 重启后从 DB 恢复 pid 列表，尝试 kill 孤立进程；端口记录随之清空（已服务的进程视为失效）

## 范围限定

**在范围内**：
- evaluator PASS 触发端口分配 + Node.js 静态文件服务器启动
- PR close（shepherd 检测）触发停止服务 + 端口释放
- 端口分配记录持久化（DB 表或内存 + Brain 重启清理）
- 日志可观测

**不在范围内**：
- HTTPS / 反向代理 / 外网访问
- Dashboard 热重载（只需静态快照，不做 dev server）
- 跨机器部署（仅本机 localhost）
- 端口权限管理（不涉及防火墙）

## 假设

- [ASSUMPTION: Dashboard 在 evaluator PASS 时已有 build 产物（apps/dashboard/dist 或类似目录），否则跳过]
- [ASSUMPTION: 端口分配用 DB 表 `review_environments`（initiative_id, port, pid, allocated_at），Brain 已有 PostgreSQL 可直接建表]
- [ASSUMPTION: shepherd.js 的 PR close 检测（pr_status = 'closed'）是可靠的释放触发点]

## 预期受影响文件

- `packages/brain/src/review-env-manager.js`：新建，负责端口分配、静态服务启动、端口释放
- `packages/brain/src/shepherd.js`：在 pr_status = 'closed' 分支调用 `releaseReviewEnv(initiative_id)`
- `packages/brain/src/harness-judge.js` 或 evaluator PASS 回调处：在 verdict=PASS 时调用 `allocateReviewEnv(initiative_id)`
- `packages/brain/src/db.js` 或 migrations：新增 `review_environments` 表（若选 DB 持久化）

## E2E 验收

> E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql + shell 验证）。

```bash
# 占位：proposer 将填入真实脚本
# 期望验收点（自然语言）：
# 1. 模拟 evaluator PASS 回调 → Brain 分配一个 5300-5399 内的端口并启动静态服务
# 2. curl http://localhost:<allocated_port>/ 返回 HTTP 200 且响应含 HTML（Dashboard 页面）
# 3. 模拟 PR close（shepherd 检测到 CLOSED）→ 静态服务停止（curl 该端口超时或连接拒绝）
# 4. 端口从持久化记录中移除（DB 查询或内存状态无该记录）
```

## journey_type: user_facing
## journey_type_reason: 功能最终产物是在浏览器可访问的 Dashboard UI（apps/dashboard/）静态服务
## target_environment: local_api
## target_environment_reason: E2E 验证通过 curl localhost:53xx 确认静态服务可访问，并用 psql/日志验证端口分配/释放，无需 Playwright 浏览器
## journey_id: （来源 task.payload.journey_id，本次 PrepPRD 未提供，由 proposer 补全）
## step_id: （来源 PrepPRD Golden Path 锚定，本次未提供，由 proposer 补全）
