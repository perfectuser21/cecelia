# Changelog

All notable changes to ZenithJoy Engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [11.24.2] - 2026-02-01

### Added

- **cleanup.sh 验证机制** - 添加 3 个关键验证确保清理流程完整性
  - 验证所有 11 步完成后才删除 .dev-mode（防止过早删除循环控制文件）
  - 验证 .dev-mode 删除成功（防止文件残留导致 Stop Hook 干扰）
  - 验证 gate 文件存在（警告模式，提示缺失的 gate 文件）
  - 新增 7 个自动化测试：`tests/scripts/cleanup-validation.test.ts`
  - 更新 feature-registry.yml (P3: Quality Reporting v11.24.2)

### Fixed

- **版本号同步** - 修复多处版本号不一致问题
  - 同步更新 VERSION、.hook-core-version、hook-core/VERSION 三处版本号
  - 修复 CI 测试失败（版本号不匹配）

### Documentation

- **开发经验记录** - LEARNINGS.md 更新到 v1.8.0
  - 记录版本号同步问题（4 处版本号必须同步）
  - 记录 Impact Check 强制执行机制
  - 记录 PRD/DoD 文件清理时机
  - 记录临时文件残留问题和解决方案

## [11.24.1] - 2026-02-01

### Fixed

- **Stop Hook 循环机制修复** - 修复 3 个 Critical 问题确保 /dev 流程自动执行
  - 删除 `stop_hook_active` 1 次重试限制，改为 20 次计数器（`retry_count` 字段）
  - 删除 PR 合并后的提前退出逻辑（Line 217-253），统一退出条件为 `cleanup_done: true` 或 11 步全部完成
  - 修复分支不匹配时的 .dev-mode 泄漏，检测到不匹配时删除文件而非仅跳过
  - 实现 11 步 Checklist 追踪机制（`step_1_prd` ~ `step_11_cleanup` 状态字段）
  - 扩展 Cleanup 脚本清理列表，添加所有 gate 文件（`.gate-prd-passed` 等）
  - 更新所有 steps/*.md 文件，添加步骤完成标记和"立即执行下一步"提示
  - 新增 4 个自动化测试：`tests/hooks/stop-hook-retry.test.ts`, `tests/hooks/stop-hook-exit.test.ts`, `tests/dev/checklist.test.ts`, `tests/scripts/cleanup.test.ts`

## [11.21.0] - 2026-02-01

### Changed

- **Gate 循环模式 B 优化** - 完整实现主 Agent 改 + 外部循环的职责分离架构
  - 修改 `skills/gate/SKILL.md` - 明确定义模式 B（Subagent 只审核，主 Agent 负责修复）
  - 修改 `skills/gate/gates/dod.md` - 添加"只审核，不修改"警告
  - 修改 `skills/gate/gates/test.md` - 添加"只审核，不修改"警告
  - 修改 `skills/gate/gates/audit.md` - 添加"只审核，不修改"警告
  - 新建 `skills/gate/gates/qa.md` - 完整的 QA 决策审核标准
  - 新建 `skills/gate/gates/learning.md` - 完整的 Learning 记录审核标准
  - 修改 `skills/dev/steps/01-prd.md` - 添加完整的循环控制代码（MAX_GATE_ATTEMPTS=3）
  - 修改 `skills/dev/steps/04-dod.md` - 添加 gate:dod 和 gate:qa 并行执行的循环控制
  - 修改 `skills/dev/steps/05-code.md` - 添加 gate:audit 循环控制
  - 修改 `skills/dev/steps/06-test.md` - 添加 gate:test 循环控制
  - 修改 `skills/dev/steps/10-learning.md` - 添加 gate:learning 循环控制
  - 修改 `scripts/gate/generate-gate-file.sh` - 支持所有 6 种 gate（prd|dod|test|audit|qa|learning）
  - 新建 `docs/GATE-LOOP-MODE-ANALYSIS.md` - 10 维度对比分析和决策矩阵（4.85 vs 2.05）
  - 新建 `tests/gate/generate-gate-file.test.ts` - 验证所有 6 种 gate 类型支持
  - 删除 `docs/RALPH-LOOP-INTERCEPTION.md` 等 5 个 Ralph Loop 相关文档（消除冲突信息）

## [11.20.0] - 2026-02-01

### Added

- **AI 自我检测硬规则** - 防止 AI 建议手动操作绕过自动化流程
  - `skills/dev/SKILL.md` 新增"⛔ 绝对禁止行为"章节（前 100 行内）
  - `/home/xx/.claude/CLAUDE.md` 新增"⛔ AI 自我检测"章节（前 50 行内）
  - 11 条禁止话术清单：手动创建 PR、手动运行、暂时禁用 Hook、需要用户确认、让用户手动做、绕过等
  - 11 个关键词触发自检：手动、您可以、暂时禁用、等待用户、需要确认、绕过、临时、跳过、忽略、先不管、稍后
  - 对比表格：AI 默认倾向 vs 正确行为
  - 说明 Stop Hook 循环机制确保自动重试

## [11.19.0] - 2026-02-01

### Changed

- **Gate Skill 调用方式优化 (G3)** - 将所有 dev 工作流中的 gate subagent 调用从 Task(general-purpose) 改为 Skill()
  - 修改 `skills/dev/steps/01-prd.md` - gate:prd 使用 Skill 调用
  - 修改 `skills/dev/steps/04-dod.md` - gate:dod 和 gate:qa 使用 Skill 调用
  - 修改 `skills/dev/steps/05-code.md` - gate:audit 使用 Skill 调用
  - 修改 `skills/dev/steps/06-test.md` - gate:test 使用 Skill 调用
  - 修改 `skills/dev/steps/10-learning.md` - gate:learning 使用 Skill 调用
  - 删除所有冗长的内联 prompt，简化为简洁的 Skill 调用
  - 配合全局 gate skill 的 checklist 机制，提高代码可维护性

## [11.18.0] - 2026-01-31

### Added

- **Stop Hook TTY 会话隔离 (H7-008)** - 有头模式下使用 TTY (`/dev/pts/N`) 作为会话标识
  - `.dev-mode` 文件新增 `tty:` 字段
  - Stop hook 检查当前 TTY 与文件中 TTY 是否匹配，不匹配则 exit 0
  - 防止多 terminal 窗口同时使用 Claude Code 时 stop hook 串线
  - 向后兼容：无 `tty:` 字段时跳过 TTY 检查，继续 session_id 检查
- **H7-008 回归契约** - 新增 TTY 隔离 RCI
- **TTY 隔离测试** (`tests/hooks/stop-hook.test.ts`) - 6 个新测试用例

## [11.17.0] - 2026-01-31

### Added

- **Gate Subagent 硬门禁令牌机制** (`hooks/mark-subagent-done.sh`, `hooks/require-subagent-token.sh`)
  - PostToolUse[Task] hook: gate subagent PASS 后自动写令牌到 `.git/.gate_tokens/`
  - PreToolUse[Bash] hook: 校验令牌才放行 `generate-gate-file.sh`，一次性消费
  - 防伪造: 阻止通过 Bash 直接操作 `.gate_tokens/` 目录
  - 令牌绑定 session_id + nonce，防跨会话复用
- **Gate Token 测试** (`tests/hooks/gate-token.test.ts`) - 14 个测试用例

### Fixed

- **pr-gate-v2.sh gate 验签 bug**: `|| true` 吞掉 exit code 导致签名验证是死代码
- **Branch Protection ci-passed**: required status check 从 `test` 改为 `ci-passed`

## [11.16.0] - 2026-01-31

### Added

- **Worktree 自动检测与创建** (`skills/dev/steps/00-worktree-auto.md`)
  - Step 0 前置步骤：/dev 启动时自动检测主仓库 .dev-mode 冲突
  - 僵尸 .dev-mode 检测：超过 2 小时或分支不存在 → 自动清理
  - 活跃冲突时自动创建 worktree + cd + 安装依赖
  - PRD 文件直接在 worktree 中创建，避免 copy 问题

### Changed

- **worktree-manage.sh**: `cmd_create` 加 flock 锁防止并发竞争
- **Step 3 (03-branch.md)**: 冲突检测从 exit 1 改为自动 worktree 兜底
- **Step 2 (02-detect.md)**: 移除重复的 worktree 检测段（职责移到 Step 0）
- **SKILL.md**: 加载策略和流程图增加 Step 0
- **FEATURES.md**: W6 更新说明

## [11.15.0] - 2026-01-31

### Added

- **共享工具库 `lib/lock-utils.sh`**
  - `.dev-mode` 文件并发锁（flock）：`acquire_dev_mode_lock` / `release_dev_mode_lock`
  - 原子写入/追加：`atomic_write_dev_mode` / `atomic_append_dev_mode`（mktemp + mv）
  - 会话隔离：`get_session_id` / `check_session_match`
  - 协调信号：`create_cleanup_signal` / `check_cleanup_signal` / `remove_cleanup_signal`

- **共享工具库 `lib/ci-status.sh`**
  - 统一 CI 状态查询：`get_ci_status`（带重试，默认 3 次）
  - 便捷判断：`is_ci_passed` / `is_ci_running` / `is_ci_failed`
  - 失败日志：`get_failed_run_id`

- **session_id 机制**（.dev-mode 新字段）
  - 分支创建时生成 session_id（优先 CLAUDE_SESSION_ID 环境变量）
  - stop.sh 验证 session_id 匹配，不匹配则允许结束（同分支多会话隔离）
  - 向后兼容：无 session_id 字段时回退到仅分支匹配

- **并发安全测试** `tests/hooks/concurrency.test.ts`（22 个测试）
  - 锁获取/释放、session_id 验证、原子操作、协调信号、CI 状态查询

### Changed

- **hooks/stop.sh v11.16.0**: 使用共享库 + session_id 验证
- **skills/dev/scripts/cleanup.sh v1.9**: 使用原子操作追加 cleanup_done
- **skills/dev/steps/03-branch.md**: 生成 session_id 写入 .dev-mode

## [11.14.2] - 2026-01-31

### Fixed

- **Stop Hook 会话隔离 (P0-3)**
  - 问题：多个 Claude 会话在同一项目工作时"串线"，一个会话被迫接手另一个会话的任务
  - 原因：Stop Hook 检测到 `.dev-mode` 存在就阻止结束，不管是哪个会话创建的
  - 修复：检查 `.dev-mode` 中的 `branch:` 是否与当前分支匹配，不匹配则忽略

## [11.14.1] - 2026-01-31

### Changed

- **Subagent Gate 统一命名**
  - 统一所有 Gate 命名：gate:prd, gate:dod, gate:qa, gate:audit, gate:test, gate:learning
  - 在 steps 文件中嵌入完整审核规则（从 gates/*.md 复制）
  - 明确循环逻辑：FAIL → 修改 → 再审核 → 直到 PASS

### Fixed

- **Subagent 规则挂载问题**
  - 之前：Subagent prompt 只写"参考 skills/xxx"，但 Subagent 拿不到文件
  - 现在：完整规则直接嵌入 prompt，Subagent 可正确执行审核

## [11.14.0] - 2026-01-31

### Added

- **cleanup.sh v1.8**: PRD/DoD 归档到 `.history/` 目录
  - 新增 `archive_prd_dod()` 函数
  - 步骤 7.5 在删除前先归档
  - 归档格式：`{branch}-{date}.{prd|dod}.md`
  - `.gitignore` 新增 `.history/` 和 `.dev-runs/`

## [11.13.1] - 2026-01-31

### Fixed

- **branch-protect.sh v19**: 支持 monorepo 子目录的 PRD/DoD 文件检测
  - 修复正则只匹配根目录的问题（如 `apps/core/.prd.md` 无法识别）
  - 8 处正则修改：PRD_IN_BRANCH, PRD_STAGED, PRD_MODIFIED, PRD_UNTRACKED,
    DOD_IN_BRANCH, DOD_STAGED, DOD_MODIFIED, DOD_UNTRACKED

## [11.13.0] - 2026-01-30

### Changed

- **CI 架构简化**
  - 删除 `cleanup-prd-dod` job（push 后清理改为 PR 前阻止）
  - 新增 PRD/DoD Gate：阻止 PRD/DoD 文件进入 develop/main PR
  - `release-check` 移除 L2A/L4 检查（功能验收在功能分支完成）
  - `l2b-check` 只对 PR to develop 运行，release 跳过
  - 新增 CHANGELOG 检查（release PR 必须有当前版本条目）

### Added

- **版本同步脚本**
  - 新增 `scripts/sync-version.sh`
  - 从 package.json 同步版本到 VERSION, hook-core/VERSION, regression-contract.yaml
  - 支持 `--check` 模式（CI 只检查不修改）

### Design

- **CI 检查职责分离**
  - 功能分支 → develop: L1 + L2A + L2B + L3 子集 + DevGate
  - develop → main: L1 + L3 全量 + CHANGELOG（无 L2A/L2B/L4）
  - PRD/DoD 通过 Gate 阻止，不再需要 push 后清理

## [11.12.4] - 2026-01-30

### Added

- **本地版本检查（警告模式）**
  - `pr-gate-v2.sh` 添加 Part 1.5 版本号检查
  - 比较 package.json 与 develop 分支版本
  - `chore:/docs:/test:` commit 跳过检查
  - 仅警告不阻止，CI 做强制检查

### Documented

- **P2-1: Gate 文件检查不一致**
  - 分析确认：本地 gate 文件和 CI evidence 是独立互补机制
  - 无需修复，设计合理

- **P2-2: PRD/DoD 验证规则不一致**
  - 分析确认：CI 故意更严格，分层设计
  - 本地快速反馈，CI 严格把关

- **P3-1: RCI 自动化覆盖率**
  - 审查 41 个 manual RCIs
  - 确认大多需要人工验证 UX，无法自动化

- **P3-2: metrics 时间窗口测试**
  - 确认 skip 合理，临时目录隔离问题

## [11.12.3] - 2026-01-30

### Fixed

- **测试清理（第二批）**
  - 删除 17 个 detect-priority.test.ts 中失效的 skip 测试
  - 删除 3 个 pr-gate-phase1.test.ts 中失效的 skip 测试
  - 原因：PR_TITLE 检测功能已在 detect-priority.cjs 移除

## [11.12.2] - 2026-01-30

### Security

- **P0-1: auto-merge check_suite 漏洞修复**
  - 移除 `on.check_suite` 触发器，防止外部 CI 绕过 approval 直接合并
  - 简化 job if 条件和 concurrency group

- **P0-2: ci-passed 跳过逻辑修复**
  - PR 到 develop 时：regression-pr 必须成功（不允许 skipped）
  - PR 到 main 时：release-check 必须成功（不允许 skipped）

- **P1-1: ai-review continue-on-error 移除**
  - 不再隐藏 AI review 失败
  - 脚本内部已有 secret 缺失时的优雅跳过逻辑

## [11.12.1] - 2026-01-30

### Security

- **P0-1: Evidence 真实结果**
  - `generate-evidence.sh` 重写：从 `ci/out/checks/*.json` 汇总真实 CI 结果
  - `evidence-gate.sh` 重写：验证 required checks 全存在、ok=true、hash 防篡改
  - 新增 `write-check-result.sh`：CI 每步输出 check JSON
  - CI workflow 拆分为独立步骤（TypeCheck/Test/Build/ShellCheck）

- **P0-2: manual: 后门封堵**
  - `check-dod-mapping.cjs` 修复：`manual:` 不再直接返回 valid=true
  - 必须在 evidence 中有 `manual_verifications` 记录
  - 新增 `add-manual-verification.sh`：添加手动验证证据

### Changed

- **P1-1: L2A/L2B 内容验证**
  - `l2a-check.sh`：PRD 必须 >=3 sections，每 section >=2 行
  - `l2a-check.sh`：DoD 每个验收项必须有 Test 映射
  - `l2b-check.sh`：Evidence 必须有可复现命令或机器引用

- **P1-2: RCI coverage 精确匹配**
  - `scan-rci-coverage.cjs`：移除 `name.includes()` 误判逻辑
  - 只允许精确路径匹配、目录前缀匹配、glob 通配符匹配

### Added

- `tests/ci/evidence.test.ts`：Evidence 生成和验证测试

## [11.11.0] - 2026-01-30

### Security

- **P0-2: Stop Hook 并发锁**
  - 添加 flock 并发锁防止多个会话同时操作 `.dev-mode` 文件
  - 锁文件放在 `.git/cecelia-stop.lock`
  - 等待最多 2 秒，拿不到锁则 exit 2 提示重试

- **P0-4: CI known-failures 白名单机制**
  - 新增 `ci/known-failures.json` 白名单定义
  - CI 严格验证：只允许白名单内的失败模式跳过
  - 规则：max_skip_count=3, require_ticket=true
  - 防止随意填写字符串绕过 CI 检查

### Fixed

- **P0-3: pr-gate 超时保护**
  - `verify-gate-signature.sh` 调用添加 10 秒超时
  - 超时时返回 exit 124 并明确提示
  - 防止验证脚本卡死导致 Hook 无限等待

- **P1-6: branch-protect skills 正则修复**
  - 使用 `grep -Eq` 替代 bash regex 进行路径匹配
  - 修复 `/.claude/skills/(dev|qa|audit|semver)` 分组失败问题
  - 确保 Engine 核心 skills 保护正常工作

## [11.10.0] - 2026-01-30

### Security

- **Gate 签名机制 v3：防止复用绕过**
  - 新增 `expires_at` + `expires_at_epoch` 字段，默认 30 分钟过期
  - 新增 `tree_sha` 字段，绑定代码树防止 amend 后复用
  - 新增 `repo_id` 字段，防止跨仓库复用 gate 文件
  - Secret 读取优先级：env → keychain → new path → old path → auto-generate
  - 向后兼容 v2 格式（带警告）

- **Verify 脚本 Exit Code 扩展 (v3)**
  - `exit 7`: Gate 文件已过期
  - `exit 8`: HEAD 不匹配（commit 或 tree 变化）
  - `exit 9`: Repo ID 不匹配

### Fixed

- **P0-1: 验证器缺失时的死锁问题**
  - 从硬阻止 `exit 2` 改为软警告，允许继续执行
  - 新项目不再因缺少 verify 脚本而无法创建 PR

- **P0-2: Stop Hook PR 合并后悬空问题**
  - PR 合并后自动执行 cleanup（删除 .dev-mode、切换分支、删除本地分支）
  - 不再只提示 "合并 PR" 然后卡住

### Added

- **Gate Signature v3 测试套件**
  - 测试过期检查、HEAD 绑定、Repo 绑定、签名验证
  - 测试 v2 向后兼容性

## [11.9.1] - 2026-01-30

### Security

- **CI 强制检查 PR 来源分支**
  - PR to main 只接受来自 develop 分支
  - 防止绕过 /dev 工作流直接合并到 main
  - 修复安全漏洞：`git checkout origin/develop -- .` 不触发 hooks

## [11.8.1] - 2026-01-30

### Fixed

- **Gate 签名算法安全修复**
  - `head_sha` 加入签名算法，防止跨 commit 复用 gate 文件
  - `head_sha` 成为必需字段，旧版 gate 文件会被拒绝
  - 参数命名统一：`timestamp` → `generated_at`
  - 工具版本号更新到 2.1.0

## [11.8.0] - 2026-01-30

### Added

- **Gate 文件防误用字段（方案 A）**
  - `head_sha`: 当前 commit SHA，防止旧文件跨 commit 复用
  - `generated_at`: ISO8601 时间戳，替代 `timestamp`
  - `task_id`: 从分支名提取（cp-xxx → xxx）
  - `tool_version`: 工具版本号 (2.0.0)

- **Verify 脚本 Exit Code 分层**
  - `exit 0`: 验证通过
  - `exit 3`: 验证器缺失/配置错误（secret 不存在）
  - `exit 4`: 输入格式错误/JSON 解析失败
  - `exit 5`: 签名/校验失败
  - `exit 6`: 分支/任务不匹配

- **PR Gate 硬失败机制**
  - `verify-gate-signature.sh` 不存在时直接 `exit 2`（不再跳过）
  - 根据不同 exit code 给出具体错误提示

### Changed

- **设计哲学（方案 A）**
  - Gate 文件是本地工作流的"自我约束"
  - CI 是"真正裁判"，运行自己的测试
  - Gate 文件留在 `.gitignore`，不进仓库

## [11.7.1] - 2026-01-30

### Fixed

- **Gate 签名机制 bug 修复**
  - Secret 读取时去除换行符 (`tr -d '\n\r'`)
  - 使用 `jq -n --arg` 生成 JSON，防止特殊字符破坏
  - 处理 jq 返回的 "null" 字符串

- **Gate 检查改为阻止型**
  - `pr-gate-v2.sh` v20: Gate 检查失败时 `exit 2` 阻止 PR 创建
  - CI DevGate checks: 添加 gate 文件签名验证

## [11.7.0] - 2026-01-30

### Added

- **Gate 强制执行机制** - 防止跳过 gate 审核
  - `scripts/gate/generate-gate-file.sh`: 生成带签名的 gate 通过文件
  - `scripts/gate/verify-gate-signature.sh`: 验证 gate 文件签名
  - `hooks/pr-gate-v2.sh` v19: 创建 PR 时检查所有 4 个 gate 文件

- **签名防伪机制**
  - Secret 存储在 `~/.claude/.gate-secret`（首次运行自动生成）
  - 签名算法: `sha256("{gate}:{decision}:{timestamp}:{branch}:{secret}")`
  - 验证分支匹配，防止跨分支复用

## [11.6.0] - 2026-01-30

### Added

- **Gate Skill 家族** - 独立质量审核机制
  - `skills/gate/SKILL.md`: Gate skill 入口定义
  - `skills/gate/gates/prd.md`: PRD 完整性、需求可验收性审核
  - `skills/gate/gates/dod.md`: PRD↔DoD 覆盖率、Test 映射有效性审核
  - `skills/gate/gates/test.md`: 测试↔DoD 覆盖率、边界用例审核
  - `skills/gate/gates/audit.md`: 审计证据真实性、风险点识别审核

- **/dev 流程集成 Gate 审核**
  - Step 1 后可调用 gate:prd
  - Step 4 后推荐调用 gate:dod（审核循环）
  - Step 6 后推荐调用 gate:test
  - Step 7 后推荐调用 gate:audit

