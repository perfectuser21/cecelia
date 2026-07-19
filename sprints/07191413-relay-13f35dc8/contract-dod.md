---
skeletal: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: relay-demo slugify CLI 合同

**范围**: `scripts/relay-demo/slugify.mjs` 的单文件 CLI 行为、`sprints/07191413-relay-13f35dc8/tests/` 的 Red 合同测试、合同文档与任务计划
**大小**: S

## PrepPRD 铁律断言

- `[ASSERT:PREPPRD:SCOPE_ONLY_SCRIPT_AND_SPRINT]` 只允许新增 `scripts/relay-demo/slugify.mjs` 与 `sprints/07191413-relay-13f35dc8/` 合同产物；不得要求修改 `packages/brain/src` 与 `migrations`
- `[ASSERT:PREPPRD:CLI_ONLY_NO_SCREENSHOTS]` 完成信号只允许使用 CLI、退出码、`stdout`、`vitest` 输出；不得包含截图或视觉断言
- `[ASSERT:PREPPRD:STRING_INPUT_ENTRY]` `scripts/relay-demo/slugify.mjs` 必须支持 Node CLI 字符串输入
- `[ASSERT:PREPPRD:THREE_BOUNDARY_CASES]` vitest 覆盖空字符串、普通短语、连续分隔符/非 ASCII 三个 case
- `[ASSERT:PREPPRD:DETERMINISTIC_NON_ASCII]` 非 ASCII 字符处理必须确定性且被测试覆盖
- `[ASSERT:PREPPRD:NO_EXTERNAL_DEPENDENCIES]` 不引入外部依赖
- `[ASSERT:PREPPRD:NO_OVERWRITE_EXISTING_TOOLS]` 不得修改或覆盖 `scripts/relay-demo/pretty-bytes.mjs`、`scripts/relay-demo/sort-json-keys.mjs`
- `[ASSERT:PREPPRD:REALPATH_ROOT_RESOLUTION]` 合同测试定位 repo root 时必须先解析真实测试文件路径，避免符号链接把脚本路径误指

## Invariant 覆盖（铁律映射，来源: PRD Invariant 约束段 area，共 31 条）

逐条映射 PRD 铁律清单到本 sprint 的 DoD 覆盖或显式 N/A（本 sprint 无 ability_id，step/feature 两源为空，仅 area 有数据）：

- N/A-1 [多端UI区分] N/A：本 sprint 无任何 UI/设备类型渲染，纯 CLI 工具
- N/A-2 [capture-triage] git_sha 判变端/终验端一致性：N/A，本 sprint 不涉及 git_sha 判变逻辑
- N/A-3 [capture-triage] `git rev-parse --verify`：N/A，本 sprint 不做 git ref 存在性判断
- N/A-4 [capture-triage] smoke 用真实 worktree 当 CECELIA_DEPLOY_ROOT：N/A，本 sprint 无部署根目录概念
- N/A-5 [capture-triage] 部署链失败路径禁止 warning 降级：N/A，本 sprint 无部署链；但 Golden Path 每步验证命令均用 `set -e`/显式 `exit 1`，不做静默降级，精神上已遵循
- N/A-6 [capture-triage] 判变基准用生产实体自报对账：N/A，本 sprint 不涉及生产环境判变
- N/A-7 [capture-triage] lint-test-quality await fn() ≥ 1：N/A，本 sprint 测试用 `execFileSync` 同步 spawn 真实子进程验证行为，不读源码文件，不适用该 lint 规则
- [ ] [BEHAVIOR] INV-8 [capture-triage] Test Contract 表格固定 4 列格式：contract-draft.md `## Test Contract` 段落已按 `Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据` 4 列格式书写
  Test: manual:bash -c 'grep -A2 "^| Workstream | Test File" sprints/07191413-relay-13f35dc8/contract-draft.md | head -1 | grep -q "BEHAVIOR 覆盖" && echo OK'
  期望: OK
