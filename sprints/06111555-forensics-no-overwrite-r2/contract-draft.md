# Sprint Contract Draft (Round 3)

> Sprint: Agent 取证文件按运行实例唯一命名（防覆盖 R2）
> journey_type: autonomous ｜ target_environment: local_api（evaluator 容器内 node/bash/ls/jq，无 docker）

## 被测真实系统声明（消除"测玩具/测 playground"嫌疑）

本 Sprint 无 HTTP 端点（纯脚本/协议改动）。所有 [BEHAVIOR] 直接 import / 执行 **仓库真实文件**：
- `packages/brain/src/docker-executor.js`（经 `__test__` 导出的 `writePromptFile` / `buildDockerArgs`）
- `docker/cecelia-runner/entrypoint.sh`（当普通 bash 脚本注入 env 跑）

不存在任何 mock / stub / 重写副本。这就是"测真实 Brain 内部模块"而非 `localhost:5221` HTTP——因为本能力没有 HTTP 表面。真实容器 spawn 闭环（宿主有 docker）下沉到 post-deploy smoke（见 ARTIFACT A1），不在 evaluator E2E 范围（evaluator 无 docker daemon，PR #3344 因此被 env_missing 红线正确打回）。

---

## Response Schema（推导来源: PRD 字面）

`N/A — 任务无 HTTP 响应`（纯脚本/协议改动；PRD `## 范围限定` 明确无 response 契约）。Reviewer 第 6 维 verification_oracle_completeness 不审 HTTP schema，改审下方 5 条 [BEHAVIOR] 对 Golden Path 4 步的 1:1 覆盖完整性。

---

## 已知约束（来自回归测试）

- [container-name-unique-smoke.sh] containerName 必须保留 `cecelia-task-` 前缀 + `randomBytes(N).toString('hex')` 唯一后缀；quarantine 按**前缀 startsWith** 匹配容器。→ **取证文件同理：必须保留 `<taskId>` 前缀（批量 `ls|grep`/`rm` 清理依赖它），唯一性靠前缀之后、扩展名之前插入实例后缀实现。**
- [docker-executor.js:196 containerName] 已有"同 task 多次调用唯一化"的范本（randomBytes(4) → 8 hex），本次取证文件复用同一思路（不依赖纯秒级时间戳，避免相近时间碰撞——见 PRD 边界情况「并发」）。
- [entrypoint.sh:117-118] 现有 `PROMPT_FILE` / `STDOUT_FILE` 由 `${CECELIA_TASK_ID}` 自拼；新协议改为"优先读注入的完整文件名 env（CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE），缺失回退旧拼接"——回退分支必须保留（PRD 边界情况「向后兼容」：滚动部署新旧镜像共存）。

---

## 取证文件命名协议（本 Sprint 交付的核心约定）

| 取证类型 | 旧名（会覆盖） | 新名（按运行实例唯一） | 谁写 | 谁读 |
|---|---|---|---|---|
| prompt | `<taskId>.prompt` | `<taskId>.<runInstance>.prompt` | docker-executor / host-executor | entrypoint.sh（按 `CECELIA_PROMPT_FILE` env）|
| stdout | `<taskId>.stdout` | `<taskId>.<runInstance>.stdout` | entrypoint.sh（按 `CECELIA_STDOUT_FILE` env）| forensic 排障 |
| cid | `<taskId>.cid` | `<taskId>.<runInstance>.cid` | docker `--cidfile`（host 侧）| readContainerIdFromCidfile |

- `runInstance` = 每次 spawn 生成一次的 hex 后缀（**≥6 hex**，复用 `randomBytes` 范式，非纯秒级时间戳）；prompt/stdout/cid 三者在**同一次 spawn 内共享同一 runInstance**。
- 前缀 `<taskId>` 完整保留 → `ls cecelia-prompts/ | grep <taskId>` 与按前缀批量清理不破坏。
- docker-executor 把 prompt/stdout 的**容器内完整路径**经 env（`CECELIA_PROMPT_FILE` / `CECELIA_STDOUT_FILE`）传入容器；entrypoint **不再自拼**，直接读 env；env 缺失才回退旧拼接（向后兼容）。

