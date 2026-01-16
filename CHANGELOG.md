# Changelog

All notable changes to ZenithJoy Engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [7.11.1] - 2026-01-16

### Removed
- cecilia/ 目录（应在 zenithjoy-core 实现）
- dashboard/ 目录（应在 zenithjoy-core 实现）
- docs/CECILIA-ARCHITECTURE.md（移至 zenithjoy-core）

## [7.11.0] - 2026-01-16

### Added
- N8N workflow 接口规范文档 (docs/INTERFACE-SPEC.md)
- N8N 工作流模板 (n8n/workflows/prd-executor.json)
- N8N 目录 README (n8n/README.md)
- Cecilia CLI 接口定义
- Dashboard API 接口定义

## [7.10.0] - 2026-01-16

### Fixed
- check.sh: 硬编码 CLEANUP_VERIFIED=6 改为动态计算
- check.sh: feature 分支检查验证参数匹配
- check.sh: git ls-remote 网络故障处理（区分网络错误和分支不存在）
- check.sh: git 命令添加错误处理
- check.sh: 变量命名优化（TOTAL → REQUIRED_COUNT 等）
- check.sh: cp-* 格式验证完善（必须有 name 部分）
- project-detect.sh: 文件检查改用绝对路径 $PROJECT_ROOT
- branch-protect.sh: 正则完善（cp-[a-zA-Z0-9] 而非 cp-）
- ci.yml: notify-failure 区分失败原因（version-check/test）
- ci.yml: Shell 检查捕获 stderr 显示具体错误
- ci.yml: Python 依赖安装添加错误处理
- ci.yml: npm 缓存添加 cache-dependency-path
- ci.yml: test job 超时调整为 30 分钟
- ci.yml: 移除冗余 git fetch（fetch-depth: 0 已包含）
- ci.yml: auto-merge 失败添加 GitHub warning 注解
- ci.yml: Notion URL 逻辑简化
- ci.yml: Go/Python 版本从项目文件动态检测
- calculator.ts: 添加枚举穷举性检查（assertNever）
- calculator.ts: 移除死代码 try-catch（JS 数学运算不抛异常）

### Added
- calculator.test.ts: 8 个新测试（负数分数次方、浮点精度、极端数值链式操作）

## [7.9.9] - 2026-01-16

### Fixed
- check.sh: grep 计数逻辑修复（□⏭ 不再被重复计算）
- check.sh: 添加分支存在性验证（警告不存在的分支）
- branch-protect.sh: 添加 jq 存在性检查（防止 Hook 静默失效）
- ci.yml: auto-merge 条件显式检查 test.result == 'success'
- ci.yml: 版本检查 sed 正则支持无空格 JSON 格式
- ci.yml: 并发控制仅在 push 时取消旧任务（PR 不取消）
- calculator.ts: calculate() 添加运行时数字验证（NaN/Infinity 输入）
- calculator.ts: chain() 重构，修复 result().input 返回虚构数据
- calculator.ts: chain() 错误后跳过计算（避免 NaN 继续操作）
- STEPS.md: 版本标记更新

### Added
- calculator.test.ts: 9 个新测试覆盖输入验证和链式错误处理

## [7.9.8] - 2026-01-16

### Fixed
- ci.yml: auto-merge needs 加入 version-check 依赖
- ci.yml: BASE_VERSION 空值检查防止版本比较失效
- ci.yml: bash -n 显示错误输出便于调试
- ci.yml: 添加 workflow 并发控制和 job timeout
- calculator.ts: chain() 初始值 NaN/Infinity 验证
- LEARNINGS.md: 标记描述完整 (□/□⏭/○)

## [7.9.7] - 2026-01-16

### Fixed
- SKILL.md: 锚点链接修复（双破折号→单破折号）
- tsconfig.json: 排除测试文件 (*.test.ts) 编译到 dist
- .gitignore: 添加 .env*, *.tsbuildinfo, coverage/
- check.sh: 添加 -h/--help 帮助支持
- check.sh: 添加 git 仓库检查
- check.sh: FEATURE_BRANCH 为空时显示占位符
- branch-protect.sh: 添加 .sh 文件保护

### Removed
- skills/dev/SKILL.md.backup 临时文件（违反规范）

## [7.9.6] - 2026-01-16

