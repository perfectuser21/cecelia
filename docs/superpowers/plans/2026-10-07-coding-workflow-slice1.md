# coding workflow 第一刀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 coding_spec 契约与 intent / spec / chain_check / publish 四个 json-stdio-v1 活动，产出带上游引用的 01-intent.md → 02-spec.md 并开 PR。

**Architecture:** 纯函数放 `lib/`，每个活动是一个读 stdin、写唯一结果 JSON 的 node 脚本；执行器复用 PR #5783 的 `activity-contract-run.js`，本计划不实现执行器。

**Tech Stack:** Node ≥20 ESM（.mjs）、vitest（packages/brain 已 include `scripts/**`）、git、gh、claude CLI。

**Spec:** `docs/superpowers/specs/2026-10-07-coding-workflow-slice1-design.md`

## Global Constraints

- 根目录：`packages/brain/scripts/coding-workflow/`；测试：同目录 `__tests__/*.test.mjs`。
- 结果 JSON：`{schema_version:1, run_tag:<原样>, status:'completed'|'partial'|'failed', failure_class:null|'retryable'|'needs_human'|'fatal', outputs:{}, metrics:{}, evidence:[]}`；completed 时 failure_class 为 null。
- stdout 只写一次结果 JSON；一切日志走 stderr；completed 退出码 0，其余 2。
- outputs 的 key 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。
- 锚点标题行 `### <ID>`，ID 匹配 `^[A-Z]+-\d+$`；intent 用 `I-n`，spec 用 `S-n`。
- frontmatter 只用三键：`task_id`、`step`、`upstream`（JSON 数组字面量，单行）。
- budget：intent 60s、spec 900s、chain_check 30s、publish 900s（原 120s；本仓 pre-push 钩子跑全量 quickcheck 约 10 分钟，push 不加 --no-verify，终审裁定调整）；heartbeat_s 全部 30；spec `max_attempts: 2`，其余 1。
- 不新增 npm 依赖；只用 node 内置模块。
- 每个 task：先 commit 失败测试，再 commit 实现。

## Review Focus

1. `sprint_dir` 含 `..` 或为绝对路径 → 所有写文件的活动判 `fatal`（`sprint_dir_invalid`），不写任何文件。→ Task 2、Task 4、Task 5 各加一条测试。
2. 重复运行：`01-intent.md` 已存在时 intent 覆盖重写，内容与首次一致（确定性）。→ Task 2 测试。
3. description 里"验收"段用 `①②③`、`1.`、`- [ ]` 三种列表写法都能切出条目。→ Task 2 测试。
4. 假 claude 往 stdout 打了大量日志，活动 stdout 仍只有一个结果 JSON。→ Task 4 测试。
5. publish 时 sprint 目录无新改动（已提交过）→ 不报错，走查 PR 分支。→ Task 5 测试。

---

### Task 1: 协议工具与 md 链校验（纯函数）

**Files:**
- Create: `packages/brain/scripts/coding-workflow/lib/protocol.mjs`
- Create: `packages/brain/scripts/coding-workflow/lib/md-chain.mjs`
- Test: `packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs`
- Test: `packages/brain/scripts/coding-workflow/__tests__/protocol.test.mjs`

**Interfaces:**
- Produces:
  - `protocol.mjs`：`log(...args): void`（stderr）；`resolveSprintDir(worktree: string, sprintDir: string): string`（绝对路径；sprintDir 为绝对路径或含 `..` 段时 throw `Error('sprint_dir_invalid')`）；`runActivity(handler: (input) => Promise<{status, failure_class?, outputs?, metrics?, evidence?, reason_code?}>): Promise<void>`——读 stdin JSON，调 handler，补齐 schema_version/run_tag/默认空字段，写 stdout 一次，设 `process.exitCode`；handler throw → `{status:'failed', failure_class:'fatal', reason_code:error.message}`。
  - `md-chain.mjs`：`parseFrontmatter(text: string): {data:{task_id:string, step:string, upstream:string[]}, body:string} | null`；`extractAnchors(text: string): string[]`；`checkChain({dir: string, taskId: string}): {ok: boolean, errors: string[], files: string[]}`，按顺序校验 `01-intent.md`、`02-spec.md`。错误码：`file_missing:<f>`、`frontmatter_missing:<f>`、`task_id_mismatch:<f>`、`upstream_ref_invalid:<ref>`、`upstream_file_missing:<ref>`、`upstream_anchor_missing:<ref>`、`intent_upstream_not_empty`、`intent_not_covered:<I-n>`。