### Changed

- **Gatekeeper Subagent 模式** - 解决"主 Agent 自己写、自己检查"问题
  - 每个 gate 通过 Task tool 启动独立 Subagent
  - FAIL 时返回具体问题和修复要求
  - 主 agent 必须修到 PASS 才能继续

## [11.5.0] - 2026-01-30

### Changed

- **放宽 skills 目录保护**（branch-protect.sh v18）
  - `hooks/branch-protect.sh`: 只保护 Engine 核心 skills（dev, qa, audit, semver）
  - 其他 skills（如 script-manager, credentials）可从任何 repo 部署
  - hooks 目录仍然全部保护（不变）
  - 支持 HR (Cecelia-OS) 和业务 repo 部署自己的 skills

## [11.4.1] - 2026-01-30

### Fixed

- **Stop Hook 跳过 Cleanup bug 修复**
  - `hooks/stop.sh`: 添加 `cleanup_done` 检测，PR 合并后不再直接删除 `.dev-mode`
  - `hooks/stop.sh`: PR 合并时改为 exit 2，触发 Step 11 (Cleanup) 执行
  - `skills/dev/scripts/cleanup.sh`: 在完成时写入 `cleanup_done: true` 标记
  - 新增测试: `tests/hooks/stop-hook.test.ts` (6 tests)