- [ ] [BEHAVIOR] INV-9 [capture-triage] Red commit 只 git add 精确路径：本次 propose 提交（round-2 修订，新增 `verify/` 单一事实源脚本用于修复 GAN Round 1 问题 1）只 `git add` 了 `contract-draft.md`/`contract-dod.md`/`verify/*.sh` 精确路径，未用 `git add .`
  Test: manual:bash -c 'git diff-tree --no-commit-id --name-only -r HEAD | grep -E "^sprints/07191413-relay-13f35dc8/" | grep -qvE "contract-draft\.md$|contract-dod\.md$|verify/(step[1-4]|red-missing|red-broken)\.sh$|tests/slugify\.contract\.test\.ts$|smoke-verify\.sh$|task-plan\.json$" && exit 1 || echo OK'
  期望: OK
  （v2：改用 `git diff-tree --no-commit-id --name-only -r HEAD` 替代 `git show --stat HEAD`——后者对长路径按终端列宽截断，会把 `sprints/.../verify/red-broken.sh` 显示成 `.../07191413-relay-13f35dc8/verify/red-broken.sh`，丢失 `sprints/` 前缀导致该行完全脱离 `^\s+sprints/` 锚定，形成对新增文件的验证盲区；`--name-only` 输出纯路径列表，无截断、无 commit message 干扰，验证盲区已消除）
- N/A-10 [capture-triage] 回归测试用 source-code inspection 验证调度接线：N/A，本 sprint 无调度接线，测试改用真实子进程执行验证
- N/A-11 [capture-triage] 新增 cron 检查 scheduler-jobs.js JOBS：N/A，本 sprint 不新增任何 cron
- N/A-12 [capture-triage] 禁止 generator 自行 merge PR：N/A，proposer 阶段不涉及 merge 操作，合并权归 controller，本合同未授权 generator 自行合并
- N/A-13 [capture-triage] headed relay tmux 子 shell 环境变量继承：N/A，本 sprint 验证命令均为自包含 bash 脚本，不依赖父进程注入的环境变量
- [ ] [BEHAVIOR] INV-14 [capture-triage] 复用历史合同模板前必须核对真实派发/执行历史：已核对 `sprints/07081030-headed-r7/` 与 `sprints/07071247-relay-demo-codex-r2/` 两份历史 relay-demo 合同的实际派发/执行结构（Golden Path/DoD/Red 前提/smoke-verify.sh 格式）后再起草本合同，非凭空套用
  Test: manual:bash -c 'test -d sprints/07081030-headed-r7 && test -d sprints/07071247-relay-demo-codex-r2 && echo OK'
  期望: OK
- N/A-15 [capture-triage] harness-generator 共享 CI 基础设施文件默认禁区：N/A，本 sprint 不改动 `.github/workflows/*.yml` 等共享 CI 文件
- N/A-16 [capture-triage] PR 被 CI 侧兜底机制提前合并：N/A，proposer 阶段尚未开 PR
- N/A-17 [smoke占位] smoke-invariant-1783850042-79911：占位文本，无实质约束
- N/A-18 [capture-triage] feat+brain/src PR 需带齐 smoke.sh+allowlist：N/A，本 sprint 明确不触碰 `packages/brain/src`
- N/A-19 [capture-triage] 新 task_type 接线七点清单：N/A，本 sprint 不新增 task_type
- N/A-20 [capture-triage] 服务"该活着"判定用双信号：N/A，本 sprint 无常驻服务
- N/A-21 [capture-triage] 禁止往 `~/Library/LaunchAgents` 放常驻服务：N/A，本 sprint 不涉及 launchd/常驻服务
- N/A-22 [capture-triage] 新增常驻宿主服务需同步 launchd-patrol.js manifest：N/A，本 sprint 无常驻宿主服务
- N/A-23 [smoke占位] smoke-invariant-1783693282-93097：占位文本，无实质约束
- N/A-24 [系统] 单 slot 串行任务：N/A，属 Brain 任务调度层约束，非本 sprint 交付物内容；proposer 本身作为单一 slot 任务串行执行，已自然遵循
- [ ] [BEHAVIOR] INV-25 [系统] 禁止写死环境假设值：`scripts/relay-demo/slugify.mjs` 不得含硬编码路径/环境变量/机器特定值，实现为纯函数计算
  Test: manual:bash -c '! grep -E "process\.env|/Users/|/home/|localhost:[0-9]" scripts/relay-demo/slugify.mjs 2>/dev/null && echo OK || (test ! -f scripts/relay-demo/slugify.mjs && echo "OK (未实现，Red 阶段)")'
  期望: OK
