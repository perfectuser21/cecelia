# Sprint PRD — 实测各 harness 角色容器真实 RSS 峰值（跑到 evaluator 后即停）

## OKR 对齐

- **对应 KR**：KR-harness-observability（harness pipeline 资源画像）
- **当前进度**：未知（Brain context 不可达，HTTP 000）
- **本次推进预期**：补齐 planner/proposer/generator/evaluator 四角色真实内存基线

## 背景

harness pipeline 跑各角色（planner → proposer → generator → evaluator）时，每个角色起独立进程/容器。目前缺各角色真实 RSS 峰值数据，无法判断资源配额是否合理、是否存在内存膨胀。本 sprint 实测一次完整链路（跑到 evaluator 即停），拿到每个角色的真实 RSS 峰值基线。

## Golden Path（核心场景）

系统从 [触发一次测量 run] → 经过 [四角色依次执行 + 全程采样 RSS] → 到达 [输出每角色 RSS 峰值报告]

具体：
1. [触发条件] 启动一次 harness 测量 run（含 planner、proposer、generator、evaluator 四角色）
2. [系统处理] 每个角色容器/进程运行期间，按固定间隔采样其 RSS，记录该角色峰值
3. [范围控制] evaluator 角色执行完毕后 pipeline **即停**——不进入后续节点、不开 PR、不做 generator↔evaluator 多轮
4. [可观测结果] 产出一份报告，列出 4 个角色各自的真实 RSS 峰值（单位 MB）+ 采样次数 + run 时间戳

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范 -->

## 边界情况

- 某角色进程提前异常退出 → 报告标记该角色 `incomplete`，已采到的峰值仍记录
- 角色运行极短、采样间隔内未取到样本 → 至少取启动与退出两点，峰值不得为 0/空
- 多角色并发（若 pipeline 并行起进程）→ 各角色独立归集，峰值不串号

## 范围限定

**在范围内**：planner / proposer / generator / evaluator 四角色 RSS 峰值实测与报告；跑到 evaluator 即停。
**不在范围内**：CPU/磁盘/网络指标；evaluator 之后的节点（PR、回写、多轮 GAN）；资源配额调优或限额改动；长期监控接入。

## 假设

- [ASSUMPTION: "容器"指 harness 各角色实际运行的进程/容器，RSS 取该进程及其子进程的常驻内存]
- [ASSUMPTION: "跑到 evaluator 后即停"= evaluator 节点完成即终止本 run，不触发后续 pipeline]
- [ASSUMPTION: 报告落地位置为 Brain 可读处（DB 记录或 run 目录报告文件），由 Proposer 锚定]

## 预期受影响文件

- `packages/brain/src/`（harness 调度/执行链路）：插入 RSS 采样与"evaluator 后即停"控制点
- `sprints/`：测量报告产物落地

## NFR 约束

<!-- 来源: decisions 表 category=nfr（读取为空 []），PrepPRD 显式值优先 -->
- 超时/延迟：待定（PrepPRD 未指定）
- 采样间隔：待定（Proposer 阶段确认，建议亚秒级以捕捉峰值）
- 版本要求：无
- 可观测：测量失败必须写 Brain log；每角色峰值必须可被复查（DB 或报告文件）

## E2E 验收

> Planner 初稿留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql / 报告文件断言）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#   触发一次测量 run 后，能拿到一份报告，其中 planner/proposer/generator/evaluator
#   四角色各有一个 >0 的真实 RSS 峰值（MB）；run 在 evaluator 完成处即停，
#   报告中无 evaluator 之后节点的记录。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ harness 调度链路的内存实测，无 UI、无远端 agent 协议
## target_environment: local_api
## target_environment_reason: 测量本地 harness 角色进程/容器 RSS，evaluator 本地核验（curl localhost:5221 + psql + 报告文件）
## journey_id: cecelia-harness-pipeline（Line 唯一 = Harness Pipeline；Brain context 不可达，UUID 待 Proposer 锚定）
## step_id: 待 PrepPRD/Proposer 锚定（未提供 PrepPRD）