## [11.4.0] - 2026-01-29

### Added

- **Task Checkpoint 强制执行**
  - `hooks/branch-protect.sh v18`: 检查 `.dev-mode` 中的 `tasks_created: true` 字段
  - `skills/dev/steps/03-branch.md`: 分支创建后自动创建 11 个 Task（Step 1-11）
  - 所有 step 文件添加 TaskUpdate 指令（开始/完成状态）
  - 用户可实时看到 /dev 流程进度

### Changed

- **branch-protect.sh 升级到 v18**
  - 在 PRD/DoD 检查后增加 Task Checkpoint 检查
  - 缺少 `tasks_created: true` 时阻止写代码

## [11.3.0] - 2026-01-29

### Added

- **Stop Hook 循环控制器**（替代 Ralph Loop）
  - 新增 `hooks/stop.sh`: 检测 `.dev-mode` 文件，根据完成条件控制会话结束
  - `.dev-mode` 文件作为循环信号（Step 1 创建，Step 11 删除）
  - 完成条件检查：PR 创建 + CI 通过 + PR 合并
  - 无头模式支持：`CECELIA_HEADLESS=true` 时直接 exit 0

- **Worktree 自动检测**
  - `skills/dev/steps/02-detect.md`: 检测主仓库活跃任务，建议使用 worktree

### Changed

- **skills/dev/SKILL.md v2.3.0**
  - Stop Hook 替代 Ralph Loop 作为循环控制器
  - 移除 p0/p1/p2 阶段检测
  - 更新工作流程图和完成条件说明

