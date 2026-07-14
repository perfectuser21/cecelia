# Bug PrepPRD：PR #3900 CI 三处红——KV 路由双实现分脑 + launchd manifest 断言过期

## 症状
PR #3900（载有刀3-T1 nightly 交付物）CI 红三处：kv-route-smoke.sh（GET 期望 404 实得 200 {"available":false}）、launchd-patrol.test.js（expected 8 to be 7）、随之 ci-passed 红；且此前分支 DIRTY（已 rebase 掉与 #3899 重复的 4 个 blade3-t4 commit 解决）。

## 根因
1. server.js:253 存在旧 app 级 GET /api/brain/kv/:key（available:false 语义、连字符→下划线取键），先于 routes.js 注册；刀3-T1 又新建 routes/kv.js（404 语义、原样取键）。GET 被旧路由截胡、POST 走新路由——且旧 GET 转 _ 读、新 POST 按 - 写，写进去的键永远读不到（双实现分脑，接缝重复实现病）。
2. 刀3-T1 往 launchd-patrol MUST_LOAD_DAEMONS 加了第 4 项 com.cecelia.smoke-nightly，未同步更新测试 checked 断言（7→8）。

## 修法
- 删 server.js 旧 app 级 KV GET，统一走 routes/kv.js
- routes/kv.js GET 加下划线变体兜底（保 seven-ring-audit-last 老取键约定消费者）
- launchd-patrol.test.js checked 断言 7→8

## Regression Test 计划
两个守卫已存在且已 proven-to-fire（正是它们把 CI 打红的）：
- packages/brain/scripts/smoke/kv-route-smoke.sh（404/写读一致断言）
- launchd-patrol.test.js checked 断言
修复即让它们变绿，无需新增。

## 验收标准
- [ ] kv-route-smoke.sh 4/4 绿（CI real-env-smoke）
- [ ] launchd-patrol.test.js 绿（brain-unit）
- [ ] CI 全绿，#3900 auto-merge 完成
