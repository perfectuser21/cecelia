## Brain {VERSION} — impact 门豁免 changes/ 版本碎片（kernel CI 自修被误杀根因）

- 2026-09-19 run 0f36a253 实证：generator-fix 按仓规写入 `changes/<分支>.md` 版本碎片，`map/radius.js` unclaimed 判定把它当无能力锚文件 → `impact_anchor_missing` 确定性 run_terminal，修复提交推不出去只能人工搬。
- 修：`GRADUATION_POOL_PREFIXES` 加 `changes/`（与毕业池同类：设计内全局目录，由 auto-version + check-brain-version-bump 把守）；集成测试锁死「changes/ 不判 unclaimed、changes-fake/ 仍判」。
