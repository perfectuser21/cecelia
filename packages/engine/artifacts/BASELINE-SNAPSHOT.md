# RCI Baseline Snapshot

**Generated**: 2026-01-23T08:54:07.464Z
**Version**: v9.1.1

## Coverage Summary

| Metric | Value |
|--------|-------|
| Total Entries | 8 |
| Covered | 8 |
| Uncovered | 0 |
| **Coverage** | **100%** |

## Status

✅ **PASS** - All business entries are covered by RCI.

## Covered Entries (8)

| Type | Path | Covered By |
|------|------|------------|
| skill | `skills/qa/SKILL.md` | C1-008, C3-005 |
| skill | `skills/dev/SKILL.md` | C1-001, C3-001, C3-002, C3-003, C3-004, C3-005, C3-006 |
| skill | `skills/audit/SKILL.md` | C1-009 |
| skill | `skills/assurance/SKILL.md` | C1-010 |
| script | `scripts/run-regression.sh` | C3-004 |
| script | `scripts/qa-report.sh` | C3-005 |
| script | `scripts/release-check.sh` | C3-006 |
| script | `scripts/install-hooks.sh` | C3-003, C6-002 |

## RCI Contracts (21)

- **C1-001**: /dev 流程可启动
- **C1-002**: 分支自动创建
- **C1-003**: DoD 自动生成
- **C1-004**: Loop 1 循环（质检失败后回退）
- **C1-005**: CI 失败后循环
- **C1-006**: 模式检测 - new
- **C1-007**: 模式检测 - continue
- **C1-008**: /qa Skill 加载
- **C1-009**: /audit Skill 加载
- **C1-010**: /assurance Skill 加载
- **C2-001**: CI 运行 npm run qa
- **C2-002**: 版本号必须递增（PR to develop）
- **C2-003**: CHANGELOG 必须更新（PR to main）
- **C3-001**: metrics.sh 输出指标
- **C3-002**: snapshot-prd-dod.sh 保存快照
- **C3-003**: install-hooks.sh 安装成功
- **C3-004**: run-regression.sh 执行回归测试
- **C3-005**: qa-report.sh 生成报告
- **C3-006**: release-check.sh 发布检查
- **C6-001**: 完整开发流程
- **C6-002**: 安装与部署链路