- [ ] **Step 1: 写失败测试** `md-chain.test.mjs`，用 `fs.mkdtempSync` 造目录：
  - `合法链通过`：01（I-1、I-2，upstream `[]`）+ 02（upstream `["01-intent.md#I-1","01-intent.md#I-2"]`）→ `ok:true, errors:[]`，`files` 为两个文件名。
  - `伪造锚点`：02 引用 `01-intent.md#I-9` → errors 含 `upstream_anchor_missing:01-intent.md#I-9`。
  - `缺上游文件`：02 引用 `00-x.md#I-1` → 含 `upstream_file_missing:00-x.md#I-1`。
  - `task_id 不一致`：02 的 task_id 不同 → 含 `task_id_mismatch:02-spec.md`。
  - `未覆盖全部 I-n`：02 只引用 I-1 → 含 `intent_not_covered:I-2`。
  - `extractAnchors` 对 `### I-1\n### S-2\n## X-3` 返回 `['I-1','S-2']`。
  
  `protocol.test.mjs`：`resolveSprintDir('/w','sprints/a')` 返回 `/w/sprints/a`；`'../x'`、`'/abs'`、`'a/../../b'` 均 throw `sprint_dir_invalid`。
- [ ] **Step 2: 运行确认失败** `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/` → FAIL（模块不存在）。提交测试：`git commit -m "test(workflow): md 链校验与协议工具失败测试"`
- [ ] **Step 3: 实现两个模块。** frontmatter 解析：首行 `---` 到下一个 `---`，逐行 `key: value`，`upstream` 用 `JSON.parse`，解析失败视为无 frontmatter。
- [ ] **Step 4: 运行确认通过**（同上命令 → PASS）。
- [ ] **Step 5: 提交** `git commit -m "feat(workflow): md 链校验与 json-stdio 协议工具"`

### Task 2: intent 活动

**Files:**
- Create: `packages/brain/scripts/coding-workflow/lib/intent.mjs`
- Create: `packages/brain/scripts/coding-workflow/activities/intent.mjs`
- Test: `packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`
- Test helper: `packages/brain/scripts/coding-workflow/__tests__/helpers/run-activity.mjs`

**Interfaces:**
- Consumes: Task 1 的 `runActivity`、`resolveSprintDir`、`log`。
- Produces:
  - `lib/intent.mjs`：`extractAcceptance(task: {description?: string, payload?: {acceptance?: string[]}}): string[]`；`renderIntent({taskId: string, title: string, items: string[]}): string`（frontmatter `task_id`、`step: intent`、`upstream: []`；`# <title>`；每条 `### I-<n>\n<条目>`）。
  - 活动输入：`{run_tag, task_id, worktree, sprint_dir, brain_url?}`；outputs：`{intent_file: '01-intent.md', intent_ids: string[]}`。
  - helper：`runActivityProcess(entry: string, input: object, env?: object): Promise<{exitCode: number, stdout: string, stderr: string, result: object}>`（`spawn(process.execPath, [entry])`，stdin 写 JSON；`result` 为 `JSON.parse(stdout)`）。
- 失败映射：Brain 404/400 → fatal `task_not_found`；网络错误或 5xx → retryable `brain_unavailable`；无条目 → needs_human `acceptance_missing`；sprint_dir 非法 → fatal `sprint_dir_invalid`。

- [ ] **Step 1: 写失败测试**（本地 `http.createServer` 假 Brain，`brain_url` 指向它）：
  - `payload.acceptance 优先`：payload 有 2 条、description 也有"验收"段 → 文件只含 I-1、I-2 且为 payload 内容；outputs.intent_ids=`['I-1','I-2']`；exitCode 0；result.failure_class null。
  - `描述验收段三种写法`：分别为 `验收：①A ②B`、`验收\n1. A\n2. B`、`验收\n- [ ] A\n- [ ] B` → 均得 `['A','B']`（直接测 `extractAcceptance`）。
  - `无验收 → needs_human`：exitCode 2，failure_class `needs_human`，reason_code `acceptance_missing`，未写文件。
  - `404 → fatal`、`500 → retryable`。
  - `sprint_dir='../x' → fatal sprint_dir_invalid`，无文件写出。
  - `重复运行内容一致`：同输入跑两次，文件字节相同。