---

## Golden Path

[同一 task 第二次运行写取证] → [spawn 侧唯一命名 + 经 env 传完整文件名] → [entrypoint 按 env 读同一唯一文件] → [两组取证并存、可按 task id 前缀检索]

### Step 1: 同一 taskId 写两次 prompt 取证 → 两组文件并存、互不覆盖
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 1」直接定义（同一 task id 调 spawn 写入逻辑两次，两组 .prompt 文件名可区分、各自内容正确、第一组未被覆盖）。

**可观测行为**: 调用 spawn 侧 prompt 写入逻辑两次（同一 taskId，不同内容）→ 取证目录出现两个不同文件名的 `.prompt`，第一次内容完好保留。

**验证命令**:
```bash
node sprints/06111555-forensics-no-overwrite-r2/tests/check-step1-no-overwrite.mjs
# 期望: 退出 0 + "OK step1: two distinct prompt files, first preserved"
```

**硬阈值**: 两次返回路径互不相等；两文件同时存在；第一次内容字节级完好。
**对应可执行命令**: 见上（脚本内含 `p1 !== p2`、`existsSync` 双断言、`readFileSync` 内容比对，任一不满足 `process.exit(1)`）。

---

### Step 2: `ls | grep <taskId 前缀>` → 两组文件均可检索（排障习惯不破坏）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 2」直接定义。

**可观测行为**: 取证目录下，按 taskId 前缀 grep 能同时检索到两组文件。

**验证命令**:
```bash
bash sprints/06111555-forensics-no-overwrite-r2/tests/check-step2-prefix-retrieval.sh
# 期望: 退出 0 + "OK step2: prefix retrieval found N files"（N>=2）
```

**硬阈值**: `ls "$DIR" | grep -c "^<taskId>"` ≥ 2。
**对应可执行命令**: `COUNT=$(ls "$DIR" | grep -c "^$TASK"); [ "$COUNT" -ge 2 ]`（脚本内置）。

---

### Step 3: entrypoint.sh 当普通 bash 脚本测，注入 env → 读到唯一文件；env 缺失 → 回退旧拼接（prompt + stdout 双验）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 3」(env 优先) + PRD「边界情况·向后兼容」(env 缺失回退，滚动部署新旧镜像共存) + PRD 命名协议表（CECELIA_STDOUT_FILE env 明确列出，entrypoint「不再自拼」同时适用 prompt 和 stdout）。

**可观测行为**:
- 注入 `CECELIA_PROMPT_FILE=<第2次写入的唯一 prompt 文件>` + `CECELIA_STDOUT_FILE=<唯一 stdout 文件>` → entrypoint 解析出的 PROMPT_FILE 正是注入的唯一 prompt 文件，STDOUT_FILE 正是注入的唯一 stdout 文件（**两者均非**旧 `<taskId>.prompt`/`<taskId>.stdout` 拼接路径）。
- `CECELIA_PROMPT_FILE` / `CECELIA_STDOUT_FILE` 缺失 → entrypoint 回退旧拼接（`/tmp/cecelia-prompts/<taskId>.prompt` 和 `/tmp/cecelia-prompts/<taskId>.stdout`）（向后兼容仍能读到）。

**实现要求（测试可见性）**: entrypoint 在 `set -euo pipefail` 之后、其余副作用（git/凭据复制）之前，用新 env-优先表达式计算 `PROMPT_FILE`/`STDOUT_FILE`；当 `CECELIA_ENTRYPOINT_TEST=1` 时立即 `echo "PROMPT_FILE=$PROMPT_FILE"; echo "STDOUT_FILE=$STDOUT_FILE"; exit 0`（短路在副作用前，故 evaluator 无 docker 亦可纯 bash 验证）。正式运行路径必须复用同一 `PROMPT_FILE`/`STDOUT_FILE` 变量（删除后文重复定义，防解析漂移）。

