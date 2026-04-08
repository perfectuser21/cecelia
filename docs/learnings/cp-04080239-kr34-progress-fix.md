# Learning: KR3/KR4 进度采集 0% 根因与 migration 冲突

## 根本原因

### 问题 1：migration 版本号冲突导致阶梯公式从未生效
- PR #2018 已创建 `224_fix_kr_placeholder_verifiers.sql`，migration 224 已被占用
- PR #2023 又创建了 `224_fix_kr34_progress_verifiers.sql`（同版本号！）
- Migration runner 已见过 '224' → 跳过第二个文件 → 阶梯公式从未执行

### 问题 2：$2 类型歧义导致 tick-loop 更新失败
- 旧 kr-verifier.js：`current_value = $2` + `$2::text`，pg Extended Protocol 类型推断冲突
- 错误信息：`inconsistent types deduced for parameter $2`
- 修复：`current_value = $2::numeric` + `($2::numeric)::text`

### 问题 3：SUM/GREATEST 类型混合
- `GREATEST(1, COUNT(*))` 中 `1=integer`，`COUNT(*)=bigint`
- Extended Protocol 下类型推断失败（psql 简单协议下正常！这是排查陷阱）
- 修复：AVG() 或 NULLIF(COUNT(*), 0) 替代

## 下次预防

- [ ] **新 migration 前必须检查**：`ls packages/brain/migrations/NNN*` 确认版本号未被占用
- [ ] **GREATEST 禁止混合整数类型**：统一用 `NULLIF(expr, 0)` 或 AVG
- [ ] **$N 多次使用**：同一 `$N` 在不同类型上下文必须加显式 cast 统一类型
- [ ] **verifier SQL 测试必须用 `pool.query()`**：psql 简单协议不等价于 Extended Protocol