- **步骤文件更新**
  - `skills/dev/steps/01-prd.md`: 添加 `.dev-mode` 文件创建
  - `skills/dev/steps/11-cleanup.md`: 添加 `.dev-mode` 文件删除

- **全局配置**
  - `~/.claude/settings.json`: 添加 Stop hook 配置

### Removed

- 移除对 Ralph Loop 插件的依赖
- 移除 p0/p1/p2 阶段检测逻辑

## [11.2.11] - 2026-01-28

### Added

- **测试覆盖率提升 Phase 1**
  - 新增 `tests/scripts/track.test.ts`: track.sh 核心功能测试（9 个用例）
  - 新增 `tests/scripts/safe-rm-rf.test.ts`: safe_rm_rf 安全验证测试（10 个用例）
  - 测试覆盖：分支级别文件隔离、向后兼容、路径验证、系统目录保护

## [11.2.10] - 2026-01-28

### Security

- **rm -rf 安全验证**
  - 新增 `safe_rm_rf()` 函数，验证路径非空、存在、在允许范围内
  - `worktree-manage.sh` v1.1.0: 使用安全删除
  - `cleanup.sh` v1.7: 使用安全删除
  - `deploy.sh` v1.1.0: 使用安全删除
  - 禁止删除根目录、home 目录等系统关键路径

## [11.2.9] - 2026-01-28

### Changed

- **Phase 5 关键问题清理**
  - 删除重复的 `contracts/` 目录，根目录 `regression-contract.yaml` 为唯一源
  - H7 Stop Hook 标记为 Deprecated（从未实现，已被 Ralph Loop + PR Gate 替代）
  - W5 Phase Detection 标记为 Deprecated（脚本从未实现）
  - 归档 `docs/PHASE-DETECTION.md` 到 `.archive/`
  - 移除 `impact-check.sh` 和 `09-ci.md` 中对不存在脚本的引用
  - 更新 `scan-rci-coverage.cjs` 使用根目录 regression-contract.yaml

## [11.2.8] - 2026-01-28

### Changed

- **Phase 4 文档矛盾清理**
  - 统一 `FEATURES.md` 和 `feature-registry.yml` 的状态定义
  - 将 H1/H2/H4 从 Stable 改为 Committed（有 RCI 覆盖）
  - 移除 regression-contract.yaml 中的 deprecated 字段

## [11.2.7] - 2026-01-28

### Changed

- **Phase 3 Promise 信号统一**
  - /dev 工作流完成信号统一为 `<promise>DONE</promise>`
  - 移除所有其他形式的完成标记

## [11.2.6] - 2026-01-28

### Fixed

- **跨仓库兼容性修复**
  - `track.sh`: 移除 `npm run coverage:rci` 依赖，改用条件检测
  - `track.sh`: 增加 worktree 模式支持（CECELIA_WORKTREE 环境变量）

## [11.2.5] - 2026-01-28

### Fixed

- **并发安全修复 Phase 1**
  - `track.sh`: 使用 mktemp + mv 原子写入，防止并发损坏
  - `track.sh`: 状态文件分支隔离 (`.cecelia-run-id-${branch}`)
  - `track.sh`: 移除不存在的 `update-task` API 调用
  - `pr-gate-v2.sh`: 使用 TEMP_FILES 数组统一管理临时文件，修复 trap 覆盖问题
  - `pr-gate-v2.sh`: 质检文件分支隔离 (`.quality-gate-passed-${branch}`)
  - `cleanup.sh`: 同步更新清理列表

## [11.2.4] - 2026-01-28

### Fixed

- **Release 模式跳过 PRD/DoD 检查**
  - l2a-check.sh release 模式不再要求 .prd.md 和 .dod.md
  - 修复 release PR 需要添加假文件的问题

## [11.2.3] - 2026-01-28

### Fixed

- **CI DevGate Check 只在 PR 事件运行**
  - 添加 `github.event_name == 'pull_request'` 条件

## [11.2.2] - 2026-01-28

### Fixed

- **CI L2A Check 只在 PR 事件运行**
  - 添加 `github.event_name == 'pull_request'` 条件
  - 修复 push 事件时 L2A Check 失败的问题

## [11.2.1] - 2026-01-28

### Fixed

- **CI DevGate 检查跳过 chore/docs/test PR**
  - 与 L2A check 保持一致，chore/docs/test PR 不需要 DoD 文件
  - 修复清理 PR 无法通过 CI 的问题

## [11.2.0] - 2026-01-28

### Added

- **分支级别 PRD/DoD 文件命名**
  - 新格式：`.prd-{branch}.md` 和 `.dod-{branch}.md`
  - 多个分支可以独立拥有各自的 PRD/DoD 文件
  - 解决多会话在同一 repo 工作时互相覆盖的问题

### Changed

- `hooks/branch-protect.sh` v17: 支持新格式，向后兼容旧格式
- `hooks/pr-gate-v2.sh` v4.2: 支持新格式，向后兼容旧格式
- `skills/dev/scripts/cleanup.sh` v1.4: 清理分支对应的 PRD/DoD 文件
- `.gitignore`: 忽略 `.prd-*.md` 和 `.dod-*.md` 文件

## [11.1.0] - 2026-01-28

### Removed

- **清理 Ralph Loop 架构**
  - 删除 `/home/xx/bin/dev-with-loop`（bash 脚本无法调用 Claude Code plugin 命令）
  - 删除 `scripts/detect-phase.sh`（/dev v2.2.0 已删除阶段检测）
  - 删除 `docs/RALPH_LOOP_WRAPPER.md`（过时文档）

### Changed

- **更新 Ralph Loop 使用方式**
  - 用户直接在 Claude Code 会话内输入 `/ralph-loop` 命令
  - 更新 `~/.claude/CLAUDE.md` 全局指南
  - 更新 `skills/dev/SKILL.md` 使用说明
  - 更新 `regression-contract.yaml` 测试步骤

## [11.0.0] - 2026-01-27

### Added

- **RISK SCORE 自动触发机制**
  - 新增 R1-R8 规则（Public API, Data Model, Cross-Module, Dependencies, Security, Core Workflow, Default Behavior, Financial）
  - 每个规则 1 分，≥3 分自动触发 QA Decision Node
  - 新增脚本：`scripts/qa/risk-score.js`、`scripts/qa/detect-scope.js`、`scripts/qa/detect-forbidden.js`
  - 集成到 /dev 工作流 Step 3

- **三层架构（Skills + Scripts + Templates）**
  - Layer 1: Skills (SKILL.md) - AI 操作手册
  - Layer 2: Scripts (*.js) - 可执行工具，实际计算/扫描
  - Layer 3: Templates (*.md) - 结构化输出格式
  - 明确分层职责，避免混淆

- **结构化 Audit 验证流程**
  - 新增脚本：`scripts/audit/compare-scope.js`、`scripts/audit/check-forbidden.js`、`scripts/audit/check-proof.js`、`scripts/audit/generate-report.js`
  - Scope 验证：对比实际改动与 QA-DECISION.md 允许范围
  - Forbidden 检查：确保未触碰禁区
  - Proof 验证：检查测试证据完成度
  - 自动生成结构化 AUDIT-REPORT.md

- **标准化模板**
  - `templates/QA-DECISION.md` - QA 合同模板
  - `templates/AUDIT-REPORT.md` - 审计报告模板
  - 固定 Schema，便于自动化解析和 Gate 检查

### Changed

- **skills/qa/SKILL.md v1.3.0**
  - 新增 RISK SCORE 自动触发机制章节
  - 添加 R1-R8 规则定义表格
  - 说明 /dev 流程集成方式
  - 相关脚本路径引用

- **skills/audit/SKILL.md v1.3.0**
  - 新增结构化验证流程章节
  - 添加四步验证流程（Scope → Forbidden → Proof → Report）
  - 集成到 /dev 工作流的示例代码
  - 相关脚本路径引用

### Breaking Changes

- QA Decision Node 不再由人工判断，改为 RISK SCORE >= 3 自动触发
- Audit Node 必须使用结构化脚本验证，不再接受纯 AI 审计
- docs/QA-DECISION.md 和 docs/AUDIT-REPORT.md 格式标准化，Gate 依赖固定 Schema

### Rationale

此次重构将 QA/Audit 系统从"AI 判断"升级为"合同验证"：
- QA Decision Node = 变更合同（BEFORE coding）
- Audit Node = 合同验收（AFTER coding）
- CI = 证据执行（evidence provider）