### Fixed
- README.md: License MIT → ISC（与 package.json 一致）
- README.md: Node.js 版本说明改为 "18+ (CI 使用 20)"
- README.md: branch-protect.sh 描述补充重要目录保护
- STEPS.md: 变量引用加双引号（行44, 413-415）
- STEPS.md: Co-Authored-By 统一为 "Claude Opus 4.5"
- ARCHITECTURE.md: ASCII 图表格式修复
- ARCHITECTURE.md: Step 7 描述与实际流程同步（2 层而非 4 层）
- ARCHITECTURE.md: 记录规则表格语义修正
- project-detect.sh: 删除未使用的 RED 变量
- project-detect.sh: git 检测改用 git rev-parse
- check.sh: 正则计算逻辑修复（先统计 □⏭ 再计算）
- SKILL.md: "清理 git config" 改为 □⏭（与创建时一致）
- DOD-TEMPLATE.md: 添加"通用模板"说明
- DOD-TEMPLATE.md: type-check → typecheck
- DOD-TEMPLATE.md: 添加 semver 规则说明
- DOD-TEMPLATE.md: 分支命名格式统一

## [7.9.5] - 2026-01-16

### Fixed
- package-lock.json: 版本号同步 (7.8.1/7.7.0 → 7.9.5)
- CHANGELOG.md: 补充 7.9.0-7.9.4 版本链接
- ci.yml: auto-merge 依赖逻辑修复，避免 version-check skip 时失败
- ci.yml: notify-failure 改为监听 version-check 和 test 两个 job
- ci.yml: Python 测试改为显式检测，避免静默错误
- ci.yml: shell 脚本检查改用 while read 处理含空格路径
- SKILL.md: 统一脚本路径为 skills/dev/scripts/check.sh
- DOD-TEMPLATE.md: 术语统一 Checkpoint → cp-*
- check.sh: 变量引用加双引号

## [7.9.4] - 2026-01-16

### Fixed
- check.sh: 添加 SKILL.md 存在性检查

## [7.9.3] - 2026-01-16

### Fixed
- check.sh: 添加参数验证，防止无参数时误用当前分支名

## [7.9.2] - 2026-01-16

### Changed
- STEPS.md: 添加版本标记（用于会话恢复测试）

## [7.9.1] - 2026-01-16

### Fixed
- .gitignore: 添加验证相关临时文件（SKILL.md.backup, VALIDATION.md）

## [7.9.0] - 2026-01-16

### Added
- SKILL.md: 渐进式加载架构 - 710行精简至192行
- references/STEPS.md: 详细步骤实现（按需加载）
- scripts/check.sh: 完成度检查脚本

### Changed
- 统一清单标记：□ 必须 / □⏭ 可跳过 / ○ 可选
- 合并正常模式和快速修复模式清单

## [7.8.1] - 2026-01-16

### Fixed
- SKILL.md: 快速修复模式删除硬编码数字，改为动态描述

## [7.8.0] - 2026-01-16

### Added
- SKILL.md: 快速修复模式 - 简化流程适用于明确的小修复

## [7.7.2] - 2026-01-16

### Fixed
- SKILL.md: 依赖检查移至 Step 0，确保在 cp-* 分支恢复时也会执行

## [7.7.1] - 2026-01-16

### Fixed
- CI: Fixed auto-merge job dependency - now handles skipped version-check correctly
- CI: Fixed notify-failure to only depend on test job
- package-lock.json: Synced version to 7.7.x

## [7.7.0] - 2026-01-16

