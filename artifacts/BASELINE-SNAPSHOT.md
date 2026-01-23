# RCI Baseline Snapshot

**Generated**: 2026-01-23T08:45:22.182Z
**Version**: v9.1.1

## Coverage Summary

| Metric | Value |
|--------|-------|
| Total Entries | 8 |
| Covered | 2 |
| Uncovered | 6 |
| **Coverage** | **25%** |

## Status

⚠️ **WARNING** - 6 entries are not covered.

## Covered Entries (2)

| Type | Path | Covered By |
|------|------|------------|
| skill | `skills/dev/SKILL.md` | C1-001, C3-001, C3-002, C3-003 |
| script | `scripts/install-hooks.sh` | C3-003, C6-002 |

## Uncovered Entries (6)

| Type | Path | Name |
|------|------|------|
| skill | `skills/qa/SKILL.md` | /qa |
| skill | `skills/audit/SKILL.md` | /audit |
| skill | `skills/assurance/SKILL.md` | /assurance |
| script | `scripts/run-regression.sh` | run-regression |
| script | `scripts/qa-report.sh` | qa-report |
| script | `scripts/release-check.sh` | release-check |

### Action Required

Add RCI entries for the uncovered paths above, or mark them as intentionally excluded.

## RCI Contracts (15)

- **C1-001**: /dev 流程可启动
- **C1-002**: 分支自动创建
- **C1-003**: DoD 自动生成
- **C1-004**: Loop 1 循环（质检失败后回退）
- **C1-005**: CI 失败后循环
- **C1-006**: 模式检测 - new
- **C1-007**: 模式检测 - continue
- **C2-001**: CI 运行 npm run qa
- **C2-002**: 版本号必须递增（PR to develop）
- **C2-003**: CHANGELOG 必须更新（PR to main）
- **C3-001**: metrics.sh 输出指标
- **C3-002**: snapshot-prd-dod.sh 保存快照
- **C3-003**: install-hooks.sh 安装成功
- **C6-001**: 完整开发流程
- **C6-002**: 安装与部署链路
