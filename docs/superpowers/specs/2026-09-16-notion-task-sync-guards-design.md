# Notion 双向同步链守卫（notion-task-sync-guards）设计

任务：a17baa2c-ae59-439d-b332-7e65ff36fc2d ·「修复私人 Notion Task DB↔Brain tasks 双向同步死链」

## 背景（调查结论，推翻交接根因）

- 交接判断的根因「legacy-notion-push-scheduler.js 全库无人 import」**不成立**：`packages/brain/server.js:969` 自 2026-08-10 起动态 import 并调用 `scheduleLegacyNotionPush(pool)`；2026-09-14 起 scheduler 默认 run=`runPushAndPull`，push（含 pushTasks）与 pull（runNotionTaskPull）并联，每 5 分钟一轮。
- 真死因：`NOTION_LEGACY_PUSH_ENABLED=true` 于 2026-09-16 08:24 写入 us-vps `.env.docker`（备份文件为证），但容器未重启，env 未生效；当日 20:10 容器随其他部署重建后同步**已自愈**。
- 端到端实测（2026-09-16 21:38）：API 建 Delegated 测试行 → 5 分钟内 Brain 接手出 task `fdcf773e`（blocked/awaiting_execution_route，幂等指纹、notion_id 回填全部正确）→ 页面回执 `brain:<id> ✓已接管`。测试数据已清理。
- 交接误诊的方法论根源：在容器 `/app/src/` 下 grep import，而接线在 `/app/server.js`（包根）且为动态 import。

## 本 PR 范围（守卫补齐，不改行为）

同步链行为正确，不动。补两个 CI 回归守卫，堵「静默孤儿化」缺口（2026-09-08 ops 四库停更、本次误诊恐惧的复发路径）：

1. **T1 接线守卫**：断言 `server.js` 源码包含对 `./src/legacy-notion-push-scheduler.js` 的 import 与 `scheduleLegacyNotionPush(` 调用——任何重构把调度器摘出启动序列即红。（源码文本断言，repo 先例：`routes/notes.test.js` 对 DB ID 的 toContain 断言。）
2. **T2 默认并联守卫**：`vi.mock('./notion-push-sync.js')` 后不注入 `run` 调用 `scheduleLegacyNotionPush`，触发 interval 回调，断言 `runNotionPushSync` 与 `runNotionTaskPull` **都**被调用——任何改动把 pull 从默认链摘掉即红。（现有测试注入 run mock，守不住默认值。）

落点：扩充 `packages/brain/src/__tests__/legacy-notion-push-scheduler.test.js`。

## 测试策略

- 档位：unit/regression（纯逻辑接缝，CI test 恰当）。
- proven-to-fire：提交前 mutation 验红——临时注释 server.js 接线行跑 T1 见红、临时把 runPushAndPull 中 pull 行删掉跑 T2 见红，恢复后绿。验红过程记录在 PR 描述。
- 环境接缝（env 设了容器未重启）：启动日志已有 `[legacy-notion-push] enabled/disabled` 弱守卫；更强的 health 暴露超出本任务，不做（YAGNI）。

## 不包含

- 不接 scheduler-jobs.js（原 PrepPRD 修法基于错误根因；若执行会造成 legacy scheduler 与 scheduler-jobs 双调度竞态）
- 二期（员工表过滤投影）、三期（MMV worker）不在本 PR
- journeys 推送 404（父页面未共享给 integration）是另一个独立问题，不在本 PR
