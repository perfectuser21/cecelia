# Changelog

All notable changes to ZenithJoy Engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [7.43.1] - 2026-01-19

### Fixed
- **generate-report.sh**: 修复分支已删除或 PR 已合并时报告显示"未完成"的问题
  - STEP 为空时默认设为 11（因为报告在 cleanup 阶段生成）
  - git diff 为空时从 PR API 获取变更文件列表

## [7.43.0] - 2026-01-19

### Added
- **任务质检报告输出**: /dev 完成后自动生成结构化报告
  - `generate-report.sh`: 生成 txt 和 json 两种格式的报告
  - 报告保存到 `.dev-runs/` 目录，供用户查看和 Cecilia 链式任务使用
  - `cleanup.sh`: 在清理前自动调用报告生成
  - `11-cleanup.md`: 文档更新，说明报告格式

## [7.42.0] - 2026-01-19

### Added
- **测试任务模式**：PRD 标题含 `[TEST]` 前缀时自动启用
  - Step 1: 检测 `[TEST]` 前缀，设置 `is-test=true` 标记
  - Step 8: 跳过 CHANGELOG 和版本号更新，commit 用 `test:` 前缀
  - Step 10: Learning 可选（只记录流程经验）
  - Step 11: 额外检查残留（CHANGELOG、版本号、测试代码）
  - SKILL.md: 新增"测试任务模式"文档

### Fixed
- 防止测试任务产生真实版本记录，避免"版本号增加但功能被删除"的矛盾

## [7.41.0] - 2026-01-18