- [ ] [BEHAVIOR] INV-26 [系统] 真环境验证才算 done：Golden Path Step 1-4 与 smoke-verify.sh 均直接 spawn 真实 `node scripts/relay-demo/slugify.mjs` 子进程执行，非 mock，符合"真环境验证"
  Test: manual:bash -c 'grep -q "node scripts/relay-demo/slugify.mjs" sprints/07191413-relay-13f35dc8/smoke-verify.sh && echo OK'
  期望: OK
- N/A-27 [系统] 测试默认多租户：N/A，本 sprint 无租户概念（纯本地 CLI 工具，无用户/租户上下文）
- N/A-28 [系统] 凭据安全：N/A，本 sprint 不涉及任何凭据/密钥
- N/A-29 [系统] 日志脱敏：N/A，本 sprint 无日志输出，仅 stdout 单行 slug 结果
- N/A-30 [系统] 端点鉴权：N/A，本 sprint 无 HTTP 端点
- N/A-31 [系统] 租户隔离：N/A，本 sprint 无租户数据存储

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/relay-demo/slugify.mjs` 文件存在，且入口以字符串参数驱动
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/slugify.mjs "Test")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "test"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/slugify.mjs` 按规则折叠分隔符并去除首尾多余连字符
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/slugify.mjs "Hello, World!")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "hello-world" && OUT2="$(node scripts/relay-demo/slugify.mjs "  Hello   世界---World  ")" && test "$OUT2" = "hello-world"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/slugify.mjs` 不引入外部依赖
  Test: manual:bash -c 'test -f scripts/relay-demo/slugify.mjs && node --input-type=module -e "import fs from \"node:fs\"; const src = fs.readFileSync(\"scripts/relay-demo/slugify.mjs\", \"utf8\"); const specs = [...src.matchAll(/from\\s+[\u0022\u0027]([^\u0022\u0027]+)[\u0022\u0027]|require\\([\u0022\u0027]([^\u0022\u0027]+)[\u0022\u0027]\\)/g)].map(([, esm, cjs]) => esm ?? cjs); const bad = specs.filter((spec) => !spec.startsWith(\"./\") && !spec.startsWith(\"../\") && !spec.startsWith(\"node:\")); if (bad.length) { console.error(bad.join(\"\\n\")); process.exit(1); }"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/pretty-bytes.mjs` 与 `scripts/relay-demo/sort-json-keys.mjs` 未被修改或覆盖
  Test: manual:bash -c 'git diff --name-only HEAD -- scripts/relay-demo/pretty-bytes.mjs scripts/relay-demo/sort-json-keys.mjs | grep -q . && exit 1 || echo OK'
  期望: OK

- [ ] [ARTIFACT] `sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts` 定义空字符串、普通短语、连续分隔符/非 ASCII 三个合同用例
  Test: manual:bash -c 'grep -q "空字符串输入返回空字符串" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "普通短语转换为小写连字符 slug" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "连续分隔符与非 ASCII 字符折叠为单个连字符" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts'
  期望: OK

- [ ] [ARTIFACT] `sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts` 先解析真实测试目录，再回溯 repo root 到 `scripts/relay-demo/slugify.mjs`
  Test: manual:bash -c 'grep -q "realpathSync" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "workspaceRoot = path.resolve" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "scripts/relay-demo/slugify.mjs" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts'
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

> **单一事实源说明（GAN Round 1 问题 1 修复）**：以下 6 条 `[BEHAVIOR]` 的 `Test:` 均改为直接执行 `sprints/07191413-relay-13f35dc8/verify/*.sh` 脚本文件，不再与 contract-draft.md 的「验证命令」逐字重复粘贴。可执行内容只存在于 `verify/` 目录下的脚本文件里，contract-draft.md 与本文件均只引用、不复制。

