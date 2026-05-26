# Learning: Harness E2E 路由修复（6 Bug 批量）

**分支**: cp-0525070400-fix-harness-e2e-routing-bugs
**日期**: 2026-05-25

### 根本原因

1. `finalEvaluateDispatchNode` 只从 prdContent 读 `target_environment`，payload 的显式值被忽略
2. walking-skeleton 点火 curl 从不传 `target_environment`，planner 推断失败就回退 local_api
3. contract-proposer 的 windows_cloud 模板只有"安装包验证"，没有 dryrun 脚本执行变体
4. evaluator 的 windows_cloud 分支不下载 GHA artifact，无视觉验证
5. ZenithJoy v1.1.26 install pack 从未打包（新脚本在打包之后才加入）
6. ZenithJoy article dryrun 修复分支未合并

### 下次预防

- [ ] 每次新增 target_environment 值时，同步检查 planner/proposer/evaluator/Brain 四处都有处理
- [ ] payload 显式字段永远比 prdContent 正则解析更可靠，优先 payload fallback
- [ ] windows_cloud sprint 首次创建时，先确认 e2e-windows.yml workflow 存在 + screenshots artifact 上传
- [ ] version bump 和 pack build 应在同一个 PR，不要只 bump 不 build
