# PrepPRD：九要素 T4 — 回执 collector

任务：213e2122-1085-4c20-8001-e1bc3bf58de7（plan nine-elements-integrity seq=4）
设计：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md + PR #3731
Spec：docs/superpowers/specs/2026-07-10-t4-receipt-collector-design.md

## 本次要做的
对外动作"发出即成功"是谎言。三入口（notifier 飞书/Bark、feishu-alert skill_eval 告警、
deploy webhook 生产/staging 部署）发送后写 action_receipts(pending)，按真实结果核销
confirmed/failed；无人核销的由 tick job 超 30min 标 timeout；作战日报新增
"未确认动作（24h）"段，主理人每天能看到哪些动作发出去了但效果没确认。

## 完成后用户能
1. 在作战日报里看到 24h 内所有未确认的对外动作（kind/target/状态/时间）
2. ledger-hygiene 指标3（回执核销率）自动激活，欠账进棘轮
3. psql 查 action_receipts 能审计每次飞书/Bark/部署的真实结果

## 不包含
- 回执独立告警（走 T1 棘轮）
- pr_merge 等其他动作接入（留后续）
- 主动探测确认（首版核销只靠入口回调 + 超时）