- [ ] **Step 2: 运行确认失败** 并提交测试。
- [ ] **Step 3: 实现** `lib/intent.mjs` 与 `activities/intent.mjs`（`fetch(`${brain_url}/api/brain/tasks/${task_id}`)`；默认 brain_url `http://localhost:5221`；`mkdirSync(recursive)` 后写文件）。
- [ ] **Step 4: 运行确认通过。**
- [ ] **Step 5: 提交** `feat(workflow): intent 活动生成 01-intent.md`

### Task 3: chain_check 活动

**Files:**
- Create: `packages/brain/scripts/coding-workflow/activities/chain-check.mjs`
- Test: `packages/brain/scripts/coding-workflow/__tests__/chain-check.test.mjs`

**Interfaces:**
- Consumes: `checkChain`、`runActivity`、`resolveSprintDir`、`runActivityProcess`。
- Produces：outputs `{chain_files: string[]}`；不过 → failed + fatal，`reason_code: 'md_chain_invalid'`，`evidence` 为 `[{errors: string[]}]`。

- [ ] **Step 1: 写失败测试**：合法链 → exitCode 0、outputs.chain_files 两个文件；伪造锚点链 → exitCode 2、failure_class `fatal`、evidence[0].errors 含 `upstream_anchor_missing:01-intent.md#I-9`。
- [ ] **Step 2: 确认失败并提交测试。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 确认通过。**
- [ ] **Step 5: 提交** `feat(workflow): chain_check 活动`

### Task 4: spec 活动

**Files:**
- Create: `packages/brain/scripts/coding-workflow/prompts/spec.md`
- Create: `packages/brain/scripts/coding-workflow/activities/spec.mjs`
- Test: `packages/brain/scripts/coding-workflow/__tests__/spec.test.mjs`
- Test fixture: `packages/brain/scripts/coding-workflow/__tests__/fixtures/fake-claude.mjs`

**Interfaces:**
- Consumes：上下文里的 `task_id`、`worktree`、`sprint_dir`、`intent_file`、`intent_ids`。
- Produces：outputs `{spec_file: '02-spec.md'}`。
- 命令：`process.env.CODING_WF_CLAUDE_BIN || 'claude'`，参数 `['-p', prompt, '--permission-mode', 'acceptEdits']`，`cwd: worktree`，子进程 stdout/stderr 都转写到本进程 stderr。
- prompt 模板占位符：`{{TASK_ID}}`、`{{INTENT_PATH}}`、`{{SPEC_PATH}}`、`{{INTENT_IDS}}`；内容要求：只写 `{{SPEC_PATH}}` 一个文件；frontmatter `task_id`、`step: spec`、`upstream` 列出全部 `01-intent.md#<I-n>`；正文每条 `### S-n` 写明对应的 I-n、要改哪些文件、怎么验证；不 commit、不 push、不改其他文件。
- 失败映射：非 0 退出且输出含 `auth`/`login`/`quota`（不区分大小写）→ needs_human `claude_auth`；其余非 0 → retryable `claude_failed`；退出 0 但文件不存在 → fatal `spec_missing`；sprint_dir 非法 → fatal。
- fake-claude 行为由环境变量 `FAKE_CLAUDE_MODE` 控制：`ok`（按 prompt 里的 SPEC_PATH 写合法 02，并向 stdout 打印 200 行日志）、`nofile`、`auth`（stderr 打 "Invalid API key · Please run /login"，exit 1）、`fail`（exit 1）。

- [ ] **Step 1: 写失败测试**：`ok` → exitCode 0、outputs.spec_file、stdout 能被 `JSON.parse` 整体解析（Review Focus 4）；`nofile` → fatal `spec_missing`；`auth` → needs_human；`fail` → retryable；`sprint_dir='/abs'` → fatal。
- [ ] **Step 2: 确认失败并提交测试。**
- [ ] **Step 3: 实现** prompt 与活动（SPEC_PATH 用绝对路径传给 claude）。
- [ ] **Step 4: 确认通过。**
- [ ] **Step 5: 提交** `feat(workflow): spec 活动以薄 prompt 调 claude 生成 02-spec.md`

### Task 5: publish 活动

**Files:**
- Create: `packages/brain/scripts/coding-workflow/activities/publish.mjs`
- Test: `packages/brain/scripts/coding-workflow/__tests__/publish.test.mjs`
- Test fixture: `packages/brain/scripts/coding-workflow/__tests__/fixtures/fake-gh.mjs`

