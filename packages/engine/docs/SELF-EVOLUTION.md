# Self-Evolution Log

自我进化日志 - 记录发现的问题、分析的根因、建立的检查项和自动化措施

---

## 工作流程（v2.0 - 异步队列模式）

```
问题发现 → 记录到队列 → 定时/手动处理 → 自动化固化
```

### 新模式 vs 旧模式

| 阶段 | 旧模式（立即执行）| 新模式（异步队列）|
|------|------------------|------------------|
| **发现** | post-pr-checklist报错 | 记录到SELF-EVOLUTION-QUEUE |
| **响应** | AI 立即创建 PR 修复 | 不阻塞，继续流程 |
| **处理** | 同步修复（可能循环）| 异步处理（积累后批量）|
| **固化** | 每次修复后添加检查 | 处理完后更新自动化 |

### 队列处理

**队列文件**：`docs/SELF-EVOLUTION-QUEUE.md`

**自动处理**（auto_fix: true）：
```bash
# 定时任务或 CI 后执行
bash scripts/cleanup-prd-dod.sh  # 清理 PRD/DoD 残留
```

**手动处理**（auto_fix: false）：
1. 从队列选择任务
2. 创建 PRD（基于任务描述）
3. 运行 `/dev` 修复
4. 标记为 completed

### 避免无限循环

**旧问题**：
```
cleanup PR #293 合并
  → develop 有 .prd.md/.dod.md (来自 PR #293)
  → post-pr-checklist 报错
  → AI 立即创建 PR #294
  → develop 又有 .prd.md/.dod.md (来自 PR #294)
  → 无限循环... ❌
```

**新解决方案**：
```
cleanup PR #296 合并
  → develop 有 .prd.md/.dod.md
  → post-pr-checklist 记录到队列（不报错）
  → CI 后自动运行 cleanup-prd-dod.sh
  → 自动删除残留 ✅
```

---

## 问题 → 检查项 → 自动化

### 2026-01-26: PRD/DoD 残留

**问题**：develop 分支上有 `.prd.md` 和 `.dod.md` 文件

**根因**：PR squash merge 时把功能分支的 PRD/DoD 带进了 develop

**影响**：
- 从 develop 创建新分支时会带上旧的 PRD/DoD
- 导致用户报告"老能检测到之前的PRD/DoD"问题
- 污染了 develop 分支的干净状态

**检查项**：
- [ ] develop/main 不应有 `.prd.md` / `.dod.md`

**自动化**：
1. `scripts/post-pr-checklist.sh` - PR 后自动检查
2. `.github/workflows/ci.yml` - CI 自动检测并阻止
3. Step 11 (Cleanup) - 集成到 /dev 流程

**状态**：✅ 已修复（PR #292）

---

### 2026-01-26: SHA 不匹配

**问题**：每次 PR 都会遇到 evidence SHA 不匹配

**根因**：
1. Step 7 生成 evidence 后创建单独的 commit
2. evidence commit 导致 HEAD SHA 和 evidence.sha 对不上
3. 需要手动重新生成 evidence

**影响**：
- 每次 PR 都需要额外的 "chore: update quality evidence" commit
- CI 报错：SHA 不匹配
- 浪费时间重复操作

**检查项**：
- [ ] evidence commit 应该被 squash 到代码 commit
- [ ] 最终只应有一个 commit（代码 + evidence）

**自动化**：
1. `scripts/squash-evidence.sh` - 自动合并 evidence commit
2. Step 8 (PR) 调用 - 创建 PR 前自动 squash
3. 单 commit 策略 - Step 7 暂存 evidence 但不 commit

**状态**：✅ 已修复（PR #292）

---

### 2026-01-26: 派生视图未更新

**问题**：更新 `feature-registry.yml` 后忘记运行 `generate-path-views.sh`

**根因**：
1. 手动操作，容易忘记
2. CI 的 contract-drift-check 检测到不同步才发现

**影响**：
- CI 失败：Contract Drift 检测到
- 需要手动运行脚本并重新 commit
- 增加额外的 commit

**检查项**：
- [ ] 派生视图版本应该与 registry 同步
- [ ] 变更 registry 时应该自动生成视图