**验证命令**:
```bash
bash sprints/06111555-forensics-no-overwrite-r2/tests/check-step3-entrypoint-resolve.sh priority
bash sprints/06111555-forensics-no-overwrite-r2/tests/check-step3-entrypoint-resolve.sh fallback
# 期望: 两条均退出 0
```

**硬阈值**:
- priority 模式：`PROMPT_FILE` == 注入值 AND `STDOUT_FILE` == 注入值。
- fallback 模式：`PROMPT_FILE` 匹配 `.*/<taskId>\.prompt$` AND `STDOUT_FILE` 匹配 `.*/<taskId>\.stdout$`，且均不指向唯一文件。

**对应可执行命令**:
```bash
# priority — 双 grep 串行断言（任一失败 exit 1）
grep -q "PROMPT_FILE=$UNIQUE" <(bash entrypoint.sh) && grep -q "STDOUT_FILE=$UNIQUE_STDOUT" <(bash entrypoint.sh)
# fallback — 双 grep-E 匹配
grep -Eq "PROMPT_FILE=.*/cf9ce514\.prompt$" <output> && grep -Eq "STDOUT_FILE=.*/cf9ce514\.stdout$" <output>
# 以上为示意；完整版见 check-step3-entrypoint-resolve.sh（单次调用 entrypoint，OUT 变量含两行）
```

---

### Step 4: docker run 参数构造 → prompt/stdout/cid 三类路径均含同一实例后缀，且跨 spawn 唯一
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 4」直接定义（参数构造函数输出三类路径均含实例后缀）。

**可观测行为**: `buildDockerArgs` 输出的 `--cidfile` 路径 + 注入容器的 `CECELIA_PROMPT_FILE`/`CECELIA_STDOUT_FILE` env 三者共享同一 runInstance 后缀、都保留 taskId 前缀；连续两次 spawn 实例后缀不同（防覆盖核心）；宿主写入 basename 与容器 env basename 一致（容器才读得到）。

**验证命令**:
```bash
node sprints/06111555-forensics-no-overwrite-r2/tests/check-step4-docker-args-suffix.mjs
# 期望: 退出 0 + "OK step4: ... distinct across spawns"
```

**硬阈值**: cidfile/prompt-env/stdout-env 三者实例后缀字面相等；两次 `buildDockerArgs` 实例后缀不等；`basename(forensics.promptFile) == basename(CECELIA_PROMPT_FILE)`。
**对应可执行命令**: 见脚本（正则 `<taskId>\.([0-9a-f]{6,})\.prompt$` 提取 inst，跨字段/跨调用比对）。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，evaluator 容器内，无 docker）

**journey_type**: autonomous
**target_environment**: local_api

> 本脚本即 Golden Path 端到端（模式 B）：在 evaluator 容器内全用 node/bash/ls/jq 跑通 Step1→Step4，无任何 docker 依赖。由 evaluator 在 `harness_evaluate` task 中执行（GAN 阶段只产出此脚本，不在本阶段运行）。

```bash
#!/bin/bash
set -e
SP="sprints/06111555-forensics-no-overwrite-r2/tests"

echo "▶ Step 1: 同 taskId 两次写 prompt 取证不覆盖"
node "$SP/check-step1-no-overwrite.mjs"

echo "▶ Step 2: ls|grep <taskId 前缀> 两组均可检索"
bash "$SP/check-step2-prefix-retrieval.sh"

echo "▶ Step 3a: entrypoint 按注入 env 读唯一文件（prompt + stdout 双验）"
bash "$SP/check-step3-entrypoint-resolve.sh" priority

echo "▶ Step 3b: env 缺失回退旧拼接（prompt + stdout，向后兼容）"
bash "$SP/check-step3-entrypoint-resolve.sh" fallback

echo "▶ Step 4: docker run 三类路径共享唯一实例后缀且跨 spawn 唯一"
node "$SP/check-step4-docker-args-suffix.mjs"

echo "✅ Golden Path（取证防覆盖）全程验证通过（evaluator 容器内，无 docker）"
```

