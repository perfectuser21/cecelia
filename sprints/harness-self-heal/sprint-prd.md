# Sprint PRD — Harness Pipeline 自愈监控

## OKR 对齐

- **对应 KR**：Harness 可靠性（pipeline 卡死自动恢复率 → 100%）
- **当前进度**：现有 watchdog 仅标 deadline 超时 failed，无容器健康检查、无 LLM 介入
- **本次推进预期**：30s 内检测卡死 → LLM 先诊断修复 → 修不好才 Bark

## 背景

Brain 现有 `harness-watchdog.js` 只做 deadline 超时扫描（phase=failed），
不检查 docker 容器是否存活，不召唤 LLM 诊断，也无 Bark 推送。
pipeline 卡死后全靠人工发现。本 sprint 补全这条自愈链路。

## Golden Path（核心场景）

系统从 [Brain tick 30s 轮询] → 经过 [容器健康检查 → harness_intervention 任务 → LLM 读日志诊断 → 尝试外部操作解除] → 到达 [pipeline 恢复 或 Bark 告警]

具体：
1. Brain tick 每 30s 执行一次 `harness-container-monitor`（MINIMAL_MODE 跳过）
2. 监控检测到以下任一异常：容器 exited、Claude 进程死但容器活、容器活但在等已失败的 CI
3. Brain 派出 `harness_intervention` 任务（task_type，写入 LOCATION_MAP，location=us）
4. Intervention Skill 读容器最后 200 行日志 + Brain checkpoint + sprint 合同文件
5. 识别卡死类型：CI 未触发 / PR 未推 / Brain 状态错误 → 执行对应外部操作
6. 等 30s 验证 pipeline 是否恢复（容器重新有日志输出）
7. 未恢复 → 发送 Bark 告警（token 存 `packages/brain/.env: BARK_TOKEN`）
8. 每次介入结果写入 Brain `cecelia_events`（intervention_result）

## Response Schema

N/A — 任务无 HTTP 响应（纯 Brain 内部监控 + Skill 执行，无新 REST endpoint）

## 边界情况

- docker CLI 不可用 → monitor 跳过容器检查，仅记录 warn 日志
- Brain API 不可达（5221）→ Intervention Skill 跳过 checkpoint 读取，仍尝试其他修复
- 同一 initiative 已有进行中的 intervention → 跳过重复派发（幂等保护）
- Bark token 未配置 → 降级到飞书告警，都无则写 DB cecelia_events 留记录

## 范围限定

**在范围内**：
- WS1：`packages/brain/src/harness-container-monitor.js`（新建，30s throttle）
- WS1：`tick-runner.js` 注册新 monitor（MINIMAL_MODE 跳过）
- WS1：LOCATION_MAP 新增 `harness_intervention` 条目（location=us）
- WS1：`packages/brain/.env` 写入 BARK_TOKEN
- WS2：`packages/engine/skills/harness-intervention/SKILL.md`（新建）

**不在范围内**：
- regression test 自动写入（后续 sprint）
- 非 `harness_initiative` 类型任务的监控
- 容器资源限制检测（CPU/内存）

## 假设

- [ASSUMPTION: docker 命令在 Brain 运行环境可用，`docker ps` 有权限]
- [ASSUMPTION: harness runner 容器命名规则为 `harness-*`（用于 filter）]
- [ASSUMPTION: initiative_runs 表已有 checkpoint 字段或单独 checkpoints 表]
- [ASSUMPTION: BARK_TOKEN=QU7ktbzPJxZbNx9pEHcstW（PrepPRD 明确）]

## 预期受影响文件

- `packages/brain/src/harness-container-monitor.js`：新建，容器健康检查逻辑
- `packages/brain/src/tick-runner.js`：注册 harness-container-monitor（30s）
- `packages/brain/src/task-router.js`：LOCATION_MAP 增加 `harness_intervention`
- `packages/brain/.env`：新增 BARK_TOKEN 行
- `packages/engine/skills/harness-intervention/SKILL.md`：新建 Intervention Skill

## journey_type: autonomous
## journey_type_reason: 主流程由 Brain tick 30s 轮询触发，无用户交互界面
## target_environment: local_api
## target_environment_reason: 验证依赖 docker CLI + curl localhost:5221（Brain API）+ psql，全在本机执行