**自动化**：
1. `scripts/auto-generate-views.sh` - 自动检测并生成
2. Step 7 (Quality) 调用 - 质检时自动检查
3. `scripts/post-pr-checklist.sh` - PR 后验证同步

**状态**：✅ 已修复（PR #292）

---

### 2026-01-26: Priority 误识别

**问题**：PR title 中的 "p1 阶段" 被检测为 Priority P1

**根因**：
1. `detect-priority.cjs` 从 PR title 和 commit message 提取 Priority
2. 正则表达式匹配到 "p1" 就认为是 P1
3. 即使 QA-DECISION.md 写的是 P2，CI 还是检测到 P1

**影响**：
- PR Gate 要求更新 regression-contract.yaml（P0/P1 必须更新 RCI）
- 需要改 PR title 和 commit message
- 浪费时间调试

**检查项**：
- [ ] Priority 应该从明确来源读取（QA-DECISION.md）
- [ ] 不应该从文本中误识别（"p1 阶段" ≠ Priority P1）

**自动化**：
1. `detect-priority.cjs` 优化 - 优先从 QA-DECISION.md 读取
2. 移除 PR title 和 commit message 检测
3. 只从明确来源检测：QA-DECISION.md > 环境变量 > PR labels > git config

**状态**：✅ 已修复（PR #292）

---

### 2026-01-26: 缺少自我评估

**问题**：完成后没有 checklist 检查，问题需要用户指出

**根因**：
1. /dev 流程 Step 11 (Cleanup) 只做简单清理
2. 没有系统化的自我检查机制
3. 问题重复出现，每次都是用户发现

**影响**：
- 用户反馈："不能让我再发现这些问题"
- 缺少自我进化能力
- 问题没有固化为检查项

**检查项**：
- [ ] PR 后应该运行完整的 checklist
- [ ] 发现的问题应该记录到 SELF-EVOLUTION.md
- [ ] 检查项应该自动化

**自动化**：
1. `scripts/post-pr-checklist.sh` - 系统化检查
2. `docs/SELF-EVOLUTION.md` - 记录问题和措施
3. Step 11 (Cleanup) 集成 - 自动运行 checklist

**状态**：✅ 已修复（PR #292）

---

## 自我进化原则

### 1. 问题发现 → 立即记录

当用户指出问题时：
1. 分析根因（不是表象）
2. 记录到 `SELF-EVOLUTION.md`
3. 设计检查项（可验证）
4. 实现自动化（防止重复）

### 2. 检查项 → 自动化

所有检查项都应该自动化：
- **手动检查** = 容易忘记 = 会重复发生
- **自动化检查** = 系统强制 = 不会重复

### 3. 自动化 → 集成流程

自动化脚本必须集成到流程：
- Pre-commit Hook - 提交前检查
- Step 7 (Quality) - 质检时检查
- Step 11 (Cleanup) - PR 后检查
- CI Workflow - 远端强制检查

### 4. 流程 → 持续优化

每次 PR 后运行 `post-pr-checklist.sh`：
1. 检查是否有新问题
2. 如果有 → 更新 checklist
3. 如果无 → 证明自动化有效

---

## 检查项清单（当前版本）

### A. 代码质量

- [x] Typecheck 通过
- [x] Tests 通过
- [x] Build 成功
- [x] Audit Decision: PASS

### B. 文件清洁度

- [x] develop/main 无 PRD/DoD 残留
- [x] 无临时文件 (*.tmp, *.bak, *.old)
- [x] 派生视图版本同步

### C. Commit 质量

- [x] 只有一个 commit（代码 + evidence）
- [x] Commit message 符合规范
- [x] 所有 commit 已 push

### D. Priority 准确性

- [x] Priority 从 QA-DECISION.md 读取
- [x] 不会误识别文本中的 "p0/p1/p2/p3"

### E. 自动化完整性

- [x] 所有脚本有可执行权限
- [x] 所有检查项都有自动化

---

## 下一步优化

1. **Metrics Dashboard** - 可视化展示历史问题趋势
2. **AI 自动分析** - 从失败模式中学习，自动生成新检查项
3. **持久化存储** - 把检查项存储到数据库，支持动态添加
4. **通知机制** - 检查失败时自动通知相关人员

---

**更新时间**: 2026-01-26
**版本**: 1.0.0
**维护者**: ZenithJoy Engine Team