三层架构确保：
1. AI 有清晰的操作手册（SKILL.md）
2. 验证逻辑可追溯、可测试（scripts/）
3. 输出格式标准化（templates/）

RISK SCORE 机制实现自动化触发，避免人为主观判断。

## [10.13.1] - 2026-01-27

### Changed

- **修复 /dev 文档中的循环机制说明**
  - 删除 Stop Hook 相关说明（已过时）
  - 统一为"循环机制"概念
  - 明确两种实现：有头（/ralph-loop plugin）、无头（cecelia-run while 循环）
  - skills/dev/SKILL.md description 更新
  - 核心定位章节更新
- **pr-gate 降级为提示型 Gate**
  - 检查失败仅警告，exit 0（不阻断流程）
  - CI + branch protection 是唯一门槛
  - pr-gate 提供快速反馈，不是决定性检查

## [10.13.0] - 2026-01-27

### Changed

- **修复 /dev Skill v2.2（删除阶段 + 强制 Task Checkpoint）**
  - 删除 p0/p1/p2 阶段检测逻辑
  - 删除 detect-phase.sh 调用
  - 统一完成条件：PR 创建 + CI 通过 + PR 合并 = DONE
  - 新增官方 Task Checkpoint 使用规范（TaskCreate/TaskUpdate）
  - 执行流程图改为单一流程（不分阶段）
  - 核心规则更新为统一流程
  - skills/dev/SKILL.md 版本升级到 2.2.0
  - 更新 RCI: W7-001, W7-003

## [10.12.0] - 2026-01-27

### Changed

- **Ralph Loop Wrapper 修复（用户直接调用）**
  - 创建 `/home/xx/bin/dev-with-loop` 便捷命令
  - 自动检测阶段（p0/p1/p2/pending/unknown）并调用 Ralph Loop
  - skills/dev/SKILL.md 版本升级到 2.1.0
  - 删除 AI 内部 Ralph Loop 调用逻辑
  - 添加使用警告：不要直接调用 /dev
  - 简化职责：/dev 只负责流程编排
  - 完成信号统一为 DONE
  - 更新 ~/.claude/CLAUDE.md Ralph Loop 使用规则
  - 更新 RCI: W7-001, W7-003

## [10.11.0] - 2026-01-27

### Added

- **Evidence CI 化（SSOT - Single Source of Truth）**
  - CI 生成脚本：`ci/scripts/generate-evidence.sh`
  - CI 校验脚本：`ci/scripts/evidence-gate.sh`
  - Evidence 只在 CI 生成，永不 commit（避免 SHA 漂移）
  - 文件命名：`.quality-evidence.<SHA>.json`
  - .gitignore 更新：忽略 `.quality-evidence.*.json`
  - 本地 Fast Fail：新增 `npm run qa:local`（只跑 typecheck）
  - CI workflow 集成：在 test job 中添加 Evidence 生成和校验步骤

### Fixed

- **detect-priority.cjs L1 修复**
  - 修复 P0wer 被误识别为 P0 的问题
  - 直接输入模式跳过文件检测，只测试 extractPriority 逻辑
  - 改进正则匹配：确保 P[0-3] 后不跟字母

## [10.10.1] - 2026-01-27

### Changed

- **Ralph Loop 自动调用修复（统一循环机制）**
  - SKILL.md 开头添加 Ralph Loop 强制调用规则（最高优先级）
  - 删除所有"结束对话"、"允许结束"等误导性描述
  - 修改 p0/p1 流程图为 Ralph Loop 完成条件检查
  - Step 7 添加 Ralph Loop 循环提示
  - Step 8 修改为 Ralph Loop 完成条件检查说明
  - Step 9 完全重写为 Ralph Loop 启动指令，删除所有 while true 循环示例
  - 归档 09.5-pending-wait.md 到 .archive/
  - hooks/stop.sh 修复注释和 p0 阶段输出信息
  - ~/.claude/CLAUDE.md 添加 Ralph Loop 全局调用规则

## [10.9.5] - 2026-01-27

### Changed

- **Ralph Loop 文档修正**
  - 删除 docs/RALPH-LOOP-INTERCEPTION.md 中关于项目 Stop Hook 的错误描述
  - 明确说明 Ralph Loop 插件自己实现循环机制，通过 AI 检查条件并输出 promise 来控制
  - 删除 skills/dev/SKILL.md 中的 "Stop Hook 配合" 章节
  - 简化 Ralph Loop 工作原理描述，移除与 Stop Hook 的混淆
  - 禁用 .claude/settings.json 中的 Stop Hook 配置

## [10.9.4] - 2026-01-27

### Fixed

- **CI 规则检测逻辑修复**
  - Version Check 和 L2A Check 改用 `github.event.pull_request.title` 检测 PR 标题类型
  - 修复 PR #300 使用的 `github.event.head_commit.message` 在 PR context 中无效的问题
  - chore:/docs:/test: 类型的 PR 现在能正确跳过 L2A/Version 检查

## [10.9.3] - 2026-01-27

### Fixed

- **CI 规则优化**
  - L2A Check 跳过 chore: commits（清理类任务不强制要求 PRD/DoD）
  - Version Check 跳过 chore:/docs:/test: commits（非功能性改动不要求版本更新）
  - 修复每次 PR 都遇到的三个系统性问题：PRD/DoD missing、Version not updated、Evidence SHA mismatch

## [10.9.2] - 2026-01-27

### Fixed

- **CI: Release PR L2A 检查修复**
  - 修复 release PR (base=main) 在 test job 中 L2A pr-mode 检查失败问题
  - L2A Check 条件增加 `&& github.base_ref != 'main'`
  - release PR 跳过 test job L2A 检查，只运行 release-check job

## [10.9.1] - 2026-01-27

### Fixed

- **Self-Evolution 异步队列机制**
  - 修复 PRD/DoD 残留导致的无限循环问题
  - post-pr-checklist.sh 从报错模式改为记录到队列模式
  - 新增 scripts/cleanup-prd-dod.sh 自动清理脚本
  - 新增 docs/SELF-EVOLUTION-QUEUE.md 队列定义
  - CI 集成自动清理流程（develop/main 分支 push 后自动执行）
  - 更新 docs/SELF-EVOLUTION.md 工作流程说明（v2.0 异步模式）

## [10.8.3] - 2026-01-26

### Fixed

- **修复 QA Decision：更新为 PASS**
  - QA-DECISION.md Decision 从 MUST_ADD_RCI 更新为 PASS
  - RCI W1-004 已添加到回归契约

## [10.8.2] - 2026-01-26

### Fixed

- **修复 DoD 文件：恢复 detect-phase.sh 完整 DoD**
  - 恢复 12 项 DoD（detect-phase.sh 功能验收项）
  - 为每项添加正确的 Evidence 引用（使用反引号格式）
  - 修复 release-check 失败问题

## [10.8.1] - 2026-01-26

### Changed

- **文档更新：添加 Evidence 引用**
  - 更新 .dod.md - 为每个 DoD 项添加 Evidence 引用
  - 更新 .layer2-evidence.md - v10.8.0 证据（包含手动验证 + 自动化测试章节）
  - 满足 Release PR (develop → main) 的 L3 要求

## [10.8.0] - 2026-01-26

### Fixed

- **质量检查系统修复：添加 detect-phase.sh 脚本**
  - 新增 `scripts/detect-phase.sh`（阶段检测脚本）
  - Stop Hook 现在可以正确检测开发阶段（p0/p1/p2/pending/unknown）
  - 修复 Stop Hook line 74 调用 detect-phase.sh 失败问题
  - 新增 `docs/PHASE-DETECTION.md` 阶段检测文档

### Added

- **RCI 更新**
  - W1-004: detect-phase.sh 存在性检查

## [10.7.0] - 2026-01-25

### Changed

- **流程优化：移除空盒子 + Preflight 智能化**
  - **P0: 移除认知污染源**
    - 删除 `scripts/devgate/l3-fast.sh`（只打印占位符，不做实际检查）
    - 移除 package.json 中的 lint/format 占位符
    - 标注 AI Review 为 "Disabled"（VPS_REVIEW_URL 未配置）
  - **P1: Preflight 智能化**
    - 重写 `scripts/devgate/ci-preflight.sh` 为智能跳过逻辑
    - 只检查 `.quality-gate-passed` 新鲜度（< 5 分钟）+ SHA 匹配
    - 不再重跑 typecheck/test
  - **效果**
    - Hook 检查从 2 分钟降到 0.5 分钟（75% 提升）
    - 总流程从 7 分钟降到 5.5 分钟
    - 认知清晰：只有 qa:gate 跑测试（唯一权威）

