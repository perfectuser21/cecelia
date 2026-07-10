# 小改动 PrepPRD：九要素T7 phase-event 复活 + zombie-reaper 心跳判活

任务：e6081739-4bd5-4828-9a18-52362ad12709（plan=nine-elements-integrity seq=7）
设计依据：docs/architecture/2026-07-10-nine-elements-integrity/addendum-01-execution-telemetry-and-inbox.md（已批准，PR #3731 系列）

## 改什么

**改动 1（zenithjoy-skills repo，独立 PR）**：`harness-controller/SKILL.md`
- 每个阶段派 subagent（planner/proposer/reviewer/generator/evaluator/report）前后插入固定 curl：
  - 派发前 `POST $BRAIN/api/brain/harness/phase-event` body={initiative_id:$HARNESS_INITIATIVE_ID, node:<阶段名>, status:"running", model:<档位>} → 记下返回 id
  - subagent 返回后 `PATCH $BRAIN/api/brain/harness/phase-event/<id>` body={status:"done"|"failed", ts_end, cost_usd}
- 版本 bump 1.1.0 → 1.2.0 + changelog

**改动 2（cecelia repo，本 PR）**：`packages/brain/src/zombie-reaper.js`
- 判活叠加第二信号：assessTaskLiveness 判 dead 后、处置前，查 `initiative_run_events WHERE initiative_id = task.id` 最近心跳（GREATEST(ts, ts_end)），心跳在 idle 窗口内 → 跳过不杀（任一信号活即不判死，先叠加不替换）

## 为什么改
- initiative_run_events 07-04 起零写入（LangGraph→skill-relay 切换遗留），API 端点在（harness.js:1713/1740）但没人调用
- updated_at 单一判活是 07-10 两次 T5/T6 误杀的根因之一；phase-event 心跳是"任务真的在动"的更强信号

## 关联上下文
- 决策已在 addendum-01 关键决策表拍板：phase-event 由 skill 显式 curl 自报（选项B）；reaper 判活先叠加不替换（选项B）
- initiative_id=task.id 映射：harness-skill-relay.js:244 + B51 测试断言

## 影响范围
- zombie-reaper 只会更保守（多一条豁免路径），不会多杀
- 非 harness 任务无 initiative_run_events 行 → 行为完全不变
- skill 改动只影响 harness relay 会话的可观测性，不改业务逻辑

## 验收标准
- [ ] failing test 先 commit：zombie-reaper 单测覆盖「updated_at 过期但 phase-event 心跳新鲜 → 不杀」
- [ ] 修复代码让 test 变绿
- [ ] 既有 zombie-reaper 行为回归不破（心跳缺失/过期时仍按原逻辑处置）
- [ ] zenithjoy-skills PR：harness-controller SKILL.md 各阶段含 POST/PATCH phase-event 指令，版本 1.2.0
- [ ] CI 全绿