### Added
- CI: Version check job - validates package.json version update on PRs
- CI: Push triggers now include feature/* branches
- SKILL.md: Dependency checks (gh CLI, jq, gh auth status)
- README: Prerequisites section (gh CLI, jq, Node.js)
- README: Environment variables documentation (ZENITHJOY_ENGINE)

### Changed
- README: Installation uses $ZENITHJOY_ENGINE instead of hardcoded paths
- Global CLAUDE.md: Simplified Subagents section, fixed cp-* consistency

## [7.6.1] - 2026-01-16

### Fixed
- src/index.ts: Added missing entry point file
- package.json: Updated description to "AI development workflow engine"
- package-lock.json: Synced version to 7.6.x
- SKILL.md: Added Step 2.5 to flowcharts
- CHANGELOG.md: Added [7.6.0] version link
- hooks/branch-protect.sh: "checkpoint" → "cp-*"
- templates/DOD-TEMPLATE.md: Updated title format

## [7.6.0] - 2026-01-16

### Fixed
- SKILL.md: Hardcoded paths now use `ZENITHJOY_ENGINE` env variable
- SKILL.md: Semver rule `BREAKING:` → standard `feat!:` or `BREAKING CHANGE:`
- hooks/branch-protect.sh: "ZenithJoy Core" → "ZenithJoy Engine"
- CLAUDE.md: Added CHANGELOG.md to "唯一真实源", updated directory structure
- ARCHITECTURE.md: Added CHANGELOG.md, fixed .md extension, clarified Notion as optional
- LEARNINGS.md: Updated "20/20" to dynamic description, added new learnings section
- CHANGELOG.md: Fixed GitHub username (ZenithJoy → perfectuser21), added missing links
- package-lock.json: "zenithjoy-core" → "zenithjoy-engine"

### Added
- `.gitignore` file for node_modules, dist, logs, IDE files

## [7.5.2] - 2026-01-16

### Fixed
- Updated stale `zenithjoy-core` references to `zenithjoy-engine` in worktree example

## [7.5.1] - 2026-01-16

### Changed
- Checklist now uses dynamic counting (no hardcoded numbers)
- Uses `□` for required items, `○` for optional items
- Completion check script auto-calculates from SKILL.md

## [7.5.0] - 2026-01-16

### Added
- Step 2.5: Context review before PRD (check CHANGELOG, recent PRs, architecture, learnings)
- Dual-layer Learn in Step 7: Engine learnings + Project learnings

### Changed
- Checklist updated from 20+1 to 20+2 (two optional Learn steps)

## [7.4.1] - 2026-01-16

### Changed
- Restructured documentation organization
- Renamed GitHub repository from zenithjoy-core to zenithjoy-engine

## [7.4.0] - 2026-01-16

### Added
- Knowledge layering architecture (docs/ARCHITECTURE.md)
- Development learnings documentation (docs/LEARNINGS.md)

### Changed
- Project renamed to zenithjoy-engine

## [7.3.1] - 2026-01-16

### Fixed
- Removed outdated temporary annotations
- Documentation consistency fixes
- CI shell check now always executes
- Auto-merge error handling improvements

## [7.3.0] - 2026-01-16

### Added
- Key milestone checklist and completion degree check (20/20)

### Fixed
- Session recovery detection improvements
- Core rules description corrections
- Completion check numbering
- Version number update moved to before commit (Step 5.2)
- Completion check script syntax

### Changed
- Enhanced error recovery capabilities
- Cleaned up redundant code

## [7.1.0] - 2026-01-16

### Fixed
- Unified version numbers across project
- Third round workflow optimizations
- Second round workflow bug fixes (5 issues)
- First round workflow bug fixes (3 issues)
- Updated project-detect.sh to reference /dev

### Changed
- Updated README.md to unify on /dev workflow
- Updated CLAUDE.md to remove state file logic
- Refactored to remove state file, use pure git detection

## [7.0.0] - 2026-01-16

### Added
- Initial stable release of ZenithJoy Engine
- /dev workflow as single entry point
- Claude Code Hooks integration
- Branch protection (cp-* branches only)
- Automated CI/CD pipeline
- Semantic versioning enforcement

### Changed
- Complete workflow refactoring

## Earlier Versions

Previous iterations were experimental development versions leading up to the 7.0.0 stable release.

[Unreleased]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.11.1...HEAD
[7.11.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.11.0...v7.11.1
[7.11.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.10.0...v7.11.0
[7.10.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.9...v7.10.0
[7.9.9]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.8...v7.9.9
[7.9.8]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.7...v7.9.8
[7.9.7]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.6...v7.9.7
[7.9.6]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.5...v7.9.6
[7.9.5]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.4...v7.9.5
[7.9.4]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.3...v7.9.4
[7.9.3]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.2...v7.9.3
[7.9.2]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.1...v7.9.2
[7.9.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.9.0...v7.9.1
[7.9.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.8.1...v7.9.0
[7.8.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.8.0...v7.8.1
[7.8.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.7.2...v7.8.0
[7.7.2]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.7.1...v7.7.2
[7.7.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.7.0...v7.7.1
[7.7.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.6.1...v7.7.0
[7.6.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.6.0...v7.6.1
[7.6.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.5.2...v7.6.0
[7.5.2]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.5.1...v7.5.2
[7.5.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.5.0...v7.5.1
[7.5.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.4.1...v7.5.0
[7.4.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.4.0...v7.4.1
[7.4.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.3.1...v7.4.0
[7.3.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.3.0...v7.3.1
[7.3.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.1.0...v7.3.0
[7.1.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.0.0...v7.1.0
[7.0.0]: https://github.com/perfectuser21/zenithjoy-engine/releases/tag/v7.0.0