**通过标准**: 脚本 exit 0（5 个 Golden Path 断言全过）。

> **post-deploy smoke（宿主，有 docker，merge 后由 run_post_deploy_smoke 自动跑，不在 evaluator E2E）**：
> `bash packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh` → 新 runner 镜像真实 spawn 最小容器，断言容器读到属于自己 runInstance 的 prompt 且 stdout 取证以唯一名落盘、第二次 spawn 不覆盖第一次。详见 ARTIFACT A1。
> **镜像重建**：entrypoint.sh 变更后 merge 需 `bash docker/build.sh` 重建 cecelia-runner 镜像（PR 描述注明；本 Sprint 不含镜像重建）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/forensics-no-overwrite.test.ts` | 两次写 prompt 取证返回不同路径/注入 CECELIA_PROMPT_FILE 且三类路径共享实例后缀 | → 2 failures（当前 writePromptFile 返回同路径、无 CECELIA_PROMPT_FILE/CECELIA_STDOUT_FILE）|

---

## Risks

| # | 风险 | 触发条件 | Mitigation |
|---|---|---|---|
| R1 | 滚动部署期老镜像 entrypoint 不含 `CECELIA_PROMPT_FILE` / `CECELIA_STDOUT_FILE` env 解析 → 容器读旧拼接路径，仍指向 `<taskId>.prompt`（会与新命名 schema 并存，不崩但排障时混淆） | 新 runner 镜像尚未重建、旧容器还在运行时有 task spawn | ① entrypoint 向后兼容 fallback 已由 Step 3b `check-step3-entrypoint-resolve.sh fallback` 验证，env 缺失时旧路径仍可读（不丢数据）；② PR 描述注明 merge 后必须 `bash docker/build.sh` 重建 cecelia-runner 镜像，彻底消除混淆窗口 |
| R2 | `host-executor.js` 取证路径遗漏更新 → host spawn 仍写 `<taskId>-host.prompt`，重跑仍覆盖 | Generator 只改 docker-executor.js 漏改 host-executor.js | ① 同 PR 必须修改（`files` 列表已包含 `packages/brain/src/spawn/host-executor.js`）；② ARTIFACT A2（contract-dod.md 静态检查）会卡住"含裸 `\${taskId}-host.prompt\`"模式，Generator 漏改则 ARTIFACT A2 FAIL 阻塞 evaluate |

## GAN 来源标注汇总

| FROM_PRD 来源步骤 | AI_ADDED 步骤 + 理由 |
|---|---|
| Step 1 / 2 / 3 / 4（均 PRD Golden Path 1-4 + 边界情况直接定义）| 命名协议「runInstance ≥6 hex、非纯秒级时间戳」为 `[AI_ADDED]`：PRD 边界情况「并发」要求"不依赖纯时间戳秒级精度的碰撞"，故钉死 hex 随机后缀防相近时间覆盖。Step 4 的 `basename(host写入)==basename(容器env)` 断言为 `[AI_ADDED]`：防止 generator 把宿主写入文件与容器 env 指向拆成两个不同实例 → 容器读空。Step 3 oracle 补 STDOUT_FILE 双验为 `[AI_ADDED: Round 2 gap fix]`：PRD 命名协议表明确列出 CECELIA_STDOUT_FILE env 且 entrypoint「不再自拼」同时适用 prompt 和 stdout，Round 1 oracle 只验了 PROMPT_FILE 是覆盖缺失。|
