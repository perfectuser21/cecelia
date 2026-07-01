# Sprint PRD — test 生命周期治理（E2）

## OKR 对齐

- **对应 KR**：Harness Pipeline 健壮性 / test 台账质量
- **当前进度**：已有 test_registry 1037 行，纯 upsert 只增不减
- **本次推进预期**：test 台账加入生命周期状态，孤儿测试可被自动发现

## 背景

test_registry 是纯 upsert scanner，功能删掉后对应测试行永不退出，孤儿越积越多无人管。
本次给 test_registry 加 status + feature_id 软外键，再加定期巡检（test-lifecycle-patrol.js）：
文件真没了 → 自动标 orphan；关联能力删了 → 只告警不删文件。

## Golden Path（核心场景）

**入口**：Brain tick 触发 test-lifecycle-patrol → **步骤**：migration 字段就位 → patrol 扫每行 →
按文件/能力状态判定 → 分级动作 → **出口**：孤儿行 status='orphan'，告警清单可见，无误删

具体：

1. **Migration 311 就位**：test_registry 加 status（默认 'active'）+ feature_id（FK→journey_features，ON DELETE SET NULL）+ orphan_reason + lifecycle_checked_at + 两索引；存量行语义不变
2. **patrol 扫描**：遍历 test_registry 每行，比对 (a) file_path 磁盘是否存在 (b) feature_id 非 NULL 且 journey_features 对应行是否还 active
3. **判定规则**：file_path 不存在 → file_missing；feature_id 非 NULL 且关联能力已删 → feature_deleted；feature_id IS NULL → 不判 feature_deleted（防误标）；lifecycle_checked_at 超阈值未更新 → stale_scan
4. **分级动作**：file_missing → UPDATE status='orphan', orphan_reason='file_missing'；feature_deleted → 只写日志 + 输出建剪除清单，绝不 DELETE 行 / 不删 test 文件
5. **误标自愈**：文件或能力回来 → UPDATE status='active', orphan_reason=NULL, lifecycle_checked_at=NOW()
6. **tick 集成**：挂 Brain tick-runner，复用 fire-and-forget 模式 + 24h 去重（`lifecycle_checked_at` 判窗口）

## 边界情况

- journey_features 查询失败 → patrol 跳过本轮，不抛异常，不改任何行状态
- feature_id IS NULL → 仅判 file_missing，不判 feature_deleted
- 同一行 file_missing + feature_id 非 NULL 能力也删了 → 以 file_missing 为准（文件缺失优先）
- migration 是 additive：已有列/索引不变，存量行 status 默认 'active'

## 范围限定

**在范围内**：migration 311 additive + test-lifecycle-patrol.js + tick 集成 + 分级动作

**不在范围内**：
- scanner 回填 feature_id 的完整关联算法（另立 Sprint）
- 自动删除 test 文件（永不做）
- regression-contract.yaml 自动修改（只列建议清单）

## 假设

- [ASSUMPTION: isInPatrolWindow 使用 lifecycle_checked_at 字段做 24h 窗口去重，无独立 patrol_log 表]
- [ASSUMPTION: journey_features 表 active 状态通过 status='active' 或 deleted_at IS NULL 判断，proposer 确认]

## 预期受影响文件

- `packages/brain/migrations/311_test_registry_lifecycle.sql`：新增 status/feature_id/orphan_reason/lifecycle_checked_at + 索引
- `packages/brain/src/test-lifecycle-patrol.js`：新文件，patrol 主逻辑
- `packages/brain/src/tick.js`：注册 test-lifecycle-patrol（fire-and-forget）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本次查询返回空）；PrepPRD 显式值 -->
- Migration 策略: additive 只增列/索引，不改存量数据类型，存量行 status 默认 'active'
- 环境假设: 禁止写死端口/路径假设值；DB 连接复用 Brain pool
- 租户隔离: 沿用现有 test_registry 的隔离模式（若有 area 维度则按 area 隔离）
- 可观测: patrol 失败必须写 Brain console.warn；feature_deleted 建议清单必须可查

## E2E 验收

<!-- 占位：proposer 将按 target_environment=local_api 填入真实 bash 脚本（curl+psql） -->
<!-- 期望验收点（自然语言）：
  1. migration 311 跑通：psql 查 test_registry 有 status/feature_id/orphan_reason/lifecycle_checked_at 列，存量行 status='active'
  2. file_missing 场景：插入 file_path 指向不存在文件的行 → patrol 后该行 status='orphan', orphan_reason='file_missing'
  3. feature_deleted 场景：插入 feature_id 指向已删 feature 的行 → patrol 后 test_registry 行未删，无 test 文件被删，有告警日志
  4. feature_id IS NULL 不被误标 feature_deleted
  5. CI 全绿（brain-ci.yml migration + patrol 逻辑测试）
-->

```bash
# proposer 将生成可执行的 local_api E2E bash 脚本
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain 内部（tick + DB migration），无 UI 交互，无远端 agent 协议
## target_environment: local_api
## target_environment_reason: curl localhost:5221 + psql cecelia 本地验证，无需浏览器或远端机器
## journey_id: <来源 task.payload.journey_id，Cecelia Harness Pipeline Line 唯一>
## step_id: E2