## [10.5.0] - 2026-01-25

### Added

- **P0: CI L2A Gate（堵绕过路径）**
  - 新增 `scripts/devgate/l2a-check.sh`（pr/release 双模式）
  - CI test job 添加 L2A pr 检查（L1 之后、DevGate 之前）
  - CI release-check job 添加 L2A release 检查（更严格）
  - 检查 4 个文件：`.prd.md`、`.dod.md`、`docs/QA-DECISION.md`、`docs/AUDIT-REPORT.md`
  - 远端强制 L2A，`gh pr merge --auto` 无法绕过

- **P1: develop PR L3 子集（防分支腐烂）**
  - 新增 `regression-pr` job（条件：`base_ref == develop`）
  - 执行 `scripts/run-regression.sh pr`（RCI 子集）
  - develop PR 自动跑回归测试，防止分支积累技术债

- **P1: ci-passed 条件 needs（避免 pending）**
  - 使用 `always()` + result 检查正确处理条件 job
  - regression-pr 和 release-check 允许 skipped 状态
  - 避免某个 job skipped 导致 ci-passed 永久 pending

- **RCI 更新**
  - C2-002: CI L2A Gate (pr mode)
  - C2-003: CI L2A Gate (release mode)
  - C4-001: develop PR regression
  - C2-001: CI test job（更新说明）

### Fixed

- 修复 `regression-contract.yaml` YAML 语法错误（escape `\s` in grep regex）
- 解决 2 个 `pr-gate-phase1.test.ts` 测试失败

## [10.4.4] - 2026-01-25

### Fixed

- **真正移除 FAST_MODE（修复 PR #273 假修复问题）**
  - 删除 hooks/pr-gate-v2.sh 第 15-16 行的 `FAST_MODE=true` 配置
  - 删除第 245-253 行的快速模式提示
  - 删除所有测试命令中的 FAST_MODE 条件（4 处）
  - 确保 `grep "FAST_MODE" hooks/pr-gate-v2.sh` 返回空
  - 本地 PR 创建现在 100% 强制执行 L1 + L2A 检查（Ralph Loop 无限修复）

## [10.4.3] - 2026-01-25

### Fixed

- 移除 hooks/pr-gate-v2.sh 中的 FAST_MODE 配置
- 本地 PR Gate 强制执行 L1 + L2A 检查
- 统一本地和 CI 的分层标准：
  - 本地: L1 + L2A（失败 → Ralph Loop 无限循环修复）
  - CI → develop: L1 + L2A + L2B
  - CI → main: L1 ~ L4

## [10.4.2] - 2026-01-25

### Fixed

- 修复 pending 阶段行为描述，明确应该等待 CI 结果而不是退出
- 更新 scripts/detect-phase.sh 中 pending 阶段的 ACTION 说明
- 更新 skills/dev/SKILL.md 添加 pending 等待流程图
- 新增 skills/dev/steps/09.5-pending-wait.md 文档说明等待循环逻辑

## [10.4.0] - 2026-01-25

### Changed

- **P1 轮询循环 - 正确的两阶段分离**
  - Step 8 (08-pr.md): PR 创建后不调用 Step 9，由 Stop Hook 触发会话结束
  - Step 9 (09-ci.md): 改为完整的 while 轮询循环（在 P1 阶段执行）
    - 运行中/等待中：sleep 30s 后继续
    - 失败：修复代码 → push → continue（继续循环，不退出）
    - 成功：自动合并 PR → break（退出循环）
  - skills/dev/SKILL.md: 更新流程图和核心规则
  - 两阶段分离：
    - P0 (会话 1): 质检 → PR 创建 → 结束（不等 CI）
    - P1 (会话 2): 轮询循环 → 持续修复直到成功

### Added

- **regression-contract.yaml**: W1-008 - P1 阶段轮询循环（新增 RCI）
- **超时保护**: P1 轮询循环 1 小时超时自动退出

### Updated

- **regression-contract.yaml**: W1-004 - P0 阶段完整流程（Step 8 不调用 Step 9）
- **features/feature-registry.yml**: W1 feature 描述更新

## [10.3.0] - 2026-01-25

### Changed

- **术语更新**: Checkpoint → Task
  - 避免与官方 Claude Code Checkpoint（自动撤销功能）混淆
  - 官方 Checkpoint: 文件级别自动保存（Esc+Esc rewind）
  - 我们的 Task: 开发单元（1 个 PR）

- **文件更新**:
  - skills/dev/steps/03-branch.md - 添加概念说明
  - docs/INTERFACE-SPEC.md - API 完整更新（checkpoints → tasks）
  - templates/prd-schema.json - Schema 字段更新
  - templates/PRD-TEMPLATE.md - 模板更新
  - templates/prd-example.json - 示例更新
  - n8n/test-prd*.json - 测试文件更新
  - regression-contract.yaml - RCI 引用更新
  - skills/dev/scripts/track.sh - 脚本变量更新

## [10.2.0] - 2026-01-24

### Changed

- **skills/dev/steps/01-prd.md**: 清理垃圾提示词
  - 删除"等用户确认"、"用户确认后才能继续"
  - 改为"生成 PRD 后直接继续 Step 2"

- **skills/dev/steps/05-code.md**: 清理垃圾提示词
  - 删除"停下来，和用户确认"
  - 改为"更新 PRD，调整实现方案，继续"

### Removed

- **skills/dev/steps/02.5-parallel-detect.md**: 删除并行检测步骤
  - 不需要询问用户选择 worktree
  - 一次只做一个任务，自动检测即可

### Added

- **skills/dev/SKILL.md**: 多 Feature 支持文档
  - 简单任务：单 PR 流程（向后兼容）
  - 复杂任务：拆分 Features → 多个 PR
  - 状态文件格式：`.local.md` + YAML frontmatter（官方标准）
  - `/dev continue` 命令支持

### Fixed

- **skills/dev/steps/03-branch.md**: 清理过时示例
  - 移除 parallel-detect 分支命名示例
  - 更新 Checkpoint 示例，删除 CP-001-parallel-detect

## [10.0.2] - 2026-01-24

### Added

- **docs/production/PROD-READINESS.md**: v10.0.0 生产就绪报告
  - 三层防御体系实证验收
  - 验收完成度统计 (单元测试 186/186, RCI 13/13)
  - 核心机制说明 (GitHub 原生 Auto-merge, 两阶段工作流)
  - 生产使用指南和回归验证清单

## [10.0.1] - 2026-01-24

### Fixed

- **pr-gate-v2.sh**: 验证逻辑宽松匹配，避免误判
  - QA-DECISION.md Decision 字段支持 Markdown 标题和空格变化
  - AUDIT-REPORT.md Decision: PASS 大小写不敏感，增加 TBD 拦截
  - DoD 检查改为"全勾完成"而非"本次修改"，对齐两阶段工作流

## [10.0.0] - 2026-01-24

### BREAKING CHANGES

- **Contract Rebase**: 文档架构重构，建立单一事实源体系
  - `features/feature-registry.yml` 成为唯一的 Feature 定义位置
  - 所有其他文档（FEATURES.md, Minimal/Golden/Optimal Paths）变为派生视图
  - 旧的手动维护模式废弃，全部改为自动生成
  - 修改 feature 定义必须先更新 registry，再运行生成脚本

### Added

- **单一事实源**: `features/feature-registry.yml`
  - Platform Core 5: H1 (Branch Protection), H7 (Stop Hook), H2 (PR Gate), W1 (Two-Phase), N1 (Cecelia)
  - Product Core 5: P1 (Regression), P2 (DevGate), P3 (QA Reporting), P4 (CI Gates), P5 (Worktree)
  - 机器可读的 YAML 结构化定义，包含 entrypoints/golden_path/minimal_paths/tests/rcis

- **Contract 文档**:
  - `docs/contracts/WORKFLOW-CONTRACT.md` - 两阶段工作流契约（p0/p1/p2 状态机）
  - `docs/contracts/QUALITY-CONTRACT.md` - 三套质量分层体系（质检流程/问题严重性/测试覆盖度）

- **派生视图（自动生成，不可手动编辑）**:
  - `docs/paths/MINIMAL-PATHS.md` - 最小验收路径（每个 feature 1-3 条）
  - `docs/paths/GOLDEN-PATHS.md` - 端到端成功路径（GP-001 ~ GP-007）
  - `docs/paths/OPTIMAL-PATHS.md` - 推荐体验路径
  - `scripts/generate-path-views.sh` - 从 registry 生成视图的脚本