- [ ] [BEHAVIOR] Step 1：提供任意字符串参数后，CLI 以 `node scripts/relay-demo/slugify.mjs <string>` 形态成功执行并返回退出码 0
  Test: manual:bash sprints/07191413-relay-13f35dc8/verify/step1.sh
  期望: exit 0（同 contract-draft.md Step 1 验证命令，见该处摘要）

- [ ] [BEHAVIOR] Step 2：输入空字符串时，结果稳定返回空字符串，不会报错或抛异常
  Test: manual:bash sprints/07191413-relay-13f35dc8/verify/step2.sh
  期望: exit 0（同 contract-draft.md Step 2 验证命令，见该处摘要）

- [ ] [BEHAVIOR] Step 3：输入含空格与标点的普通短语 `"Hello, World!"` 时，结果必须为小写连字符 slug `hello-world`
  Test: manual:bash sprints/07191413-relay-13f35dc8/verify/step3.sh
  期望: exit 0（同 contract-draft.md Step 3 验证命令，见该处摘要）

- [ ] [BEHAVIOR] Step 4：输入含连续分隔符与非 ASCII 字符 `"  Hello   世界---World  "` 时，结果必须确定性折叠为 `hello-world`，且本地 vitest 三个合同用例全部通过
  Test: manual:bash sprints/07191413-relay-13f35dc8/verify/step4.sh
  期望: exit 0（同 contract-draft.md Step 4 验证命令，见该处摘要）

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/slugify.mjs` 未实现时，直接运行合同测试必须非零失败，并出现缺失实现的失败定位
  Test: manual:bash sprints/07191413-relay-13f35dc8/verify/red-missing.sh
  期望: exit 0（脚本内部断言 vitest 非零失败 + 命中具体用例名或 `ENOENT`/`AssertionError`/`expected`，同 contract-draft.md「Red 前提」未实现状态验证命令，见该处摘要）

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/slugify.mjs` 错误实现为"仅做小写化、不折叠分隔符也不剔除非 ASCII 字符"时，直接运行合同测试必须非零失败，并出现具体失败用例或断言摘要
  Test: manual:bash sprints/07191413-relay-13f35dc8/verify/red-broken.sh
  期望: exit 0（脚本内部断言 vitest 非零失败 + 命中 `普通短语转换为小写连字符 slug`/`连续分隔符与非 ASCII 字符折叠为单个连字符`/`AssertionError`/`expected`，同 contract-draft.md「Red 前提」错误实现状态验证命令，见该处摘要）

## 机械验收钩子

- `[MECH:BEHAVIOR_COUNT]` `grep -c '\[BEHAVIOR\]' sprints/07191413-relay-13f35dc8/contract-dod.md` 必须 `>= 4`
- `[MECH:DRAFT_E2E_HEADING]` `grep -q '## E2E 验收' sprints/07191413-relay-13f35dc8/contract-draft.md`
- `[MECH:MANUAL_BASH]` `grep -q 'manual:bash' sprints/07191413-relay-13f35dc8/contract-dod.md`
- `[MECH:E2E_STATUS_PORCELAIN]` `grep -q 'git status --porcelain --untracked-files=all' sprints/07191413-relay-13f35dc8/smoke-verify.sh`
- `[MECH:RED_NONZERO]` `grep -q 'Red 前提' sprints/07191413-relay-13f35dc8/contract-draft.md && grep -q 'VITEST_STATUS.*-ne 0' sprints/07191413-relay-13f35dc8/verify/red-missing.sh && grep -q 'VITEST_STATUS.*-ne 0' sprints/07191413-relay-13f35dc8/verify/red-broken.sh`（v2：脚本抽取到 `verify/` 单一事实源后改查脚本文件，不再查 contract-dod.md 文本本身）
- `[MECH:SMOKE_TMP_RED_CLEANUP]` `grep -q "find packages/brain -maxdepth 1 -type d -name 'tmp-red-\*' -exec rm -rf" sprints/07191413-relay-13f35dc8/smoke-verify.sh`（Risk R1 现有防线落地校验：`smoke-verify.sh` 启动时清理 `tmp-red-*` 残留目录）
