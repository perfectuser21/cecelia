# Learning — test DB 隔离根治

分支：cp-0422111326-test-db-isolation
日期：2026-04-22
Task：2302a40f-7ce0-4f12-8969-7634e8ed94d8

## 真实事故

昨晚（2026-04-22 00:42 UTC）合并 #2517 时 subagent 本地跑
muted-toggle-e2e.integration.test.js。本地无 cecelia_test DB，
DB_DEFAULTS 解析到 cecelia（生产 DB）。test beforeEach
DELETE + INSERT + 最后一个 subtest 的 PATCH {enabled:false} 留状态。

Brain 今早 10:01 左右重启，initMutedGuard(pool) 从 cecelia DB 读到
brain_muted.enabled=false → 飞书恢复发送。Alex 以为自己切错了，
查 brain.log 才发现没有 Mute toggled → false 的记录——是 DB 层
直接被测试改的。

## 根本原因

两个缺失叠加：

1. **本地缺 cecelia_test DB** —— 本应和 CI 一样的 test DB，本地机器没建
2. **db-config.js 无 guard** —— NODE_ENV=test 时仍默认 'cecelia'，不校验

任何 integration test 本地跑都会踩。昨晚是 muted 开关被 reset，下次
可能是 task 表、决策表被动。

## 本次解法

### 1. setup-test-db.sh
幂等脚本：检查 cecelia_test DB 是否存在，不存在则 createdb，然后跑
migrations。unset NODE_ENV/VITEST 防子进程继承。

### 2. db-config.js guard
- isTest = NODE_ENV==='test' || VITEST==='true'
- isTest + DB_NAME 未设 → 默认 cecelia_test（不是 cecelia）
- isTest + DB_NAME=cecelia 显式 throw（禁止污染生产）
- 非 test → 保持原行为

### 3. 4 场景单测
vi.stubEnv + vi.resetModules 避免 flaky。

## 下次预防

- [ ] 任何 integration test 本地跑之前检查是否有测试 DB 隔离
- [ ] 新 env 开关（NODE_ENV 类）必须有 guard 防止误用生产配置
- [ ] DB 级 fallback 默认值要区分"生产安全默认"vs"测试安全默认"
- [ ] setup-test-db.sh 加进新人 onboarding 文档
