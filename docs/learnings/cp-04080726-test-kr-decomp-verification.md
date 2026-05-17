# Test KR for decomp — 验证报告

**分支**: cp-04080726-ba5dd980-c113-4571-a1b2-147e6a
**日期**: 2026-04-08
**任务**: ba5dd980-c113-4571-a1b2-147e6ad62c4f

---

## 一、Test KR 生命周期

| 时间 | 事件 |
|------|------|
| 2026-04-04 | Test KR（goal id: 90a9e33e）创建，type=area_kr，goals 表 |
| 2026-04-04~07 | 人工推进到 current_value=38（进度 38%）|
| 2026-04-08 13:41 | 状态变为 archived（测试结束）|

**关键发现**：Test KR 存在于 `goals` 表（旧数据模型），而 decomp-checker v2.0 已完全迁移到新 OKR 表（`key_results` / `objectives`）。Test KR 自始至终未被自动化流程处理——38% 进度为人工操作结果。

---

## 二、decomp-checker v2.0 现状评估

### 已运行良好的部分

- **Check A**（pending KR → 秋米拆解）：对新 OKR 表 key_results 有效
- **Check B**（ready KR Initiative 状态）：KR 状态流转 ready→in_progress→completed 逻辑正确
- **Check C**（KR 无 Project 回退）：规划链断裂时可自愈
- **Check D**（Objective 无 KR → 战略会议）：顶层 OKR 链路闭环

### 发现的 Bug（已修复）

**Check A 查询包含了 `ready` 状态的 KR**

```sql
-- 修复前（错误）
WHERE g.status IN ('pending', 'ready')

-- 修复后（正确）
WHERE g.status = 'pending'
```

**影响**：
- `ready` 状态 = Vivian 已审核通过的 KR，意味着拆解完成
- 24h dedup 窗口过期后，Check A 会对 `ready` KR 重新创建拆解任务
- 被创建的新任务会将 KR 状态强制退回 `decomposing`，覆盖用户批准的状态
- 这会破坏 `pending → decomposing → reviewing → ready → in_progress` 的正向流转

---

## 三、OKR 拆解方法论评估

### 流程链路（已验证通过）

```
Objective (active)
  └── KR (pending)
        ↓ [Check A: 秋米拆解任务]
      KR (decomposing)
        ↓ [秋米创建 Project+Scope+Initiative]
      KR (reviewing)
        ↓ [Vivian 质检]
      KR (ready)
        ↓ [Check B: planner 推进]
      KR (in_progress)
        ↓ [所有 Initiative 完成]
      KR (completed)
```

### 主要约束（生产中已验证）

- **WIP 限制**：MAX_DECOMP_IN_FLIGHT=3，防止并发拆解积压
- **Dedup 窗口**：24h 内不重复创建拆解任务
- **质量门禁**：`validateTaskDescription` 过滤低质量任务描述

---

## 四、下次迭代建议

### P0 改进（已在本 PR 修复）
- [x] Check A 移除 `ready` 状态，防止已审核 KR 被逆向重置

### P1 改进（后续迭代）
1. **legacy goals 表告警**：goals 表中 type=area_kr 且 status=pending 的条目不会被 decomp-checker 处理，应添加 Check E 做告警或迁移提示
2. **KR 状态逆转防护**：decomp-checker 修改 KR 状态前，应检查当前状态是否合法（如禁止 ready→decomposing）
3. **测试 KR 标记机制**：创建测试用 KR 时，应有 `is_test: true` 标记，避免和生产数据混淆

### 方法论结论

OKR 拆解自动化核心流程已可用。主要风险在边界情况（status 回退、legacy 数据、dedup 窗口边界），建议在 Q2 做一次全链路回归测试（用真实 Objective 跑完整流程）。

---

## 五、checklist

### 根本原因
Check A 的 SQL 查询 `WHERE g.status IN ('pending', 'ready')` 中错误包含了 `ready` 状态。`ready` KR 已经过 Vivian 审核批准，不应再被触发拆解。24h dedup 窗口过期后会导致状态逆退。

### 下次预防
- [ ] decomp-checker 任何修改需附带 SQL WHERE 子句的 code review，确认 status 过滤范围合理
- [ ] KR 状态变更前增加合法性检查（禁止高状态退回低状态的非预期操作）
- [ ] 新建 KR 用测试标记 vs 生产标记区分，避免测试数据干扰系统指标