### Fixed
- **[P0]** `project-detect.sh`: 使用 `json_escape` 处理 PACKAGES 数组序列化，防止包名含引号破坏 JSON
- **[P0]** `cleanup.sh`: checkout 失败后跳过 git pull 和后续危险操作
- **[P1]** `cleanup.sh`: git pull 失败后检查 MERGING 状态，防止在冲突状态下继续操作
- **[P1]** `pr-gate.sh`: Shell 语法检查失败时显示具体文件和错误信息
- **[P1]** `pr-gate.sh`: feature/* 分支也执行步骤检查和回退逻辑
- **[P1]** `wait-for-merge.sh`: 正确处理 jq 返回的 null 值（字符串 "null"）
- **[P1]** `SKILL.md`: 补充 Step 8 PR 可能被 Hook 拦截的说明
- **[P1]** `07-quality.md`: 明确"质检三层"（Layer 1/2/3）与"流程步骤"（Step 5/6/7）的区别
- **[P1]** `CHANGELOG.md`: 补全 7.37.6-7.40.1 版本链接，修复 [Unreleased] 指向

## [7.40.1] - 2026-01-18

### Fixed
- **[HIGH]** `pr-gate.sh`: 检查 `.quality-report.json` 的 `branch` 字段是否匹配当前分支，防止旧报告绕过检查
- **[HIGH]** `cleanup.sh`: 删除 `.quality-report.json`，防止残留影响下次开发
- **[HIGH]** `branch-protect.sh`: 新分支首次写代码时，自动清理旧分支的质检报告

## [7.40.0] - 2026-01-18

### Fixed
- **[CRITICAL]** 从 git 移除 node_modules（1038 个文件，占仓库 95%）
- **[CRITICAL]** `project-detect.sh`: 添加 JSON 字符串转义，防止项目名含引号时破坏 JSON
- **[CRITICAL]** `project-detect.sh`: 修复 for 循环缩进，Monorepo 依赖图生成逻辑正确
- **[HIGH]** `session-init.sh`: 修复步骤映射错位，"下一步"提示与 11 步流程对齐
- **[HIGH]** `.git/hooks/pre-commit`: 修复新分支无上游时的语法错误
- `.gitignore`: 添加生成文件忽略（.project-info.json, .dev-step, .quality-report.json, .test-level.json）

### Changed
- 版本号跳跃到 7.40.0 标记重大修复（仓库瘦身 95%）

## [7.39.4] - 2026-01-18

### Fixed
- `VALIDATION.md`: 重写步骤映射表，对齐 11 步流程（被 .gitignore 忽略的本地文件）
- `stop-gate.sh`: 重构为统一的 case 语句，覆盖 step 0-11
- `03-branch.md`: 修正 L142 "下一步: Step 4 (写代码)" → "Step 4 (DoD)"
- `cleanup.sh`: 统一步骤编号注释（5.5→6, 6→7, 7→8, 8→9）
- `02-detect.md`: 修正 L118-127 步骤引用（Step 5/6 → Step 6/7）

## [7.39.3] - 2026-01-18

### Fixed
- `stop-gate.sh`: 重写步骤定义为 11 步流程
- `wait-for-merge.sh`: 修复回退逻辑（step 3→4，循环 4→5→6 改为 5→6→7）
- `check.sh`: 修复 Step 10→11（Cleanup 是 Step 11）
- `session-init.sh`: 添加 step 11 处理（任务完成）
- `cleanup.sh`: 修正步骤序号注释（9→10）
- `VALIDATION.md`: 更新为 11 步流程
- `ARCHITECTURE.md`: 修正 Step 10 描述（Learning 必须，Cleanup 是 Step 11）

## [7.39.2] - 2026-01-18

### Fixed
- 修复失败返回逻辑描述：统一为"返回 Step 4"（而非 Step 5）
  - `skills/dev/steps/07-quality.md`: 所有失败场景改为"返回 Step 4 重新开始"，循环描述为"5→6→7"
  - `skills/dev/steps/09-ci.md`: CI 失败回退改为"回退 step 4"，循环描述为"5→6→7"
  - `skills/dev/SKILL.md`: 失败返回逻辑改为"返回 Step 4（从 Step 5 重新开始，5→6→7 循环）"
- 逻辑说明：失败时 pr-gate.sh 设置 step=4（DoD 完成），然后从 Step 5（写代码）重新开始，循环为 5→6→7

## [7.39.1] - 2026-01-18

### Fixed
- `branch-protect.sh`: 更新步骤编号为 11 步（step >= 4 才能写代码）
- `pr-gate.sh`: 更新步骤编号（step >= 7 才能提 PR，回退到 step 4）
- `03-branch.md`: 修正 step 说明

## [7.39.0] - 2026-01-18

### Changed
- 重构 /dev 开发流程为 11 步（原 10 步）
  - Step 1: PRD 确定（有头/无头两入口）
  - Step 2: 检测项目环境
  - Step 3: 创建分支
  - Step 4: 推演 DoD
  - Step 5: 写代码
  - Step 6: 写测试
  - Step 7: 质检（三层）
  - Step 8: 提交 PR
  - Step 9: CI（绿自动合并）
  - Step 10: Learning（必须记录）
  - Step 11: Cleanup

### Added
- `01-prd.md`: PRD 模板新增"成功标准"字段
- `02-detect.md`: 项目环境检测步骤
- `03-branch.md`: 分支创建步骤
- `07-quality.md`: 三层质检人话版（typecheck/lint/test 解释）
- `10-learning.md`: 必须记录 bug、优化点、影响程度

### Fixed
- 失败返回逻辑：Step 7 质检/Step 9 CI 失败返回 Step 5
- `cleanup.sh`: 更新 step 编号为 11
- `session-init.sh`: 更新步骤提示为 11 步

## [7.38.0] - 2026-01-18

### Added
- 三层质检体系：重构 Step 6 本地测试为系统化质检流程
  - 6.1 自动化测试：机器跑（typecheck, test, lint, build, shell）
  - 6.2 效果验证：Claude 主动验证（截图/curl/执行）
  - 6.3 需求验收：对照 DoD 逐项打勾
- `quality-loop.md`: 新增质检循环 Agent 定义
- `.quality-report.json`: 三层质检报告格式

### Changed
- `06-local-test.md`: 重写为三层质检文档
- `03-dod.md`: 添加 DoD → 质检映射规则（TEST→6.1, CHECK→6.2）
- `pr-gate.sh`: 新增三层质检报告检查

## [7.37.7] - 2026-01-18

### Fixed
- `wait-for-merge.sh`: 修复 URL 解析 bug
  - 之前的 sed 命令会删除 URL 中所有斜杠
  - 正确处理末尾斜杠和查询参数
- `multi-feature.sh`: 删除未使用的 `AHEAD` 变量和 `get_ahead_count` 函数

## [7.37.6] - 2026-01-18

### Fixed
- `wait-for-merge.sh`: 修复 GitHub API 权限问题（L1）
  - 使用 `gh run list` 替代 `check-runs` API 检查 CI 状态
  - 避免 403 权限错误导致无法正确判断 CI 状态
  - 改进 URL 解析，兼容末尾斜杠和查询参数
- `pr-gate.sh`: 修复 jq empty 导致脚本异常退出（L1）
  - `jq -r '... // empty'` 改为 `jq -r '... // ""'`
- `branch-protect.sh`: 同样修复 jq empty 问题（L1）
- `multi-feature.sh`: 修复分支切换失败后继续 merge 的问题（L1）
  - 切换失败时跳过该分支，避免在错误分支上执行 merge
- `project-detect.sh`: 添加跨平台 md5 计算（L2）
  - 兼容 Linux (md5sum) 和 MacOS (md5)
- `pr-gate.sh`: 修复 find 命令处理含空格文件名问题（L2）
  - 使用 `-print0` 和 `read -d ''` 安全处理

## [7.37.5] - 2026-01-18

### Fixed
- `wait-for-merge.sh`: CI 失败回退时增加 step >= 3 检查
  - step < 3 时不执行回退，提示先完成 PRD 和 DoD
  - 与 pr-gate.sh 保持一致的回退逻辑

## [7.37.4] - 2026-01-18

### Fixed
- `project-detect.sh`: 修复空数组在 `set -u` 下报错
  - 循环前检查 `${#PACKAGES[@]} -gt 0`
  - 使用 `${arr[@]+"${arr[@]}"}` 安全展开空数组
- `multi-feature.sh`: fallback 分支从 main 改为 develop
- `wait-for-merge.sh`: 嵌套命令失败未处理，拆分为独立步骤
- `check.sh`: 未完成检查时静默退出，添加 else 分支 exit 1
- `cleanup.sh`: checkout 失败后跳过删除本地分支操作
- `pr-gate.sh`, `stop-gate.sh`: 统一 `set -euo pipefail`，添加空变量保护
- `INTERFACE-SPEC.md`: prd-executor.json 标记为已完成

## [7.37.3] - 2026-01-18

### Fixed
- `project-detect.sh`: 修复 JSON 格式 bug
  - 依赖图数组元素现在正确用引号包裹
  - `array_to_json` 空数组现在返回 `[]` 而非 `[""]`
- `check.sh`: 修复对已删除 checkbox 格式的无效引用
  - 移除对 SKILL.md 中 `□`/`○` 字符的动态解析
  - 更新步骤名称 "清理阶段 (Step 6)" → "Step 10: Cleanup"
- 语法最佳实践修复：
  - `stop-gate.sh`, `pr-gate.sh`: shebang 改为 `#!/usr/bin/env bash`
  - `stop-gate.sh`: 未使用的 INPUT 变量改为 `cat > /dev/null`
  - `session-init.sh`: 移除冗余重定向 `2>&1`

## [7.37.2] - 2026-01-18

### Fixed
- 文档一致性修复：
  - CLAUDE.md: hooks 数量 4 个 → 5 个，添加 session-init.sh
  - SKILL.md: scripts 列表添加 scan-change-level.sh, multi-feature.sh
  - SKILL.md: Hooks 列表添加 project-detect.sh, session-init.sh
  - README.md: 添加 session-init.sh 链接、SessionStart hook 配置、表格说明

## [7.37.1] - 2026-01-18

### Fixed
- `pr-gate.sh`: 修复跨仓库文件写入时 hook 检查错误仓库的 bug
  - step=0 时质检失败不再错误地设为 step=3
  - 只有 step >= 3（DoD 已完成）时才回退到 step=3 重新循环
  - step < 3 时提示运行 /dev 完成 PRD 和 DoD

## [7.37.0] - 2026-01-18

### Added
- `session-init.sh`: 会话初始化 Hook（Notification）
  - 显示项目信息、分支状态、测试能力
  - 进行中任务显示 step 和下一步
  - 环境检查（gh, jq）

## [7.36.1] - 2026-01-18

### Fixed
- 移除 cleanup.sh 中的自动部署（避免 develop 污染生产环境）
- deploy.sh 改为手动执行，添加 `--from-main` 参数

## [7.36.0] - 2026-01-18

### Added
- 部署机制：`scripts/deploy.sh`
  - 同步 hooks/ → ~/.claude/hooks/
  - 同步 skills/ → ~/.claude/skills/

## [7.35.1] - 2026-01-18

### Fixed
- Cleanup 机制完善：
  - cleanup.sh: 添加删除 `.project-info.json` 缓存
  - cleanup.sh: 添加设置 `step=10` 完成标记
  - check.sh: 增强验证（缓存+未提交文件警告）
  - 10-cleanup.md: 更新文档与实现一致
- 术语统一：所有 "Hook 强制" → "Hook 引导"
- 删除 Codex 残留引用（INTERFACE-SPEC.md, ci.yml）
- 修复 Step 描述：Learn 在 Step 10 不是 Step 7

## [7.35.0] - 2026-01-18

### Added
- 失败自动回退到 step 3 实现循环引导
  - pr-gate.sh: 本地质检失败时回退
  - wait-for-merge.sh: CI 失败时回退
  - 输出循环路径提示：修代码(4) → 改测试(5) → 跑测试(6) → 再提PR(7)

### Changed
- 统一用词：Hook "强制" → "引导"（CI 是唯一强制检查）
- 统一回退目标：pr-gate 和 CI 都回退到 step 3
- SKILL.md 核心规则更新：明确 CI 是唯一强制检查

### Removed
- 删除所有 Codex 相关代码和文档引用
- 删除 DoD 锁定机制（防不住，改为引导）

## [7.34.2] - 2026-01-18

### Fixed
- 修复自洽性问题（深度检查发现）：
  - Step 5 前置条件：`>= 3` → `>= 4`（代码完成后才能写测试）
  - cleanup.sh: 移除从未使用的 `base` 配置项，只清理 `base-branch`
  - check.sh: git config 从"可跳过"改为必须清理
  - SKILL.md: pr-gate 质检项 4 → 6（加上 format 和 shell）

### Removed
- 删除 `detect-test-level.sh`（功能已合并到 `project-detect.sh`）

## [7.34.1] - 2026-01-18

### Fixed
- 修复文档引用不一致：
  - SKILL.md: `.test-level.json` → `.project-info.json`
  - 10-cleanup.md: `detect-test-level.sh` → 删除缓存触发重新检测
  - DOD-TEMPLATE.md: `detect-test-level.sh` → `project-detect.sh`

## [7.34.0] - 2026-01-18

### Changed
- 重构 `project-detect.sh`：统一项目检测入口
  - 自动检测项目类型、Monorepo 结构、包依赖图
  - 检测测试能力 L1-L6
  - 基于文件哈希缓存，避免重复扫描
  - 输出到 `.project-info.json`
- Step 1 改为只读取 `.project-info.json`，不重复扫描
- `pr-gate.sh` 改为检查 `.project-info.json`

### 自洽的质检体系

```
进入项目 → project-detect.sh 自动扫描 → .project-info.json
    ↓
Step 1: 读取项目信息（不重复扫描）
    ↓
Step 3: scan-change-level.sh --desc 推断层级
    ↓
Step 6: scan-change-level.sh 验证改动
    ↓
Step 7: pr-gate.sh 检查流程+质检
    ↓
CI: 最终验证
```

## [7.33.0] - 2026-01-18

### Added
- 自动扫描质检层级脚本 `scan-change-level.sh`
  - `--desc "描述"`: 根据需求描述推断层级
  - `--staged`: 扫描已暂存文件
  - 默认: 扫描 git diff 改动
- DoD 阶段自动扫描：根据 PRD 描述推断质检层级
- 本地测试阶段验证：扫描实际改动确认层级

### 自动推断规则
| 关键词 | 层级 |
|--------|------|
| 安全/认证/密码 | L6 |
| 性能/优化/缓存 | L5 |
| 页面/组件/UI | L4 |
| API/接口/数据库 | L3 |
| 函数/工具/逻辑 | L2 |
| 文档/配置 | L1 |

## [7.32.1] - 2026-01-18

### Fixed
- 删除不存在的 bash-guard.sh 引用，统一为 pr-gate.sh
- detect-test-level.sh 空数组输出修复（`[""]` → `[]`）
- 01-prepare.md 添加 `--save` 参数，确保创建 .test-level.json
- 更新 README.md hooks 配置（添加 stop-gate.sh）
- 更新 SKILL.md hook 说明（三个 Gate 架构）
- 08-ci-review.md 更新 hook 引用

## [7.32.0] - 2026-01-18

### Added
- Stop Hook (stop-gate.sh)：Claude 退出时检查任务完成状态
  - 检测当前 step 进度
  - 提示还有哪些工作没完成
  - 建议下一步操作

### 三个 Gate 完成
1. pr-gate.sh (PreToolUse) - PR 前流程+质检
2. GitHub CI - PR 后验证
3. stop-gate.sh (Stop) - 退出时检查

## [7.31.0] - 2026-01-18

### Changed
- pr-gate.sh 增加流程检查：
  - 检查 .test-level.json 是否存在（证明跑过检测）
  - 检查分支 step >= 6（本地测试通过）
- 现在 PR Gate 分两部分：流程检查 + 质检

## [7.30.0] - 2026-01-18

### Added
- 测试层级检测系统：detect-test-level.sh 自动检测项目 L1-L6 能力
- /dev 流程集成：
  - Step 1 (Prepare): 检测项目能力上限
  - Step 3 (DoD): 确认任务测试层级下限，触发能力升级
  - Step 10 (Cleanup): 记录更新项目能力

### Changed
- DoD 模板：新增测试层级配置部分

### 测试层级定义
- L1: 静态分析 (typecheck, lint, format)
- L2: 单元测试 (unit test)
- L3: 集成测试 (integration test)
- L4: E2E 测试 (playwright, cypress)
- L5: 性能测试 (benchmark)
- L6: 安全测试 (audit)

## [7.29.0] - 2026-01-18

### Changed
- PR Gate 完整实现 DoD 检查：typecheck → lint → format → test → build → shell
- CI 补全 DoD 检查：新增 typecheck、lint、format:check

### 质检覆盖
本地 Gate 和 CI 现在都跑完整的 DoD 检查项，两层保证。

## [7.28.0] - 2026-01-18

### Changed
- Hooks 架构简化：移除实验性状态机，保留 3 个核心 hook
- `bash-guard.sh` 重命名为 `pr-gate.sh`，专注 PR 前检查
- 删除 `hooks/state-machine/` 目录（实验证明不可靠）

### Removed
- 状态机相关文件：checkpoint.sh, state-tracker.sh, step-gate*.sh, stop-validator.sh
- 实验性 PRD/DoD 文档

## [7.27.1] - 2026-01-17

### Fixed
- 修复跨仓库文件写入时 branch-protect hook 检查错误仓库的 bug

## [7.27.0] - 2026-01-17

### Added
- `validateHooks()` 函数：验证全局 hooks 配置状态

## [7.26.0] - 2026-01-17

### Added
- `hello()` 函数：/dev 流程验证测试

## [7.25.0] - 2026-01-17

### Fixed
- 修复 symlink: `~/.claude/skills/dev` 指向正确位置
- 移除 audit SKILL.md 过时版本号引用

### Changed
- README.md 添加 bash-guard.sh 文档
- CLAUDE.md 目录结构更新（添加 hooks 详情、n8n、INTERFACE-SPEC.md）

## [7.24.0] - 2026-01-17

### Fixed
- 修复并行 subagents 竞态条件：从命令解析分支名，不再依赖 HEAD
- 修复负数步骤未拦截：正则匹配 `-?[0-9]+`

### Changed
- Hook 重命名：`pre-pr-check.sh` → `bash-guard.sh`（更准确反映双功能）
- 统一管理：bash-guard.sh 移入项目 hooks/ 目录并 symlink

## [7.23.0] - 2026-01-17

### Added
- 步骤回退支持：失败后可回退到 step 4 重试
- 本地 Claude review：在 `gh pr create` 前自动运行

### Changed
- 去掉 Codex：改用本地 Claude review（Max 订阅直接用）
- 更新文档：流程图、状态机、08-ci-review.md

### Fixed
- 步骤守卫允许回退到 step 4（之前只能递增）

## [7.22.0] - 2026-01-17

### Changed
- 改用本地 Claude Code review（删除 GitHub Action）

## [7.21.0] - 2026-01-17

### Added
- 步骤守卫 Hook：拦截 `git config branch.*.step N` 命令
- 强制顺序递增：N 必须 = current_step + 1，不能跳步
- 凭据验证：step 5→6 需要 npm test 通过

### Changed
- pre-pr-check.sh 扩展为 Bash 命令守卫（步骤守卫 + PR 前检查）
- SKILL.md 更新 Hook 强制执行文档

## [7.20.0] - 2026-01-17

### Added
- 步骤状态机：用 `git config branch.*.step` 追踪当前步骤
- Hook 检查：step >= 3 才能写代码
- 每个步骤文件加入前置条件和状态更新说明

### Changed
- CI 不再自动合并，需要手动确认
- cleanup.sh 清理 step 配置
- check.sh 检查 step 配置

### 强制流程
- 本地 Hook 强制：步骤不到不能写代码
- CI 强制：不自动合并，等所有检查通过

## [7.19.0] - 2026-01-17

### Changed
- /dev 流程重构：步骤编号从小数点改为整数 1-10
- 每步一个文件：`skills/dev/steps/01-prepare.md` ~ `10-cleanup.md`
- SKILL.md 精简为入口索引
- 删除旧的 `references/STEPS.md`

### 架构改进
- 修改某步骤只需改对应文件
- 增删步骤只需增删文件
- 减少上下文开销

## [7.18.0] - 2026-01-17

### Added
- PRD Gate 机制：cp-* 分支必须确认 PRD 后才能写代码
- git config branch.*.prd-confirmed 标记追踪 PRD 确认状态

### Changed
- branch-protect.sh：在 cp-* 分支额外检查 prd-confirmed
- cleanup.sh：清理时同时清理 prd-confirmed 标记
- check.sh：检查时同时检查 prd-confirmed 清理状态
- STEPS.md：Step 3 加设置 prd-confirmed，Step 6 加清理

## [7.17.0] - 2026-01-17

### Added
- cleanup.sh 脚本：完整的清理检查（8 项检查）
- wait-for-merge.sh 脚本：PR 合并轮询（CI + Codex 检查）
- Hook 测试覆盖检查：PR 前检查是否有新增测试文件
- vitest 覆盖率配置：50% 阈值（可逐步提高）

### Changed
- pre-pr-check.sh：加入测试覆盖检查
- STEPS.md Step 5.5：使用 wait-for-merge.sh 脚本
- STEPS.md Step 6：使用 cleanup.sh 脚本

## [7.16.0] - 2026-01-17

### Added
- /dev 流程加入写测试步骤（Step 4）：每个功能必须有对应测试
- /dev 流程加入质检闭环（Step 5.5）：CI + Codex review 自动轮询修复
- Hook 强制本地测试：PR 创建前必须跑 npm test

### Changed
- 更新 STEPS.md Step 4 详细说明写测试要求
- 更新 STEPS.md 新增 Step 5.5 质检闭环逻辑

## [7.15.1] - 2026-01-17

### Fixed
- audit skill: 添加 YAML front matter 使 Claude Code 能正确发现和加载

## [7.15.0] - 2026-01-17

### Added
- 新增 `/audit` skill：有边界的代码审计与修复
  - 分层标准：L1 阻塞性 / L2 功能性 / L3 最佳实践 / L4 过度优化
  - 明确的完成条件：L1+L2 清零即宣布完成
  - 防止无限深挖的反模式警告

## [7.14.8] - 2026-01-17

### Fixed
- multi-feature.sh: 使用 `while read` 替代 `for` 循环避免 word splitting 问题
- CI: 为 version-check 和 test jobs 添加显式 `permissions: contents: read`

## [7.14.7] - 2026-01-17

### Fixed
- STEPS.md: 更新版本标记从 v7.14.0 到 v7.14.7

## [7.14.6] - 2026-01-17

### Improved
- 统一所有脚本 shebang 为 `#!/usr/bin/env bash`（更好的跨平台兼容性）
- 统一所有脚本使用 `set -euo pipefail` 严格错误处理
- pre-pr-check.sh: 移除冗余的 npm test（CI 已负责测试）

## [7.14.5] - 2026-01-17

### Fixed
- CI: 添加 semver 格式验证（必须是 MAJOR.MINOR.PATCH）
- CI: Go 版本检测添加 head -1 防止多行匹配
- project-detect.sh: 合并重复的 git 检查，减少调用
- multi-feature.sh: 改进 merge 冲突指引，检查 abort 返回值
- check.sh: awk 添加 NR==1 限制只处理第一行

## [7.14.4] - 2026-01-17

### Fixed
- branch-protect.sh: 添加 jq 解析错误处理
- CI: 增强 auto-merge 失败提示（使用 ::error::）
- multi-feature.sh: grep 改用 -F 字面匹配
- STEPS.md: 修正 glob 模式为正则匹配
- check.sh: 添加网络超时控制（10 秒）

## [7.14.3] - 2026-01-17

### Improved
- project-detect.sh: 优化 git remote 检查逻辑
- SKILL.md: 添加相对路径说明
- branch-protect.sh: 添加项目边界检查（防止多项目误保护）

## [7.14.2] - 2026-01-17

### Fixed
- pre-pr-check.sh: 使用 subshell 避免改变调用者工作目录
- check.sh: 添加 set -o pipefail 确保管道错误被捕获
- check.sh: 修复 git ls-remote 输出解析（提取分支名而非原始输出）
- check.sh: 使用正则 =~ 替代 glob 模式匹配 feature/*
- multi-feature.sh: 添加 set -o pipefail
- multi-feature.sh: 改进 get_ahead_count_filtered 空输出处理

## [7.14.1] - 2026-01-17

### Fixed
- CI: 添加 develop 分支支持（之前只有 main 和 feature/*）
- CI: 用 jq 替换 sed 解析 JSON（更可靠）
- check.sh: 添加 UTF-8 locale 支持多字节字符
- check.sh: 支持 develop 作为合法的 base 分支
- STEPS.md: 更新过期版本号

## [7.14.0] - 2026-01-17

### Improved
- multi-feature.sh: 过滤 auto-backup 提交，显示更有意义的改动
- multi-feature.sh: 添加分支最后更新时间显示

## [7.13.0] - 2026-01-16

### Added
- Pre-PR Hook: 创建 PR 前强制检查 test 和 typecheck
- hooks/pre-pr-check.sh: 拦截 gh pr create，检查失败则阻止 PR

## [7.12.1] - 2026-01-16

### Improved
- multi-feature.sh: 显示具体的领先 commits 内容
- multi-feature.sh: 领先 0 commits 且落后的分支建议删除

## [7.12.0] - 2026-01-16

### Added
- 多 Feature 并行开发支持
- scripts/multi-feature.sh: 检测和同步多个 feature 分支
- Step 0.5: 开始时检测多 feature 状态（可选）
- Step 6.5: 结束时同步其他 feature 分支（可选）
- SKILL.md: 并行开发文档更新

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

[Unreleased]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.41.0...HEAD
[7.41.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.40.1...v7.41.0
[7.40.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.40.0...v7.40.1
[7.40.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.39.4...v7.40.0
[7.39.4]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.39.3...v7.39.4
[7.39.3]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.39.2...v7.39.3
[7.39.2]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.39.1...v7.39.2
[7.39.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.39.0...v7.39.1
[7.39.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.38.0...v7.39.0
[7.38.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.7...v7.38.0
[7.37.7]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.6...v7.37.7
[7.37.6]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.5...v7.37.6
[7.37.5]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.4...v7.37.5
[7.12.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.12.0...v7.12.1
[7.12.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.11.1...v7.12.0
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
[7.37.4]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.3...v7.37.4
[7.37.3]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.2...v7.37.3
[7.37.2]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.1...v7.37.2
[7.37.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.37.0...v7.37.1
[7.37.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.36.1...v7.37.0
[7.36.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.36.0...v7.36.1
[7.36.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.35.1...v7.36.0
[7.35.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.35.0...v7.35.1
[7.35.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.34.2...v7.35.0
[7.34.2]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.34.1...v7.34.2
[7.34.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.34.0...v7.34.1
[7.34.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.33.0...v7.34.0
[7.33.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.32.1...v7.33.0
[7.32.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.32.0...v7.32.1
[7.32.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.31.0...v7.32.0
[7.31.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.30.0...v7.31.0
[7.30.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.29.0...v7.30.0
[7.29.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.28.0...v7.29.0
[7.28.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.27.1...v7.28.0
[7.27.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.27.0...v7.27.1
[7.27.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.26.0...v7.27.0
[7.26.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.25.0...v7.26.0
[7.25.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.24.0...v7.25.0
[7.24.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.23.0...v7.24.0
[7.23.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.22.0...v7.23.0
[7.22.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.21.0...v7.22.0
[7.21.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.20.0...v7.21.0
[7.20.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.19.0...v7.20.0
[7.19.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.18.0...v7.19.0
[7.18.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.17.0...v7.18.0
[7.17.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.16.0...v7.17.0
[7.16.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.15.1...v7.16.0
[7.15.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.15.0...v7.15.1
[7.15.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.8...v7.15.0
[7.14.8]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.7...v7.14.8
[7.14.7]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.6...v7.14.7
[7.14.6]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.5...v7.14.6
[7.14.5]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.4...v7.14.5
[7.14.4]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.3...v7.14.4
[7.14.3]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.2...v7.14.3
[7.14.2]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.1...v7.14.2
[7.14.1]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.14.0...v7.14.1
[7.14.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.13.0...v7.14.0
[7.13.0]: https://github.com/perfectuser21/zenithjoy-engine/compare/v7.12.1...v7.13.0
