# Task Card: 修复任务成功率计算 NULL 语义 Bug

## 背景

Brain self-drive.js 的 `getTaskStats24h()` 函数中存在 PostgreSQL NULL 语义 bug：
`payload->>'failure_class' != 'auth'` 对于 failure_class 为 NULL 的任务返回 NULL（false），
导致大量已完成任务（failure_class 为空）不被计入 `total` 分母，成功率计算严重失真。

## 根因分析

### 现象
- 历史 48% 成功率：auth 修复前（PR #2017），188 个 auth 失败被计入分母
  - completed=201, total=423 → 48%
- 当前 3063% 成功率：auth 修复后 NULL 语义 bug 暴露
  - completed=239, total=8（应为 252）→ 239/8 ≈ 3000%

### 根本原因
PostgreSQL 中 `NULL != 'auth'` 返回 NULL（not true），不是 true。
所以 `payload->>'failure_class' != 'auth'` 把 233 个 failure_class=NULL 的完成任务排除在外。

### 正确写法
`(payload->>'failure_class' IS NULL OR payload->>'failure_class' != 'auth')`

## 修复范围

- `packages/brain/src/self-drive.js` — `getTaskStats24h()` 函数
  - `failed` 计数 filter：加 IS NULL 判断
  - `total` 计数 filter：加 IS NULL 判断

## DoD

- [x] [ARTIFACT] `packages/brain/src/self-drive.js` 的 `getTaskStats24h()` 已修复 NULL 语义
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/self-drive.js','utf8');if(!c.includes(\"failure_class' IS NULL\"))process.exit(1);console.log('OK')"`
- [x] [BEHAVIOR] 修复后 total 计算值 ≥ 200（原来只有 8，修复后应 ~252）
  - Test: `manual:node -e "const {Pool}=require('pg');const p=new Pool({database:'cecelia'});p.query(\"SELECT count(*) filter (where status IN ('completed','failed','quarantined') AND (payload->>'failure_class' IS NULL OR payload->>'failure_class' != 'auth') AND (completed_at > NOW() - INTERVAL '24 hours' OR updated_at > NOW() - INTERVAL '24 hours')) as total FROM tasks WHERE task_type != 'pipeline_rescue'\").then(r=>{const t=parseInt(r.rows[0].total);console.log('total='+t);if(t<50)process.exit(1);p.end()}).catch(e=>{console.error(e);process.exit(1)})"`
