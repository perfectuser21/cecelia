# Sprint PRD — Harness v7 Docker Sandbox 隔离 + 精确资源调度

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 88%（Harness 从"能跑"到"稳定跑"，覆盖可靠性+资源管理两个维度）
- **说明**：Harness Pipeline 完成率从 ~20% 提升至 >=85% 是"系统可信赖"的关键里程碑

## 背景

Harness Pipeline v5.0-v6.0 经过 11 个 PR 已能跑通单个 Pipeline，但实测完成率仅 ~20%（10 次启动中 8 次需人工干预）。根因不是单一 bug，而是架构模式问题：所有 task 共享 Brain 进程和 slot 池，slot 是抽象数字不对应真实资源（16 个 slot 但实际一个 claude 进程吃 400MB），worktree 只隔离文件系统不隔离进程/内存/CPU。

本次 Sprint 通过 Docker 容器化实现真正的进程隔离，配合基于真实内存的资源调度，让 Pipeline "进去就跑完"。

## 目标

将 Harness Pipeline 从"能跑但脆弱"提升为"自动化隧道"——提交任务后无需人工干预即可完成全流程，同时消灭孤儿进程/worktree 问题。

## User Stories

**US-001**（P0）: 作为 Cecelia Brain，我希望每个 harness task 在独立的 Docker 容器中执行，以便任务间互不干扰、结束自动清理、Brain 重启不影响正在运行的任务。

**US-002**（P0）: 作为 Cecelia Brain，我希望按真实内存用量（而非抽象 slot 数）调度任务派发，以便避免 OOM 且最大化资源利用率。

**US-003**（P1）: 作为 Cecelia Brain，我希望 task_run_metrics 记录真实的 peak_rss_mb（包括 claude 子进程），以便资源调度和容量规划有准确数据支撑。

**US-004**（P1）: 作为运维人员，我希望有 Harness Pipeline 健康监控端点和可视化页面，以便及时发现卡住的 pipeline、容器失败趋势和资源瓶颈。

## 验收场景（Given-When-Then）

**场景 1**（关联 US-003 — 内存采集修复）:
- **Given** Brain executor 的 `_pollResourceAsync` 已修复为递归统计子进程内存
- **When** 运行 5 个 harness task 并完成
- **Then** task_run_metrics 中 peak_rss_mb 值在 300-800 MB 范围（不再是固定的 2）

**场景 2**（关联 US-001 — Docker 容器化）:
- **Given** `HARNESS_DOCKER_ENABLED=true` 且 Docker daemon 正在运行
- **When** Brain 派发一个 harness task
- **Then** task 在独立 Docker 容器中执行，容器有 `--memory` 和 `--cpus` 限制，任务结束后容器自动销毁（`docker ps -a` 中无残留）

**场景 3**（关联 US-001 — 向后兼容）:
- **Given** `HARNESS_DOCKER_ENABLED=false` 或未设置
- **When** Brain 派发一个 harness task
- **Then** task 以现有的 `setsid bash -c ... claude -p` 方式执行，行为不变

**场景 4**（关联 US-002 — 内存调度）:
- **Given** 已分配容器总内存为 11.5 GB（接近 12 GB 上限）
- **When** 一个 normal（1 GB）任务请求派发
- **Then** Brain 拒绝派发，任务进入等待队列；待某容器结束释放内存后自动触发队列检查并派发

**场景 5**（关联 US-002 — 池隔离）:
- **Given** Pool C（其他）已满（4 GB 占满），Pool B（Harness）还有空间
- **When** 一个 harness task 请求派发
- **Then** harness task 正常派发到 Pool B，不受 Pool C 满载影响

**场景 6**（关联 US-004 — 监控端点）:
- **Given** 一个 pipeline 超过 6 小时无进展
- **When** 调用 `GET /api/brain/harness/pipeline-health`
- **Then** 返回结果中该 pipeline 标记为 `pipeline_stuck: true`，附带最后活跃时间

**场景 7**（关联 US-004 — 监控页面）:
- **Given** Dashboard Harness 监控页已部署
- **When** 运维人员访问该页面
- **Then** 可以看到运行中 pipeline 的容器状态、资源用量、失败率趋势图

## 功能需求

