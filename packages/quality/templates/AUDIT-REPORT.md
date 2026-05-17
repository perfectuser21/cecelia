# Audit Report

> /audit skill 输出的代码审计产物

## 基本信息

| 字段 | 值 |
|------|-----|
| Branch | `cp-xxx` |
| Date | YYYY-MM-DD |
| Scope | 审计范围（文件/目录） |
| Target Level | L2 (默认) |

## 审计结果

### 统计

| 层级 | 数量 | 状态 |
|------|------|------|
| L1 (阻塞性) | 0 | 必须修 |
| L2 (功能性) | 0 | 建议修 |
| L3 (最佳实践) | 0 | 可选 |
| L4 (过度优化) | 0 | 不修 |

### Blockers (L1 + L2)

| ID | 层级 | 文件 | 问题 | 状态 |
|----|------|------|------|------|
| B1 | L1 | path/to/file.ts:123 | 问题描述 | FIXED / OPEN |
| B2 | L2 | path/to/file.ts:456 | 问题描述 | FIXED / OPEN |

### L3 建议 (可选修复)

| ID | 文件 | 建议 |
|----|------|------|
| S1 | path/to/file.ts | 建议内容 |

## 结论

Decision: **PASS** / **FAIL**

### PASS 条件
- [ ] L1 问题：0 个
- [ ] L2 问题：0 个（或全部 FIXED）

### 如果 FAIL
- 原因：存在 N 个未修复的 L1/L2 问题
- 必须修复后重新审计

---

**审计完成时间**: YYYY-MM-DD HH:MM
