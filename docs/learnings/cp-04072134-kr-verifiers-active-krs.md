# Learning: KR 进度永远 0% — kr_verifiers 引用 archived KR

**分支**: cp-04072134-eea2e2ec-d40e-410e-9f34-c40807
**日期**: 2026-04-08

### 根本原因

`kr_verifiers` 表的 7 条记录全部引用 `status='archived'` 的旧 KR（OKR 重构时留下的历史数据）。  
`runAllVerifiers()` 查询条件为 `WHERE g.status IN ('active', 'in_progress')`，archived KR 被过滤掉，
导致每次 tick 均 0 条 verifier 执行，10 个活跃 KR 的 `progress` 字段永远是 NULL（显示 0%）。

**触发场景**: OKR 重构（新建 objectives/key_results）后，未同步迁移 kr_verifiers 到新 KR IDs。

### 现象 vs 根因对照

| 现象 | 根因 |
|------|------|
| 所有 KR 显示 0% | kr_verifiers 无对应活跃 KR |
| runAllVerifiers 返回 checked=0 | WHERE 过滤掉了 archived KR |
| Dopamine 高分但 OKR 全 0% | 两套数据完全脱钩 |

### 修复

- **Migration 223**: 为 10 个活跃 KR 插入 kr_verifiers（SQL查询 + threshold）
- **新增 API**: `POST /api/brain/okr/sync-verifiers` — 手动触发立即同步，不用等 tick 每小时的调度

### 下次预防

- [ ] OKR 重构/迁移 checklist 中加入：**同步迁移 kr_verifiers 到新 KR IDs**
- [ ] 在 `runAllVerifiers()` 中加告警：若 `checked=0 AND enabled_verifiers > 0`，输出警告（可能全是 archived）
- [ ] 每次新建 KR 时，同步在 `kr_verifiers` 中注册对应验证器（视为 KR 创建 SOP 的一部分）
