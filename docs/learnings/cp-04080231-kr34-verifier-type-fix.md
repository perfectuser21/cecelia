# Learning: KR3/KR4 进度采集链路修复 — $2::text 类型冲突 + 阶梯权重

## 任务背景
KR3（微信小程序）和 KR4（geo SEO网站）进度始终为 0%，verifier 报错 "inconsistent types deduced for parameter $2"。

### 根本原因

**Bug 1: $2::text 类型冲突（kr-verifier.js）**

PR #2017 在 `runAllVerifiers()` 修复 current_value 写入时，将参数从 `currentValue.toString()`（string）改为 `currentValue`（number）。PR #2024 将同样的 bug 复制到 `resetAllKrProgress()`。

PostgreSQL 参数类型推断规则：
- `current_value = $2` → 推断 `$2` 为 numeric（因为列类型是 numeric(12,2)）
- `jsonb_build_object('metric_current', $2::text)` → 推断 `$2` 为 text
- 两者冲突 → "inconsistent types deduced for parameter $2"

**Bug 2: migration 命名冲突（224_fix_kr34 未能应用）**

两个文件共享版本前缀 "224"：
- `224_fix_kr_placeholder_verifiers.sql`（字母序在后但先被应用）
- `224_fix_kr34_progress_verifiers.sql`（阶梯权重，因 '3'<'_' 在字母序前，BUT 实际应用时 placeholder 先被标记版本 224 成功）

结果：KR3/KR4 verifier SQL 停留在 `SUM(progress::numeric)` — 但 okr_projects.progress 列从未被维护 → 永远返回 0。

### 修复方案

1. **类型冲突**：使用独立的第 3/4 号参数避免 PostgreSQL 类型推断冲突：
   ```javascript
   // 修前
   [progress, currentValue, v.kr_id]  // $2 被同时推断为 numeric 和 text
   // 修后
   [progress, currentValue, String(currentValue), v.kr_id]  // $3 独立提供文本
   ```

2. **KR3/KR4 阶梯权重**：migration 227 使用 CASE WHEN 基于 status 推断进度：
   - active/planning/queued = 50分，completed = 100分，其他 = 0分
   - 不依赖无人维护的 `progress` 列，自动反映项目生命周期

### 下次预防

- [ ] 在 `pool.query(sql, params)` 中，同一参数 `$N` 不能在两处上下文被 PostgreSQL 推断为不同类型
- [ ] 安全模式：需要同一值既作数字又作字符串时，传两个独立参数
- [ ] migration 命名必须唯一前缀，双 224_ 文件是死路
- [ ] 新 verifier SQL 应基于 **status 列**（有人维护）而非 **progress 列**（无人维护）
- [ ] PR 修改 kr-verifier.js 必须同时运行 `kr-verifier.test.js` 验证参数写入
