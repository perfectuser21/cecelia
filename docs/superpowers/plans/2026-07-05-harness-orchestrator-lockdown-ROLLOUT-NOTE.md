# 部署协调说明：harness orchestrator 硬校验（2026-07-05）

## 背景

本 PR（cecelia 仓库，分支 `cp-0705102607-harness-orchestrator-lockdown`）在
`packages/brain/src/executor.js` 的 `_driveHarnessInitiative` 中新增了 N4
orchestrator 硬校验（核心实现见 commit `a55dbd272`
「feat(brain): harness_initiative 强制 orchestrator=skill-relay，废弃 LangGraph
图隐式兜底」）：任何 `harness_initiative` 任务，只要 `payload.orchestrator`
不等于字符串 `'skill-relay'`，会被立即标记为 `terminal failed`
（`missing_orchestrator_flag`），不再像以前那样隐式降级走 LangGraph 图兜底。

## 需要跨仓库协调的原因

Brain 运行时本身**没有**任何代码会在创建 `harness_initiative` 任务时自动带上
`orchestrator: 'skill-relay'`。真正的生产创建入口是 `/dev` 路径 C 的点火 curl
模板，但这个模板位于**另一个仓库** `zenithjoy-skills` 的
`dev/SKILL.md`（大约第 305-322 行，POST `localhost:5221/api/brain/tasks` 那段
payload 拼装处），不在本次 cecelia PR 的改动范围内，需要单独走
skill-creator 流程更新。

如果本 PR 先合并部署到生产，而 `zenithjoy-skills` 仓库那边的 `/dev` SKILL.md
更新还没跟上，就会出现一个部署窗口期：这段期间任何人通过 `/dev` 路径 C 点火
harness_initiative，请求 payload 里都不会带 `orchestrator` 字段，会 100%
被新硬校验拒绝并标 terminal failed，即 `/dev` 路径 C 完全不可用。

## 建议的部署顺序

两个仓库的改动必须作为**一次协调发布**处理，不能先合并本 PR、再慢慢弄
`zenithjoy-skills` 那边，二选一：

1. **推荐**：先确认并合并 `zenithjoy-skills` 侧的 `dev/SKILL.md` 更新（给路径
   C 点火 curl 模板的 payload 加上 `"orchestrator": "skill-relay"`），确认生效
   后，再部署/合并本 cecelia PR。
2. 或者：两边改动尽量安排在同一个较短的时间窗口内完成部署，将窗口期风险降到
   最低，并在部署前后各跑一次 `/dev` 路径 C 点火做冒烟验证。

## 涉及文件

- 本仓库（cecelia）：
  - `packages/brain/src/executor.js`（硬校验实现，commit `a55dbd272`）
  - `packages/brain/scripts/smoke/dispatcher-real-paths.sh`（Case C smoke 已
    补 `orchestrator` flag，避免 initiative-lock 测试假绿）
- 另一仓库（zenithjoy-skills，待单独处理，不在本 PR 范围）：
  - `dev/SKILL.md`（约第 305-322 行，路径 C 点火 curl 模板需要补
    `payload.orchestrator: 'skill-relay'`）
