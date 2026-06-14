# PRD — Notion Feature 推送 Status 属性类型修复

## 背景

数据库状态审计（2026-06-14）发现 Brain↔Notion 同步活跃失败：
- `[notion-push-sync] feature <id> 推送失败: Notion POST /pages → 400: Status is expected to be status.`
- 近 1 小时 120 次失败，88 个 feature 无限重试（catch 仅对 stale-relation 404 标记 synced，对该 400 不标记 → 每轮 sync 重试）。

根因（实测 Notion Feature 库 schema 确认）：
- `notion-push-sync.js:96` 把 feature 的 `Status` 当 `select` 类型发：`Status: { select: { name } }`。
- 但 Notion「AI Feature」库的 Status 属性是 **status 类型**（合法选项 planned/working/building/broken/deprecated/done，与 DB 的 6 个值一一匹配）。
- 类型不符 → Notion 400。#3371 当时修了 notes/Title/Order，漏了 feature 的 Status 类型。

附带：`Kind` 是 select 类型，Notion 选项首字母大写 `Ability/Feature`，但 DB 存小写 `ability/feature` → select 会自动创建重复小写选项（非 400 但不干净）。

## 方案

- `Status: { select: ... }` → `Status: { status: { name: f.status || 'planned' } }`（仅类型对齐，值已匹配）。
- `Kind` 映射小写→首字母大写：`(f.kind||'feature')==='ability' ? 'Ability' : 'Feature'`，避免重复选项。

## 范围

仅改 `packages/brain/src/notion-push-sync.js` 的 `pushJourneyFeatures` 的 properties 构造 + 回归测试。不改其他 push 函数、不改 catch/降级逻辑。

## 成功标准

- feature 推送的 Status 属性用 `status` 类型（`{ status: { name } }`），不再是 `select`。
- feature 的 Kind 值映射为首字母大写（ability→Ability，feature→Feature）。
- 回归测试断言 Status 用 status 类型、Kind 大写映射；既有 notion-push-sync 测试回归通过。
