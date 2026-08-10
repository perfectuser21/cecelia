---
id: cp-08092319-kernel-gear-dispatch-28d184cb
task_id: 28d184cb-4a22-439f-8afb-d84438a10030
created: 2026-08-09
category: harness-kernel
---

# Learning — kernel 真读 gear：三档在 orchestrator 状态机内分流

## 背景

harness gear 三档（default/hotfix/segmented）此前只被注进旧 relay 路径的 prompt/env
（`harness-skill-relay.js:581,636`），由 `harness-controller/SKILL.md` 这个**提示词**消费。
kernel-v1 走 `orchestrator/derive.js` 纯函数状态机，不读 controller SKILL——全 `orchestrator/`
目录 grep gear = 0 命中。后果：kernel 跑的每一条都是裸 default，近 30 天 192 条 kernel run
里标 gear=hotfix 的 1 条也没被读。

## 根本原因（一句话）

「档位被写进提示词」≠「档位被状态机读取」。同一份 gear 字段，relay 路径由 controller 的
自然语言约束消费，kernel 路径由确定性纯函数消费——两条路径共享字段却不共享执行语义，
kernel 侧漏读就让整套分档在 kernel 上形同虚设。

## 修法（三处接线，一条主干）

1. **持久化**：`initiative_runs` 新增可空 `gear` 列（migration 396）；`kernel-run-store.createKernelRun`
   INSERT 增写；`harness-skill-relay` 建 run 时 `deriveGear(task)` 读档传入。缺省写 NULL = default 语义。
2. **注入**：`ground-truth.collectGroundTruth` 每跳把 `run.gear ?? 'default'` 注入 `observed.gear`
   （**可选**字段，不进 derive 的 REQUIRED_FIELDS——否则 100+ 存量 derive 用例全炸）。
3. **分叉**：`derive.js` 在所有 gear 无关守卫（terminal/merged/callback/inflight…）之后、planning 门
   之前插一段分叉：非法 gear→`mark_failed invalid_gear`（fail-closed，对齐 executor.js）；
   hotfix 初始态→直进 generate（跳 planner/GAN，保留 generator→evaluator→judge）；
   default/segmented/缺省→落现行 planning 门（逐字节等价，零回归）。

## 可复用的坑

- **纯函数别 import 有 DB 副作用的模块**：`GEAR_VALUES` 的 SSOT 在 `harness-skill-relay.js`，
  但它顶层 `import pool from './db.js'`。derive 是纯函数（还有纯函数测试），直接复用会把 DB 依赖
  拖进来。这里按值在 derive.js 复制同一枚举（3 个字面量），由评审/回归守卫保持两端一致，
  比 import 更符合「纯函数状态机」的边界。
- **零回归靠「新分支对 default 是 no-op」**：gear 分叉只在 `gear!=='default'` 时改变输出，
  default 路径一行不碰；`derive.test.js` 93 例全绿即零回归的机械证据。
- **可选 observed 字段的正确姿势**：新增跨模块传递字段时，如果它有安全默认（gear→default），
  就别塞进 fail-fast 的 REQUIRED_FIELDS，用 `?? 'default'` 兜底，存量用例零改动。