- **FR-001**: `_pollResourceAsync` 递归统计主进程及所有子进程的 RSS 内存，写入 task_run_metrics.peak_rss_mb
- **FR-002**: 新增 `docker/harness-runner/Dockerfile`，预装 claude CLI 和 Node.js 运行时
- **FR-003**: `cecelia-run.sh` 在 `HARNESS_DOCKER_ENABLED=true` 时用 `docker run --rm --memory=Xm --cpus=Y` 替换 `setsid bash -c ... claude -p`
- **FR-004**: `executor.js` 新增 `CONTAINER_SIZES` 常量，按 task_type 映射容器规格（light/normal/heavy）
- **FR-005**: `tick.js` slot-allocator 从 `MAX_SEATS=16` 改为 `TOTAL_CONTAINER_MEMORY_MB=12288`，派发前检查 `availableMemory >= CONTAINER_SIZES[task_type]`
- **FR-006**: 三池隔离：Pool A（前台 2 GB）、Pool B（Harness 6 GB）、Pool C（其他 4 GB），池间资源不互借
- **FR-007**: 新增 `GET /api/brain/harness/pipeline-health` 端点，返回 pipeline_stuck 检测、容器失败率、资源用量 histogram
- **FR-008**: Dashboard 新增 Harness 监控页，展示 pipeline 容器状态、资源用量、失败率可视化

## 成功标准

- **SC-001**: 修复后跑 5 个 harness task，peak_rss_mb 在 300-800 MB 范围（非固定 2）
- **SC-002**: 单个 harness task 在 Docker 容器中跑通，结束后容器自动销毁
- **SC-003**: `HARNESS_DOCKER_ENABLED=false` 时行为与现有完全一致（向后兼容）
- **SC-004**: 并发派发 20 个任务不 OOM，池间不互相挤占
- **SC-005**: pipeline_stuck 检测正确识别 >6h 无进展的 pipeline
- **SC-006**: Dashboard 监控页可视化运行中 pipeline 的容器状态和资源用量

## 假设

- [ASSUMPTION: Docker daemon 已在 Mac mini 上安装并运行，无需本 Sprint 处理安装]
- [ASSUMPTION: host.docker.internal 可从容器内访问 Brain API（Docker Desktop 原生支持）]
- [ASSUMPTION: 容器启动失败时回退到 non-docker 模式执行，而非直接标记任务失败]
- [ASSUMPTION: macOS `ps` 命令支持 `--ppid` 参数或等效的子进程查询方式]
- [ASSUMPTION: 容器镜像初次构建后缓存在本地，后续启动延迟 <2s 可忽略]
- [ASSUMPTION: 12 GB 可分配内存基于 Mac mini 16 GB 物理内存扣除 Brain 2 GB + OS 2 GB]

## 边界情况

- Docker daemon 未运行或不可用时，Brain 应检测并回退到 non-docker 模式（通过 `HARNESS_DOCKER_ENABLED` 环境变量控制）
- 容器被 OOM killer 杀掉时，Brain 需检测退出码并在 task_run_metrics 中记录失败原因
- Brain 重启期间正在运行的容器：容器独立于 Brain 进程，Brain 重启后通过 `docker ps` 恢复状态
- 三池同时满载：所有新任务排队，不允许借用其他池的资源
- 镜像不存在或损坏：首次运行时自动 `docker build`，或提示运维人员手动构建

## 范围限定

**在范围内**:
- 修复 task_run_metrics 内存采集 bug（递归统计子进程）
- Docker 容器化：Dockerfile + cecelia-run.sh 改造 + CONTAINER_SIZES 常量
- Brain 资源调度从 slot 改为基于内存的三池模型
- Harness 监控端点 + Dashboard 可视化页面
- 向后兼容：HARNESS_DOCKER_ENABLED 环境变量开关

**不在范围内**:
- Kubernetes 编排或任何云容器服务
- 容器镜像 CI/CD（自动构建+推 registry）— 后续迭代
- 非 harness 任务的容器化（如 content-pipeline）
- 容器网络隔离（当前容器需要访问 Brain API）
- Docker Compose 编排多容器（每个任务独立 `docker run`）

## 预期受影响文件

- `packages/brain/src/executor.js`：修复 `_pollResourceAsync` 内存采集 + 新增 `CONTAINER_SIZES` 常量
- `packages/brain/scripts/cecelia-run.sh`：`setsid` → `docker run` 改造
- `packages/brain/src/tick.js`：slot-allocator 从 MAX_SEATS 改为内存调度 + 三池隔离
- `docker/harness-runner/Dockerfile`：新增容器镜像定义
- `packages/brain/src/server.js`：注册 `/api/brain/harness/pipeline-health` 端点
- `apps/dashboard/`：新增 Harness 监控页面组件

## PR 拆分计划

| PR | 标题 | 依赖 | 核心交付 |
|----|------|------|----------|
| PR 1 | 修 task_run_metrics 内存采集 Bug | 无 | peak_rss_mb 真实值 |
| PR 2 | Docker Sandbox 化 | PR 1（需要真实内存数据验证容器限额） | Dockerfile + docker run + CONTAINER_SIZES |
| PR 3 | Brain 资源调度从 slot 改为 memory | PR 2（需要 CONTAINER_SIZES 常量） | 内存调度 + 三池隔离 |
| PR 4 | Harness 监控 | PR 2+3（需要容器状态数据） | 健康端点 + Dashboard 页面 |
