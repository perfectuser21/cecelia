# Handoff：workflow_run 进账 + 排班员 v1 + 运行舱采集三连修（PR #5329/#5330/#5331/#5333/#5335）

**verdict: PASS**（1.293.1 上产，排班员 E2E 三路验证通过）

## 完成
- **运行舱采集断更 5 天根治（三层）**：①容器 ssh socket 目录 ro → tmpfs（#5329）②host-exec 逃逸 host.docker.internal 在 Linux 不解析 → CECELIA_HOST_EXEC_SSH 指 MMV（#5330）③OpenClaw 采集仍打 hk-vps 而容器已迁 us-vps → 本机 docker exec 直取 + migration 445 host_alias 迁移（#5331）。五腿心跳全 ok，22 数字员工心跳恢复；真相修正：获客画布一直在跑，账烂非画布死
- **一切执行进 tasks 账**（决策 2dbabb48，#5333）：派发即建 workflow_run task（operations 路线，source_id=run_id 幂等），syncOpenClawRuns 终态收账；migration 446 扩枚举
- **排班员 v1**（#5333）：同 workflow 在途互斥 ⏸（Delegated=天然队列，5min 重评自动放行）+ Plan Date 时间窗 🕐 + 回执防雪球 stripStatusTail
- **队列死锁修复**（#5335，E2E 当场抓到）：⏸ 文案含 run:notion- 污染幂等跳过正则 → 去 run: 前缀 + 回归断言
- E2E 生产验证：🕐 回执 ✅ / ⏸ 回执 ✅ / 假在途删除后自动重试试派 ✅（放行链证实）

## 没完成
- push 对 legacy notion_id（挂错库的旧页）报 400 "Status is expected to be select" 反复重试（19 行/轮刷 warn）——应视为 stale 链接解绑（同 404 isStaleRelationError 先例），未修
- 排班员 v2（填空档，需主理人拍各 workflow 频次上限+安全间隔）未做；常驻底噪计容量未做
- 金诺获客线 09-13 error（账修活后浮出）未查因

## 下一步
- 修 push 400 stale 解绑（小刀）；排班员 v2 待频次上限拍板；map 扫描器迁 us-vps（老遗留）

## 数据源
- packages/brain/src/notion-push-sync.js（pull/dispatch/排班闸/终态收账）、ops-collector.js、host-exec.js
- migrations 444/445/446；决策 2dbabb48（真相源分层+一切执行进账）
- ops_source_heartbeats（五腿心跳）；Notion Tasks 库 d5bc40c2-…

## 产物
- PR #5329/#5330/#5331/#5333/#5335 + bumps；生产 1.293.1