**Interfaces:**
- Consumes：`task_id`、`worktree`、`sprint_dir`、`chain_files`。
- Produces：outputs `{pr_url: string, branch: string}`。
- 步骤：`git -C worktree rev-parse --abbrev-ref HEAD` 取分支（非 `cp-` 开头 → fatal `branch_invalid`）；`git add -- <sprint_dir>`；有暂存改动才 commit（message `docs(sprint): <task_id 前 8 位> md 链 01-intent → 02-spec`）；`git push -u origin <branch>`（失败 → retryable `push_failed`）；`gh pr list --head <branch> --json url -q '.[0].url'` 有值则复用，否则 `gh pr create --draft --head <branch> --title <同 commit message> --body <链文件清单>`；gh 输出含 `auth`/`401`/`scope` → needs_human `gh_auth`。
- 可执行文件：`process.env.CODING_WF_GH_BIN || 'gh'`。
- fake-gh：`FAKE_GH_MODE=existing` 时 `pr list` 返回固定 URL；`new` 时 `pr list` 返回空、`pr create` 打印新 URL；`auth` 时 exit 1 打印 "HTTP 401"。

- [ ] **Step 1: 写失败测试**（临时裸仓作 origin + 临时 clone 作 worktree，切到 `cp-test` 分支）：`new` → exitCode 0、outputs.pr_url 为新 URL、origin 上分支存在且含 sprint 文件；`existing` → 复用 URL；无改动第二次运行 → 仍 exitCode 0（Review Focus 5）；`auth` → needs_human；分支名 `main` → fatal `branch_invalid`；`sprint_dir='a/../../b'` → fatal。
- [ ] **Step 2: 确认失败并提交测试。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 确认通过。**
- [ ] **Step 5: 提交** `feat(workflow): publish 活动提交 md 链并开草稿 PR`

### Task 6: coding_spec 契约

**Files:**
- Create: `packages/brain/scripts/coding-workflow/contract.json`
- Test: `packages/brain/scripts/coding-workflow/__tests__/contract.test.mjs`

**Interfaces:**
- Consumes：四个活动的 entry 路径与各自失败分类。
- Produces：`{workflow:'coding_spec', activities:[...]}`，order 1–4 依次 intent(setup)、spec(source)、chain_check(batch_end)、publish(batch_end)；`runtime: {protocol:'json-stdio-v1', phase, entry:'activities/<name>.mjs', on_failure:'stop_run', max_attempts}`；failure 各类别里写入该活动会报的 reason_code（未报的类别为空数组）。

- [ ] **Step 1: 写失败测试**：逐活动断言 protocol、phase 枚举、entry 匹配 `^(?:[a-zA-Z0-9_][a-zA-Z0-9_-]*\/)*[a-zA-Z0-9_][a-zA-Z0-9_-]*\.(?:js|mjs|sh)$` 且文件存在、budget 为正整数且等于 Global Constraints 的值、failure 四组都是数组、`needs_human.cases` 是数组、max_attempts ∈ {1,2}；并断言每个活动在测试里实际报出过的 failure_class 在契约中非空（intent: retryable/needs_human/fatal；spec: retryable/needs_human/fatal；chain_check: fatal；publish: retryable/needs_human/fatal）。
- [ ] **Step 2: 确认失败并提交测试。**
- [ ] **Step 3: 写 contract.json。**
- [ ] **Step 4: 确认通过；再跑整目录** `npx vitest run scripts/coding-workflow/` 全 PASS。
- [ ] **Step 5: 提交** `feat(workflow): coding_spec 契约`

### Task 7: 端到端真跑（不进 CI）

- [ ] **Step 1:** 在独立 worktree 检出 `origin/cp-10011347-commander-contract-runtime`，执行：
  `node packages/brain/scripts/activity-contract-run.js --cwd <本仓>/packages/brain/scripts/coding-workflow --receipt <scratch>/run.json < request.json`
  request.json：`{contract:<contract.json>, input:{run_tag, task_id:'8ad60102-1ed6-42f8-b2b8-b46361ff47cd', worktree:<新建的 cp-* 验收 worktree>, sprint_dir:'sprints/<MMDDHHNN>-coding-spec-e2e'}}`。
- [ ] **Step 2:** 断言：CLI exit 0；receipt.status `completed`；PR 存在且 `sprints/<dir>/` 下有 01、02；对该目录跑 `checkChain` 结果 ok。把 receipt 与 PR URL 记入 Brain 任务 8ad60102 的 result。
