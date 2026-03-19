# L4 CI 优化：3 shard → 4 shard + 堆内存 6GB → 3GB

## 变更摘要
- L4 集成测试从 3 shard 改为 4 shard，缩短最长 shard 运行时间
- NODE_OPTIONS 堆内存从 6144MB 降到 3072MB（实测只用 1-2GB）
- 端口计算公式从 `* 3` 改为 `* 4`，范围 5500~5896

### 根本原因
L4 原来 3 shard 分配不均，最长 shard 拖慢整体时间。6GB 堆内存预留是早期保守估计，
实际 vitest 运行峰值 1-2GB，多余内存在 M1 8GB 机器上造成资源竞争。

### 下次预防
- [ ] CI 配置变更后观察 3 次运行的内存和时间数据
- [ ] 端口公式修改时必须同时更新：matrix 注释、cleanup step、setup step、verify step
- [ ] shard 数量变更时检查 baseline 计算的 ceiling 公式（分母 + 分子偏移量）
- [ ] GoldenPath E2E 的 shard 条件必须同步更新

## 关联
- task-router.js LOCATION_MAP 已有 `xian` 位置，西安 M1 作为 Codex runner 已通过 codex_qa/codex_dev 等 task_type 路由
- 若需将西安 M1 注册为新的独立 runner 类型，需走 /dev 流程修改 Brain 代码