- **自动化防漂移机制**:
  - CI `contract-drift-check` job - 检测视图与 registry 不同步，失败时提供修复步骤
  - 强制开发者更新 registry 后运行生成脚本，确保一致性
  - 系统特性：可持续自动维护，防止"2 周后又漂移"

- **DRCA v2.0 事件驱动诊断闭环**:
  - `docs/runbooks/DRCA-v2.md` - 事件驱动诊断闭环
  - 核心变化：从"连续等待诊断"升级到"事件驱动诊断"
  - CI fail → 诊断 → 修复 → push → 退出 → 等待下次事件唤醒（不挂着）

- **RCI v2.0.0 语义对齐**:
  - **W1-004**: "Loop 1 循环" → "p0 阶段完整流程"（P0）
  - **W1-005**: "CI 失败后循环" → "p1 阶段事件驱动修复"（P0）
  - **W1-006**: 新增 "p2 阶段自动 merge"（P0）
  - **N1-004**: 新增 "p1 阶段无头修复语义"（P0）
  - **H7-001/002/003**: Stop Hook 质量门禁 RCI（P0）

- **验收清单**: `docs/CONTRACT-REBASE-ACCEPTANCE.md` - 94% 完成度追踪

### Changed

- **FEATURES.md**: 从独立文档变为派生视图，指向 registry 为真源
  - 添加 H7: Stop Hook Quality Gate（v2.0.0 核心）
  - 更新 W1: "11 步流程" → "Two-Phase Dev Workflow"
  - 更新 W5: "四模式" → "Phase Detection (p0/p1/p2/pending/unknown)"
  - 废弃 W3: "循环回退" → 被 p1 事件驱动循环替代
  - 添加 v2.0.0 重要变更说明，指向单一事实源

- **regression-contract.yaml**: 添加 H7/W1/N1 的 v2.0.0 RCI
  - H7: 3 条 RCI（p0 质检门禁 / p1 CI 状态 / 阶段检测集成）
  - W1: 更新 W1-004/005 语义，新增 W1-006（p0/p1/p2 完整覆盖）
  - N1: 新增 N1-004（p1 无头修复语义）

- **skills/dev/SKILL.md**: 更新流程图，对齐 v2.0.0 两阶段工作流

### Documentation

- `docs/ENFORCEMENT-REALITY.md` - Stop Hook 强制能力的现实
- 所有 Contract 和 Path 文档包含明确的来源说明和更新规则

## [9.5.0] - 2026-01-24

### Added

- **两阶段工作流**: 用 Stop Hook 强制本地质检（100% 强制能力）
  - 阶段 1: 本地开发 + 质检（Stop Hook 阻止未质检退出）
  - 阶段 2: 提交 PR + CI（服务器端验证）
  - hooks/stop.sh: 质检门控，检查 .quality-gate-passed 存在性和时效性
  - scripts/qa-with-gate.sh: 运行质检，成功时生成门控文件
  - npm run qa:gate: 带门控的质检命令
  - Retry Loop: AI 被迫循环直到质检通过
  - 时效性检查: 代码改动后质检结果失效，必须重新质检

### Changed

- **pr-gate-v2.sh v4.0**: 快速模式（FAST_MODE=true）
  - 只检查产物存在性，不运行测试
  - 测试已在阶段 1 通过 Stop Hook 强制完成
  - 减少 PR 创建等待时间

### Documentation

- **极简工作流**: PreToolUse + Ralph Loop + Stop Hook
  - docs/SIMPLIFIED-WORKFLOW.md: 极简流程说明（一句话：PreToolUse 管入口，Ralph Loop 自己跑，Stop Hook 管出口）
  - docs/COMPLETE-WORKFLOW-WITH-RALPH.md: Ralph Loop 完整流程图和使用示例
  - docs/TWO-PHASE-WORKFLOW.md: 两阶段工作流详细文档
  - 集成 Ralph Wiggum 官方插件（已安装）
  - 说明真正有强制能力的只有 2 个 Hook: PreToolUse:Write 和 Stop

- **8.x/9.0 要求验证**: 所有要求 100% 保留
  - docs/REQUIREMENT-VERIFICATION.md: 完整的要求对比和验证清单
  - Gate Contract 6 大红线: 全部保留（DoD、QA 决策、P0 检测、RCI、白名单、分支保护）
  - 新增 Stop Hook 强化: Audit + 测试 + 时效性检查（0% → 100% 强制能力）
  - Ralph Loop 100% 自动执行: 写代码 + 写测试 + 质检 + 失败重试

### Integration

- **Ralph Loop 集成**: 与 Stop Hook 协作实现自动质检循环
  - Ralph Loop: 外层循环，重复注入任务提示语
  - Stop Hook: 质检门控，跑不完不让结束
  - completion-promise: Ralph 的结束信号
  - max-iterations: 防止无限循环（双重保护）

## [9.4.1] - 2026-01-24

### Fixed

- **pr-gate-v2.sh v3.1**: 添加 timeout 保护，防止测试命令卡住
  - 所有测试命令（typecheck, lint, test, build, pytest, go test）添加 120s 超时
  - 超时时明确提示 `[TIMEOUT - 120s]` 而不是无限等待
  - 降级支持：系统没有 timeout 命令时直接运行（旧版 macOS）
  - 修复用户发现的关键漏洞：测试卡住时 Hook 永远等待的问题

## [9.4.0] - 2026-01-24

### Added

- **GitHub Actions Auto Merge**: 配置自动合并工作流
  - 在 PR approved + CI 通过后自动合并
  - 使用 squash merge 保持历史简洁
  - 适配 A+ (100%) Team Organization 保护要求
  - 超时 5 分钟避免配额浪费

### Changed

- **升级到 Team Organization**: A+ (100%) Branch Protection
  - required_approving_review_count: 1（必须人工审核）
  - restrictions: 空（禁止任何人直接 push）
  - enforce_admins: true（Admin 也必须遵守）
  - 转移仓库到 ZenithJoycloud Organization

## [9.3.6] - 2026-01-23

### Fixed

- **测试目录污染**: 修复 pr-gate-phase2.test.ts 污染 PROJECT_ROOT
  - 所有测试改用独立临时目录（带时间戳避免冲突）
  - 添加 beforeEach 清理，防止测试之间污染
  - 添加 afterAll 全局清理，防止残留文件
  - 修复 Hook 环境测试不稳定问题（186/186 稳定通过）

## [9.3.5] - 2026-01-23

### Fixed

- **release-check.sh 可移植性**: grep 无匹配时添加 `|| true`
  - 修复最后一个块（C4）处理时 `set -e` 导致脚本提前退出的问题

## [9.3.4] - 2026-01-23

### Fixed

- **release-check.sh 兼容性**: 使用 `sed '$d'` 替代 `head -n -1`
  - 处理最后一个块（无下一个 ###）的情况

## [9.3.3] - 2026-01-23

### Fixed

- **release-check.sh awk 模式 bug**: 使用 sed 替代 awk 提取证据块
  - 修复范围模式在同一行匹配开始和结束的问题

## [9.3.2] - 2026-01-23

### Changed

- **Release 证据补充**: 更新 .layer2-evidence.md 用于 v9.3.1 release

## [9.3.1] - 2026-01-23

### Fixed

- **H3-001 回归期望值**: 将 `hook-core version: 1.0.0` 改为通用匹配 `hook-core version:`
  - 避免版本升级时回归测试失败

## [9.3.0] - 2026-01-23

### Added

- **Worktree 并行开发检测**: 在 /dev 流程中自动检测活跃分支
  - 新增 `skills/dev/steps/02.5-parallel-detect.md`: 并行开发检测步骤
  - 新增 `skills/dev/scripts/worktree-manage.sh`: Worktree 管理脚本
    - `create <task-name>`: 创建新 worktree
    - `list`: 列出所有 worktree
    - `remove <branch>`: 移除指定 worktree
    - `cleanup`: 清理已合并的 worktree

- **Cleanup worktree 清理**: cleanup.sh 新增 Step 4.5
  - 自动检测并移除关联的 worktree
  - 安全处理未提交改动的情况

### Changed

- **SKILL.md**: 流程图更新，添加并行检测步骤
- **03-branch.md**: 添加 worktree 环境感知

---

## [9.2.0] - 2026-01-23

### 🎉 里程碑版本：完整质量保证体系

**核心成果**：建立"可证伪、可审计、可强制、可交叉验证"的质量保证体系。

#### Full-System Validation 7/7 全绿

| 验证项 | 结果 |
|--------|------|
| Gate Full Test | ✅ 52/52 |
| Regression Full Test | ✅ 186/186 |
| RCI Coverage | ✅ 100% (8/8) |
| Anti-Cheat Test | ✅ exit=1 |
| CI Integrity | ✅ 4/4 guards |
| GCI Draft | ✅ Working |
| Cross-Verify | ✅ 8=8 |

#### 四项核心验证

1. **可证伪** - 新增未覆盖入口 → exit code = 1
2. **可审计** - `--explain` 输出分母来源 + 匹配原因
3. **强制执行** - CI DevGate 阻塞未覆盖入口
4. **独立交叉验证** - `--stats` 分母核对 + 防篡改哨兵

#### 验证命令

```bash
npm run coverage:rci -- --explain  # 审计证据
npm run coverage:rci -- --stats    # 独立分母核对
bash scripts/devgate/assert-ci-guards.sh  # 防篡改哨兵
```

---

## [9.1.4] - 2026-01-23

### Added

- **scan-rci-coverage.cjs `--stats` 模式**: 独立分母核对
  - 用 find/ls 独立计数，与扫描器对比
  - 验证扫描器没有漏算

- **scripts/devgate/assert-ci-guards.sh**: 防篡改哨兵
  - 验证 CI 守门没有被移除
  - 检查 coverage:rci、version-check、DevGate、release-check

### Milestone

**独立交叉验证**: 从"自证"变成"可信"

四项验证全部完成：
1. ✅ 可证伪（反证能 fail）
2. ✅ 可审计（--explain 有分母来源 + 匹配原因）
3. ✅ 强制执行（CI 守门）
4. ✅ 独立交叉验证（--stats 分母核对 + 防篡改哨兵）

---

## [9.1.3] - 2026-01-23

### Added

- **scan-rci-coverage.cjs `--explain` 模式**: 输出详细审计证据
  - 分母验证：扫描规则 + 入口清单 + 文件存在性
  - 分子验证：命中的 RCI 条目 + 匹配原因

- **CI RCI 覆盖率守门**: DevGate 检查集成 `coverage:rci`
  - 新增业务入口必须添加 RCI 条目，否则 CI 失败
  - 失败时输出修复指引

### Milestone

**RCI 可验证性**: 100% 覆盖率现在是"可证伪的真实"，而不是"自嗨数字"

验证方式：
1. `npm run coverage:rci -- --explain` 查看审计证据
2. 新增入口不加 RCI → CI 阻塞

---

## [9.1.2] - 2026-01-23

### Added (RCI 条目补充)

- **C1-008**: /qa Skill 加载
- **C1-009**: /audit Skill 加载
- **C1-010**: /assurance Skill 加载
- **C3-004**: run-regression.sh 执行回归测试
- **C3-005**: qa-report.sh 生成报告
- **C3-006**: release-check.sh 发布检查

### Milestone

**RCI 覆盖率达到 100%** (8/8 业务入口)

从此进入增量维护模式：
- 新增业务入口 → 必须添加 RCI 条目
- Gate 改动 → 只更新 GCI（不影响 RCI）

---

## [9.1.1] - 2026-01-23

### Added

- **scripts/devgate/scan-rci-coverage.cjs**: RCI 覆盖率扫描器
  - 枚举业务入口（Skills, Hooks, Scripts）
  - 解析 RCI 并计算覆盖率
  - 生成 baseline-coverage.json 和 BASELINE-SNAPSHOT.md

- **tests/gate/scan-rci-coverage.test.ts**: 17 个单元测试

- **npm run coverage:rci**: 检查 RCI 覆盖率命令

### Baseline Snapshot

当前 RCI 覆盖率: 25% (2/8 业务入口)

未覆盖入口（需后续添加 RCI）：
- /qa, /audit, /assurance Skills
- run-regression.sh, qa-report.sh, release-check.sh

---

## [9.1.0] - 2026-01-23

### Added

- **scripts/devgate/draft-gci.cjs**: GCI 草稿自动生成
  - 分析 git diff，检测 Gate 相关文件改动
  - 自动生成契约草稿（YAML 格式）
  - 用法: `node scripts/devgate/draft-gci.cjs [--base <branch>] [--output <file>]`

- **tests/gate/draft-gci.test.ts**: 19 个单元测试
  - isGateFile: Gate 文件模式匹配
  - getCategory: GCI 分类映射
  - generateDraft: 草稿生成逻辑

### Changed

- **/assurance Skill**: 集成 draft-gci 自动化工具
- 体系从"手写契约"升级为"审核契约草稿"

---

## [9.0.0] - 2026-01-23

### 里程碑版本：RADNA 体系 + 全量审计 + Gate Test Suite

**核心成果**：建立"可封顶、可收口"的质量保证体系，终结 Gate/Regression/QA/Audit 的混乱。

---

### Added (RADNA 体系)

#### 4 层架构
| 层级 | 名称 | 文件 |
|------|------|------|
| L0 | Rules（宪法） | `docs/policy/ASSURANCE-POLICY.md` |
| L1 | Contracts（契约） | `contracts/gate-contract.yaml`, `contracts/regression-contract.yaml` |
| L2 | Executors（执行器） | `scripts/run-gate-tests.sh`, `scripts/run-regression.sh` |
| L3 | Evidence（证据） | `artifacts/QA-DECISION.md`, `artifacts/AUDIT-REPORT.md` |

#### /assurance Skill
- **skills/assurance/SKILL.md**: 统一的质量保证协调者
- 自动判断 PR 改动属于 Gate 还是 Business
- 强制更新对应契约（GCI / RCI）
- 自动生成 QA/Audit 产物

#### Gate Contract (GCI)
- **contracts/gate-contract.yaml**: 保护检查系统不会放错行
- 6 大红线：空 DoD、空 QA、优先级误判、CI 跳过、白名单穿透、误删分支

#### Regression Contract (RCI)
- **contracts/regression-contract.yaml**: 保护业务功能不回归
- 重新组织为 C1-C6 系列

---

### Added (Gate Test Suite)

- **tests/gate/gate.test.ts**: 16 个检查系统自测
  - A1: 空 DoD 必须 fail
  - A2: QA 决策空内容必须 fail
  - A3: P0wer 不应触发 P0 流程
  - A5: release 模式不跳过 L1 RCI
  - A6: 非白名单命令必须 fail
  - A7: checkout 失败后不删除分支

- **docs/KNOWN-ISSUES.md**: 6 个 B 层问题的触发条件和 workaround

---

### Fixed (全量审计 - 152 个问题)

#### hooks/ (24 个问题)
- **branch-protect.sh v16**: 非 git 仓库/空分支名改为 exit 2、realpath 兼容性
- **pr-gate-v2.sh v3.0**: 空 DoD 检查、QA 内容校验、jq 检查

#### scripts/devgate/ (25 个问题)
- **detect-priority.cjs**: 词边界修复（防止 P0wer 误匹配）、CRITICAL/HIGH/security 映射
- **metrics.cjs/append-learnings.cjs**: 修复参数解析双重递增 bug

#### scripts/ (30 个问题)
- **run-regression.sh**: npm 命令限制（只允许 test/qa/build/ci/install）
- **install-hooks.sh**: cp 失败时显示警告而非 OK
- **cleanup.sh**: checkout 失败时跳过远程分支删除

#### CI/YAML (22 个问题)
- **ci.yml**: ci-passed 依赖 release-check（PR to main 时）、fetch-depth: 0

#### TypeScript (22 个问题)
- 测试污染修复、输出格式更新

---

### Changed

- 测试数量从 134 增加到 150+
- 目录结构重组（contracts/, artifacts/, docs/policy/）

---

## [8.25.0] - 2026-01-23

### Fixed (P0 优先级检测 Bug 修复)

- **detect-priority.cjs**: 添加 CRITICAL→P0, HIGH→P1, security→P0 映射
- 21 个单元测试覆盖优先级检测

## [8.24.0] - 2026-01-23

### Security (CRITICAL 级安全修复)

- branch-protect.sh: JSON 预验证防止注入
- pr-gate-v2.sh: 命令执行安全加固
- run-regression.sh: 白名单限制

## [8.23.0] - 2026-01-22

### Added

- DoD ↔ Test 映射检查
- P0/P1 → RCI 更新检查
- 回归契约 v1.0（67 个条目）
