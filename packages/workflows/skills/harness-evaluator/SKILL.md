---
id: harness-evaluator-skill
description: |
  Harness Evaluator — 阶段 B **pre-merge gate**（不是 merge 后）：
  Generator 写完代码 push PR 后，CI 跑过基础卫生（lint/type/vitest mock/build），
  evaluator 在 CI 绿之后、PR merge 之前真启服务 + 跑 contract 的 manual:bash 命令验真行为。
  PASS → 允许 merge；FAIL → 不 merge，带反馈打回 Generator 在 PR 分支 fix loop（main 不变动）。
  模式 A 跑 contract-dod-ws*.md BEHAVIOR；模式 B（所有 ws merge 后）跑 final E2E Golden Path。
version: 1.12.0
created: 2026-05-06
updated: 2026-05-30
changelog:
  - 1.12.0: 修复 Mode A DoD 文件名 + 变量名双重不匹配 — Brain 注入的是 WORKSTREAM_INDEX（不是 WORKSTREAM_N）；proposer v8.0 写 contract-dod.md（不是 contract-dod-ws{N}.md）。Mode A 现在优先读 contract-dod.md，fallback contract-dod-ws{N}.md；引入 WS_NUM 统一解析两个变量名
  - 1.11.1: 修复空壳检测正则漏掉 npm test/npm ci 和 PowerShell 业务命令 — eval 中发现 BUSINESS_STEPS 正则用 "npm run" 但未含 "npm test"（GHA 常用写法）及 "npm ci"，导致用了 npm test 的真实业务 workflow 被误判为空壳；同步补充 PowerShell 业务模式（Set-Content/New-Item/ConvertTo-Json）防止 PS 脚本的 session 写入被漏判
  - 1.11.0: windows_cloud 模式 B trigger 前新增 workflow 内容检查 — 在 gh workflow run 之前检查：(1) workflow 文件是否存在；(2) 合同 contract-dod.md 是否有 [BEHAVIOR] 条目；(3) workflow 是否只有文件存在/大小检查而不含业务逻辑验证（node/npx/vitest/playwright/curl 等）。第 3 条命中时直接 FAIL，防止 workflow 空壳导致假绿
  - 1.10.0: mac_web host executor 兼容 — 新增 WORKSPACE="${WORKSPACE_PATH:-/workspace}" 变量；所有 .brain-result.json 写入路径改为 "$WORKSPACE/.brain-result.json"（Docker /workspace，宿主 worktreePath）；mac_web Step B-2 修复：由 node /tmp/e2e-verify.js（文件不存在）改为优先 bash /tmp/e2e-verify.sh 并 fallback node .js；更新注入变量表格添加 WORKSPACE_PATH 和 WINDOWS_CLOUD_WORKFLOW
  - 1.9.0: Step B-2.5 截图处理（mac_web 专属）— 复制 screenshots/*.png 到 ~/claude-output/harness-screenshots/$SPRINT/；Claude Read 每张 PNG 视觉自验（对照 BEHAVIOR:E2E 期望描述）；生成公网 URL（38.23.47.81:9998）；PASS brain-result.json 增加 screenshots 字段
  - 1.8.0: 删除 windows_local case — 所有 Windows 测试统一走 windows_cloud（GitHub Actions），无需维护 xian-pc/xian-rog 本地 Windows 机器；TARGET_ENV 枚举同步缩减
  - 1.7.0: windows_native 拆分为 windows_cloud + windows_local（已被 1.8.0 合并）
  - 1.6.0: 修复 B33 误伤真实功能 sprint — B33 URL 检测改为 playground 感知：playground sprint（playground/server.js 存在）禁止出现 Brain API URL；真实功能 sprint（autonomous journey_type）反向要求 E2E 脚本必须含 Brain API URL，缺失直接 FAIL（防止 playground 命令混入真实 sprint）
  - 1.5.0: Rule 4 弱 oracle 改 FAIL — 命令缺 jq -e 值校验不再"容忍但报告"，直接输出 FAIL feedback 拒绝通过；中间态在 GAN 已收敛后无意义（proposer v7.8 配套）
  - 1.4.0: B33 e2e URL 位置词检测 — W35/W43 实证 planner 在 playground sprint 的 e2e 生成了 /api/brain/ping 而非 playground /ping (localhost:3000)。Step B-1.5 加 pre-exec 扫描，含 /api/brain/ 的命令立即 FAIL 并标 planner_drift
  - 1.3.0: 明确 pre-merge gate 位置（反 2026-04-09 决策）— description 重写 + 加 "## 调用时机" 段，说明 evaluator 跑在 CI 绿后、PR merge 前。配套 brain 编排改动（harness-initiative.graph.js 把 evaluate 从 merge 后挪到 merge 前）由独立 PR 跟进
  - 1.2.0: 修协议盲 — 加 Test: 字段 manual:bash/manual: 前缀处理段（proposer SKILL v7.4+ 写此格式，evaluator 必须 strip 后执行）
  - 1.1.0: 加反作弊 reflexive check — 禁止把 vitest "passed" 当 PASS 替代物（W19/W20 实证 sub-evaluator 漏判 schema drift 的根因）。强制每条 [BEHAVIOR] Test: 命令必须真执行；命令缺 jq -e 或自然语言期望直接 FAIL；vitest 输出存在但合同 [BEHAVIOR] 未真跑 → FAIL。对齐 Anthropic harness-design "evaluator 默认会过度通过，必须 prompt 工程严格化"
  - 1.0.0: 初版 — Step A 模式 (DoD 验证) + Step B 模式 (E2E)，按 journey_type 选验证工具
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-evaluator — Harness v5 Evaluator（阶段 B · 验证层）

## 调用时机（v1.3 — pre-merge gate）

```
generator 写代码 + push PR
       ↓
   CI 跑（cheap layer）— lint/type/vitest mock/build/secrets
       ↓ CI 绿
   ★ evaluator 跑（expensive layer）— 真启 server + curl + jq -e   ← 这就是我
       ↓ evaluator PASS
   PR auto-merge（branch protection 卡 evaluator status check）
       ↓
   final_evaluate 跑 Golden Path 端到端
```

**关键 invariant**：evaluator 不 PASS，main 不变动。

**为什么 pre-merge 而非 post-merge**：
- post-merge 跑 → FAIL 时 main 已污染，fix loop 在污染的 main 上跑（违反"评判从执行分离"）
- pre-merge 跑 → FAIL 不 merge，fix loop 在 PR 分支，main 永远干净

**为什么 CI + evaluator 双层不可省**：
- CI（vitest mock）验"代码层正确"，秒级零成本
- evaluator（manual:bash）验"启动 server 真发请求看响应"，1-2min + ~$0.5
- 两层验不同事，不可替代
- memory 实证：CI 全绿但真启动 SyntaxError / host.docker.internal 不解析 / migration 漏跑 → 这些只 evaluator 抓

**注意（撤销 2026-04-09 决策）**：
2026-04-09 决策曾说"CI 是机械执行器，砍 evaluator"。该决策已撤销，见 memory `harness-pipeline-evaluator-as-pre-merge-gate.md`。

---

**角色**: Evaluator（真实验证器）
**对应 task_type**: `harness_evaluate`

---

## 注入变量（由 cecelia-run 通过 prompt 注入）

| 变量 | 含义 |
|------|------|
| `IS_FINAL_E2E` | `true` = 模式 B（E2E）；其他值 = 模式 A（逐任务 DoD） |
| `SPRINT_DIR` | Sprint 目录，如 `sprints/run-20260506-1400` |
| `TASK_ID` | Brain 中当前 evaluate task 的 UUID |
| `WORKSTREAM_INDEX` | 当前 workstream 编号（如 `1`），仅模式 A 用；旧变量名 `WORKSTREAM_N` 同时兼容 |
| `JOURNEY_TYPE` | `user_facing` / `autonomous` / `dev_pipeline` / `agent_remote` |
| `TARGET_ENV` | `mac_web` / `windows_cloud` / `linux_server` / `local_api` / `playground`（来自 PRD `target_environment` 字段）|
| `WORKSPACE_PATH` | 结果文件写入目录（mac_web host 执行时为 worktreePath，Docker 默认不注入，脚本 fallback `/workspace`）|
| `WINDOWS_CLOUD_WORKFLOW` | GHA workflow 文件名（harness-initiative.graph.js 根据 base_repo 注入：zenithjoy → `agent-e2e-video.yml`，否则 `e2e-windows.yml`）|
| `DB` | PostgreSQL 连接串，如 `postgresql://localhost/cecelia` |

**注**：DoD 文件中的 `Test:` 命令若引用 `$TARGET_TASK_ID`，该 ID 来自 DoD 文件内部（合同写入时硬编码或由 Generator 写入），Evaluator 直接执行 DoD 中的命令原文，不需单独注入。

---

## 核心原则

- **真实验证**：必须在真实环境（curl/psql/node/playwright）执行，不接受 mock
- **具体反馈**：FAIL 时的 `feedback` 必须指明具体失败原因 + 具体修复方向，严禁笼统输出"建议检查代码"
- **输出格式**：最后一条消息必须是 **纯 JSON 对象**，不加 markdown 代码块
- **角色边界**：FAIL 报告由 Brain 编排层接收，Brain 负责决定是否重新 dispatch Generator（最多 3 次）；Evaluator 本身无需计数轮次

### 反作弊红线（v1.1 强制 — 不要让 evaluator 过度通过）

对齐 Anthropic harness-design 2026-03 原话："Out of the box, Claude is a poor QA agent...even evaluator needs prompt engineering"。下面 4 条**违反任一直接 FAIL，禁止 PASS**：

1. **禁止把 vitest 输出 grep "passed" 当 PASS 证据**。vitest 是 generator 自写的测试，不是 contract oracle。即便看到 "Tests 8 passed" 也不能给 PASS——必须真跑合同里 [BEHAVIOR] 的 `Test:` 命令逐条校验
2. **禁止以"代码看起来对"给 PASS**。不能读 server.js 源码看到 `app.get('/sum')` 就 PASS——必须真起 server + 真 curl + jq 校验响应
3. **缺 [BEHAVIOR] Test: 命令直接 FAIL**。如果合同 contract-dod-ws{N}.md 没有 [BEHAVIOR] 条目（数 < 1），输出 `{"verdict": "FAIL", "feedback": "DoD 缺 [BEHAVIOR] 条目"}`；这是 contract 阶段没 codify oracle 的问题，evaluator 不能猜
4. **缺 jq -e 严匹配直接 FAIL**。如果 [BEHAVIOR] Test: 命令只 `curl -f /xxx` 不带 jq 校验 body shape，输出 `{"verdict":"FAIL","feedback":"命令缺 jq -e 严匹配，属弱 oracle，schema drift 无法被抓，拒绝通过；请在 contract-dod 里补充 jq -e 值校验命令后重新提交"}` — 禁止"容忍但报告"的中间态，GAN 已收敛后不存在"下轮 reviewer 再严化"的机会

**特别针对 schema drift（W19/W20 根因）**：如果 PRD 写 response 必须 `{result, operation}` 但 generator 实际返 `{product}`：
- 合同里若有 `jq -e '.result == 35'` → evaluator 真跑 → exit 1 → FAIL ✓ 抓住
- 合同里若只有 `curl -f /multiply` 没 jq -e → evaluator 跑 → exit 0 → 假 PASS ❌ 漏判
- → 这是 **contract reviewer 第 6 维 verification_oracle_completeness** 该卡的事，但 evaluator 看到 [BEHAVIOR] 命令缺 jq -e 时必须**在 feedback 里写明 "弱 oracle，schema drift 漏判风险"** 让上游知道

---

## 执行流程

### Step 0a：切到 PR 分支（pre-merge gate 前置）

evaluator 必须先切到 PR 分支才能跑 server 验真行为。模式 A 跑 generator 在 PR 分支写的代码，PR 分支名由 `$PR_BRANCH` env 提供（brain `evaluateContractNode` 透传 — B14 修复）。

```bash
if [ -n "$PR_BRANCH" ]; then
  git fetch origin "$PR_BRANCH:$PR_BRANCH" 2>/dev/null || git fetch origin "$PR_BRANCH"
  git checkout "$PR_BRANCH" || { echo "FATAL: checkout $PR_BRANCH failed"; exit 1; }
  git reset --hard "origin/$PR_BRANCH" 2>/dev/null || true
fi
```

注意：Brain evaluateContractNode 始终注入 PR_BRANCH（pre-merge gate），实际总会切换到 PR 分支验证代码，不论 IS_FINAL_E2E 值。

**反例**：跳过 Step 0a 直接跑 main 上的 server → generator 改动看不见 → 永远 FAIL（W19-W36 9 次实证）。

---

### Step 0b：Cookie / Session 隔离（B31 — 多 evaluator 并发铁律）

**每次 evaluator 跑必须新干净环境，不带前次 cookie / session 干扰**。Cecelia 多 W 任务并发或同任务 fix loop N round 后跑同 evaluator，旧 cookie 会污染下次结果。

#### HTTP API 类 evaluator（curl/jq）
- 每次跑都是新 process（docker --rm），自然隔离 cookie ✅
- 无需特殊处理

#### Web UI 类 evaluator（Playwright）

**Playwright 默认配置（每 evaluator 独立环境，fresh context 每次新建）**：

```javascript
const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: undefined,     // ★ 不加载历史 session
  acceptDownloads: false,
});
const page = await context.newPage();
// 跑测试...
await context.close();
await browser.close();
```

**临时 user-data-dir**（CLI 启动 Playwright 时）：
```bash
playwright test --browser-options='{"userDataDir":"/tmp/playwright-'"$TASK_ID"'"}'
# 跑完 cleanup
rm -rf /tmp/playwright-$TASK_ID
```

**如果需要预存 session 跳过登录**（B32 — session storageState 预存）：
```javascript
const context = await browser.newContext({
  storageState: '/secure-store/auth-${target}.json',  // 主动加载预存的
});
```

#### 严禁（违反 = evaluator 不可信）
- ❌ 复用 `~/.config/chromium/Default` profile（带历史 cookies）
- ❌ 不指定 `storageState` 而默认加载历史
- ❌ 多次跑共享同一 `userDataDir`

#### 反例（cookie 隔离失效场景）
W41 fix loop 5 round 评测：如果用 chromium default profile，第 5 round evaluator 还能看到 R0 时残留的 localStorage / cookies → 验证结果不可信。**铁律：每次 evaluator 跑必须新干净环境**，session 隔离严格执行。

---

### Step 0: 确认模式

```bash
# WORKSPACE_PATH 由 host-executor 注入（mac_web 直接在宿主运行时为 worktreePath）
# Docker 路径默认 /workspace，宿主路径由注入变量覆盖
WORKSPACE="${WORKSPACE_PATH:-/workspace}"

if [[ "$IS_FINAL_E2E" == "true" ]]; then
  echo "模式 B — 最终 E2E"
else
  # Brain 注入的变量名是 WORKSTREAM_INDEX（不是 WORKSTREAM_N）
  WS_NUM="${WORKSTREAM_INDEX:-${WORKSTREAM_N:-1}}"
  echo "模式 A — 逐任务 DoD（ws${WS_NUM}）"
fi
```

> **⚠️ 注意（harness v2）**：harness-task.graph.js 的 evaluate_contract 节点始终注入
> IS_FINAL_E2E=true，因此生产中只会走模式 B。模式 A 的逐 WS DoD 验证在单 Sprint 设计下
> 已不被调用，此段文档保留仅作参考。

---

### 模式 A：逐任务 DoD 验证

#### Step A-1: 读 DoD 文件

```bash
# Brain 注入的变量名是 WORKSTREAM_INDEX（不是 WORKSTREAM_N）
WS_NUM="${WORKSTREAM_INDEX:-${WORKSTREAM_N:-1}}"

# v8.0 单 Sprint 模式写 contract-dod.md（无 WS 后缀）；兼容旧格式 contract-dod-ws{N}.md
DOD_FILE="${SPRINT_DIR}/contract-dod.md"
if [[ ! -f "$DOD_FILE" ]]; then
  DOD_FILE="${SPRINT_DIR}/contract-dod-ws${WS_NUM}.md"
fi
if [[ ! -f "$DOD_FILE" ]]; then
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"dod_missing","log_excerpt":"合同 DoD 文件不存在：尝试了 contract-dod.md 和 contract-dod-ws${WS_NUM}.md，均未找到"}
BREOF
  exit 0
fi
cat "$DOD_FILE"
```

若提取结果中 `[BEHAVIOR]` 条目数量为 0，输出 FAIL：
```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"no_behavior","log_excerpt":null}
BREOF
```

提取所有 `[BEHAVIOR]` 条目的 `Test:` 字段命令。格式示例：

```
[BEHAVIOR] 任务完成后 status = completed
Test: curl -s localhost:5221/api/brain/tasks/$TARGET_TASK_ID | jq -r '.status'
期望: completed
```

#### Step A-2: 逐条执行验证命令

**B22 — Docker 环境 URL 替换（执行任何 Test 命令前必须完成）**：

当 evaluator 在 Docker 容器内运行时，`localhost:5221` 无法连接到宿主的 Brain API，必须替换为 `host.docker.internal:5221`。执行每条 Test 命令前，检查并替换：

```bash
# 若 BRAIN_URL 已设为非 localhost 地址（说明在 Docker 容器内）
if [ -n "$BRAIN_URL" ] && [ "$BRAIN_URL" != "http://localhost:5221" ]; then
  BRAIN_HOST_PORT=$(echo "$BRAIN_URL" | sed 's|http://||')
  # 在 Test 命令字符串中替换 localhost:5221 → host.docker.internal:5221
  TEST_CMD=$(echo "$TEST_CMD" | sed "s|localhost:5221|$BRAIN_HOST_PORT|g")
fi
```

将替换后的 `$TEST_CMD` 传给 `bash -c "$TEST_CMD"` 执行。

对每条 `[BEHAVIOR]` 条目：

1. 执行 `Test:` 字段中的命令（在真实环境，非 mock）
**Test: 字段前缀处理（v1.2 — 修协议盲，proposer SKILL 写 manual:bash 前缀）**：
- Test 命令若以 `manual:bash -c '<cmd>'` 开头 → strip `manual:bash -c '` 前缀和末尾 `'`，把里面的 `<cmd>` 整体用 `bash -c "<cmd>"` 执行；执行前先做 B22 URL 替换
- Test 命令若以 `manual:` 开头（无 bash -c）→ strip `manual:` 前缀，剩下原样 bash 执行；执行前先做 B22 URL 替换
- 不以 `manual:` 开头的（如 `node -e "..."` / `curl ...`） → 直接 bash 执行原文；执行前先做 B22 URL 替换
- 这是跟 proposer SKILL v7.4+ 协议约定的格式，evaluator 不能因看到 `manual:` 前缀就跳过命令

2. 记录 stdout / stderr / exit code
3. 将结果与 `期望:` 行对比（规则：`stdout` trim 后**包含**期望字符串即通过，大小写敏感）

按 `$JOURNEY_TYPE` 选择验证工具（表中 `journey_type` 列对应注入变量 `$JOURNEY_TYPE` 的值）：

| journey_type | 验证工具 |
|---|---|
| `autonomous` | `curl` / `psql` / `node` 脚本 |
| `user_facing` | Playwright（chrome MCP）模拟用户操作 |
| `dev_pipeline` | `curl callback` + `gh pr view` |
| `agent_remote` | 检查 bridge 回调 + DB 状态 |
| 其他/未知值 | 回退到 `autonomous` 方式（curl/psql/node） |

#### Step A-3: 输出报告

**全部通过时**（所有 `[BEHAVIOR]` exit 0 且结果匹配期望）：

```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","failed_step":null,"log_excerpt":null}
BREOF
```

**有任何失败时**：

```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"<失败的 DoD 条目描述>","log_excerpt":"<实际输出 vs 期望值，具体修复方向>"}
BREOF
```

**`feedback` 写作规则**：
- 必须包含具体失败的文件路径或函数名
- 必须包含实际得到的值 vs 期望值
- 必须给出具体修复方向（如："在 task-router.js 中为 harness_evaluate 添加路由条目，当前路由映射缺少此 task_type"）
- 禁止输出："建议检查代码" / "请排查问题" 等笼统描述

---

### 模式 B：最终 E2E 验证

#### Step B-1: 提取 E2E 验收脚本

```bash
CONTRACT="${SPRINT_DIR}/contract-draft.md"
if [[ ! -f "$CONTRACT" ]]; then
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"setup","log_excerpt":"合同文件不存在：$CONTRACT"}
BREOF
  exit 0
fi

# 读取 target_environment（注入变量优先，fallback PRD 文件）
TARGET_ENV="${TARGET_ENV:-local_api}"

if [[ "$TARGET_ENV" == "windows_cloud" ]]; then
  # windows_cloud：提取 ps1/powershell 代码块写到 sprint_dir/e2e-verify.ps1，供 GHA runner 使用
  awk '/^## E2E 验收/{found=1} found && /^```(powershell|ps1)/{in_block=1; next} in_block && /^```/{in_block=0; exit} in_block{print}' \
    "$CONTRACT" > /tmp/e2e-verify.ps1
  if [[ ! -s /tmp/e2e-verify.ps1 ]]; then
    # fallback：尝试 bash 块（兼容旧合同格式）
    awk '/^## E2E 验收/{found=1} found && /^```bash/{in_block=1; next} in_block && /^```/{in_block=0; exit} in_block{print}' \
      "$CONTRACT" > /tmp/e2e-verify.ps1
  fi
  if [[ ! -s /tmp/e2e-verify.ps1 ]]; then
    cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"setup","log_excerpt":"windows_cloud 合同中未找到 ## E2E 验收 区块或区块内无 ps1/powershell 脚本"}
BREOF
    exit 0
  fi
  # 写入 sprint_dir 并 push 到 PR 分支，GHA workflow checkout 后直接运行
  cp /tmp/e2e-verify.ps1 "${SPRINT_DIR}/e2e-verify.ps1"
  git add "${SPRINT_DIR}/e2e-verify.ps1" 2>/dev/null || true
  git commit -m "chore(harness): add e2e-verify.ps1 for windows_cloud runner" --no-verify 2>/dev/null || true
  git push origin HEAD 2>/dev/null || true
else
  # 提取 "## E2E 验收" 区块内第一个 bash 代码块
  awk '/^## E2E 验收/{found=1} found && /^```bash/{in_block=1; next} in_block && /^```/{in_block=0; exit} in_block{print}' \
    "$CONTRACT" > /tmp/e2e-verify.sh
  if [[ ! -s /tmp/e2e-verify.sh ]]; then
    cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"setup","log_excerpt":"合同中未找到 ## E2E 验收 区块或区块内无 bash 脚本"}
BREOF
    exit 0
  fi
  chmod +x /tmp/e2e-verify.sh
fi
```

#### Step B-1.5: E2E 命令位置词验证（B33 v1.6 — playground-aware）

**在执行 E2E 脚本前，先判断是 playground sprint 还是真实功能 sprint，然后做方向相反的检测。**

根因（原始 B33）：W35→W43 共 9 次失败，playground sprint 的 e2e 脚本错误混入 Brain API URL。
根因（v1.6 修复）：原 B33 无差别拦截所有 Brain API URL，导致真实功能 sprint（autonomous）的 E2E 脚本被误判为 planner_drift——而真实功能 sprint 的 E2E **必须** 调用 Brain API。

```bash
# B33 v1.6：先判断 sprint 类型，再做方向相反的 URL 检测
IS_PLAYGROUND_SPRINT=false
if [ -d "playground" ] && [ -f "playground/server.js" ]; then
  IS_PLAYGROUND_SPRINT=true
fi

if [[ "$IS_PLAYGROUND_SPRINT" == "true" ]]; then
  # playground sprint：Brain API URL = planner_drift（原 B33 逻辑，保留）
  if grep -qE "localhost:5221/api/brain/|/api/brain/(ping|health|tasks|tick|status)" /tmp/e2e-verify.sh; then
    DRIFT_LINE=$(grep -E "localhost:5221/api/brain/|/api/brain/(ping|health|tasks|tick|status)" /tmp/e2e-verify.sh | head -1)
    cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"url_validation","log_excerpt":"playground sprint 禁止调用 Brain API：$DRIFT_LINE"}
BREOF
    exit 0
  fi
else
  # 真实功能 sprint：autonomous journey_type 必须包含真实 Brain API URL
  if [[ "$JOURNEY_TYPE" == "autonomous" ]]; then
    if ! grep -qE "localhost:5221/api/brain/|psql.*cecelia" /tmp/e2e-verify.sh; then
      cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"url_validation","log_excerpt":"autonomous sprint 的 E2E 脚本未测真实 Brain API (localhost:5221) 或 DB，检测到可能测了 playground 或未知目标，请改为 curl localhost:5221/api/brain/... 验证真实行为"}
BREOF
      exit 0
    fi
  fi
fi
```

**位置词死规则（v1.6）**：

| sprint 类型 | Brain API URL (5221) | playground URL (3xxx) |
|---|---|---|
| playground sprint（`playground/server.js` 存在）| ❌ FAIL（planner_drift）| ✅ 必须有 |
| 真实功能 sprint autonomous | ✅ 必须有 | ❌ FAIL（错误目标）|
| 真实功能 sprint user_facing | ✅ 需要（API 验后端）| ❌ 无意义 |

#### Step B-2: 执行 E2E 脚本

```bash
timeout 120 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
EXIT_CODE=${PIPESTATUS[0]}
# timeout 退出码 124 表示超时
if [[ $EXIT_CODE -eq 124 ]]; then
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"timeout","log_excerpt":"E2E 脚本执行超时（120 秒），请检查被测服务是否正常启动或脚本是否有无限等待"}
BREOF
  exit 0
fi
```

按 `target_environment` 选择执行方式（v1.6 — 机器感知派发）：

```bash
# 读取 target_environment（从 PRD 或注入变量）
TARGET_ENV="${TARGET_ENV:-local_api}"

case "$TARGET_ENV" in

  local_api)
    # Brain 本地部署，curl + psql
    timeout 120 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  mac_web)
    # Playwright 本机浏览器（Cecelia Dashboard，localhost:5174）
    # Step B-1 提取的脚本是 /tmp/e2e-verify.sh（bash 块）；若合同为 .js 则 fallback node
    if [[ -f /tmp/e2e-verify.js ]]; then
      timeout 180 node /tmp/e2e-verify.js 2>&1 | tee /tmp/e2e-result.log
    else
      timeout 180 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    fi
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  windows_cloud)
    # GitHub Actions windows-latest runner（ZenithJoy Agent 等连公网产品）
    # 每次触发都是全新干净 VM，免费（public repo），适合下载安装包/连云端 endpoint
    # 合同 e2e 脚本必须是 .ps1 格式（见 proposer windows_cloud 模板）
    # 等待结果：轮询 run 状态，最长 10 分钟
    # GITHUB_REPO 由 harness-initiative.graph.js 注入，base_repo 含 zenithjoy → perfectuser21/zenithjoy-workspace
    REPO="${GITHUB_REPO:-perfectuser21/cecelia}"
    WORKFLOW="${WINDOWS_CLOUD_WORKFLOW:-e2e-windows.yml}"
    # ── 前置检查：workflow 内容是否覆盖合同 BEHAVIOR（防假绿）──────────────
    # 读取 workflow 文件，对比合同 BEHAVIOR 断言
    WORKFLOW_FILE=".github/workflows/${WINDOWS_CLOUD_WORKFLOW}"
    if [[ ! -f "$WORKFLOW_FILE" ]]; then
      cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"workflow_content_check","log_excerpt":"workflow 文件不存在: $WORKFLOW_FILE — 合同 BEHAVIOR 断言引用了不存在的 workflow，请先创建该文件"}
BREOF
      exit 0
    fi

    # 提取合同 BEHAVIOR 条目（关键词）
    BEHAVIOR_COUNT=$(grep -c '\[BEHAVIOR\]' "${SPRINT_DIR}/contract-dod.md" 2>/dev/null || echo 0)
    if [[ "$BEHAVIOR_COUNT" -eq 0 ]]; then
      cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"workflow_content_check","log_excerpt":"合同 contract-dod.md 中无 [BEHAVIOR] 条目，无法验证 workflow 覆盖性"}
BREOF
      exit 0
    fi

    # 检查 workflow 是否只有文件存在/大小检查（空壳检测）
    BUSINESS_STEPS=$(grep -cE "(node -e|npx|npm run|npm test|npm ci|vitest|playwright|curl|Invoke-RestMethod|session|publish|cookies|DOUYIN|Set-Content|New-Item|ConvertTo-Json|Write-Host.*PASS)" "$WORKFLOW_FILE" 2>/dev/null || echo 0)
    SHALLOW_ONLY=$(grep -cE "(Test-Path|\.Length|\.Size|file.*exist|exist.*file)" "$WORKFLOW_FILE" 2>/dev/null || echo 0)

    if [[ "$BUSINESS_STEPS" -eq 0 && "$SHALLOW_ONLY" -gt 0 ]]; then
      WORKFLOW_PREVIEW=$(head -30 "$WORKFLOW_FILE" | tr '\n' '|')
      cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"workflow_content_check","log_excerpt":"workflow $WINDOWS_CLOUD_WORKFLOW 只包含文件存在/大小检查，不含任何业务逻辑验证（node/npx/vitest/playwright/curl）。合同 BEHAVIOR 断言无法通过此 workflow 真实验证。请更新 workflow 加入业务行为测试。workflow 前30行: $WORKFLOW_PREVIEW"}
BREOF
      exit 0
    fi

    echo "[evaluator] workflow 内容检查通过: $BUSINESS_STEPS 个业务步骤"
    # ── 触发 GHA workflow ──────────────────────────────────────────────────
    gh workflow run "$WORKFLOW" \
      --repo "$REPO" \
      -f task_id="$TASK_ID" \
      -f sprint_dir="$SPRINT_DIR" \
      -f pr_branch="${PR_BRANCH:-}" \
      2>&1 | tee /tmp/e2e-trigger.log
    TRIGGER_EXIT=$?
    if [[ $TRIGGER_EXIT -ne 0 ]]; then
      cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"gh_trigger","log_excerpt":"GitHub Actions 触发失败，检查 gh auth 状态和 repo 权限"}
BREOF
      exit 0
    fi
    # 等 Actions 完成（最长 10 分钟，每 30 秒轮询一次）
    sleep 10
    for i in $(seq 1 20); do
      RUN_STATUS=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 1 \
        --json status,conclusion --jq '.[0].status' 2>/dev/null)
      RUN_CONCLUSION=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 1 \
        --json status,conclusion --jq '.[0].conclusion' 2>/dev/null)
      if [[ "$RUN_STATUS" == "completed" ]]; then
        break
      fi
      sleep 30
    done
    if [[ "$RUN_CONCLUSION" == "success" ]]; then
      EXIT_CODE=0
    else
      EXIT_CODE=1
      gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 1 \
        --json url --jq '.[0].url' > /tmp/e2e-result.log 2>&1
      echo "conclusion: $RUN_CONCLUSION" >> /tmp/e2e-result.log
    fi
    ;;


  linux_server)
    # SSH 到 hk-vps 或 us-vps 执行 bash 脚本
    LINUX_HOST="${LINUX_E2E_HOST:-hk-vps}"
    scp /tmp/e2e-verify.sh "$LINUX_HOST:/tmp/cecelia-e2e.sh" 2>&1
    timeout 180 ssh "$LINUX_HOST" "bash /tmp/cecelia-e2e.sh" \
      2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  playground)
    # playground 训练 sprint，本地执行
    timeout 60 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  *)
    echo "WARN: 未知 TARGET_ENV=$TARGET_ENV，回退到 local_api"
    timeout 120 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;
esac
```

**前置条件**：

`windows_cloud`：
- `gh` CLI 已登录（`gh auth status` 验证），PAT 有 `workflow` write scope
- 目标 repo 有 `e2e-windows.yml` workflow（含 `workflow_dispatch` 触发器）
- GitHub Actions 使用 `windows-latest` runner，免费（public repo）

`linux_server`：
- `~/.ssh/config` 已配置 `hk-vps` / `us-vps` 别名，SSH 免密登录已配置
- 目标机器上 `node` / `bash` 已安装

#### Step B-2.5: 截图处理（仅 mac_web）

```bash
if [[ "$TARGET_ENV" == "mac_web" ]]; then
  SPRINT_BASENAME=$(basename "$SPRINT_DIR")
  SCREENSHOT_DEST="$HOME/claude-output/harness-screenshots/$SPRINT_BASENAME"
  mkdir -p "$SCREENSHOT_DEST"

  # 1. 复制截图到公网目录
  if ls screenshots/*.png 2>/dev/null | head -1 > /dev/null; then
    cp screenshots/*.png "$SCREENSHOT_DEST/"
  fi

  # 2. Claude Read 每张截图自验（视觉确认）
  # evaluator 必须用 Read tool 读取 $SCREENSHOT_DEST 下每张 PNG，
  # 对照 DoD [BEHAVIOR:E2E] 期望描述逐一确认画面内容：
  # - 01-initial.png：页面是否正常加载，关键 UI 元素是否可见？
  # - 02-action.png：用户操作后状态是否符合期望描述？
  # - 03-result.png：最终结果是否显示成功标志元素？
  # 如果任意截图与期望描述不符 → 输出 FAIL，feedback 说明哪张图与期望不符

  # 3. 生成公网链接列表
  SCREENSHOT_URLS=()
  for f in "$SCREENSHOT_DEST"/*.png; do
    [ -f "$f" ] || continue
    BASENAME=$(basename "$f")
    SCREENSHOT_URLS+=("http://38.23.47.81:9998/harness-screenshots/$SPRINT_BASENAME/$BASENAME")
  done
  SCREENSHOTS_JSON=$(printf '%s\n' "${SCREENSHOT_URLS[@]}" | jq -R . | jq -s .)
else
  SCREENSHOTS_JSON="[]"
fi
```

---

#### Step B-2.6: windows_cloud artifact 下载 + 视觉验证

```bash
if [[ "$TARGET_ENV" == "windows_cloud" ]]; then
  REPO="${GITHUB_REPO:-perfectuser21/zenithjoy-workspace}"
  WORKFLOW="${WINDOWS_CLOUD_WORKFLOW:-e2e-windows.yml}"

  # 获取最新 run ID（触发后等 10s 再查，避免拿到上一次 run）
  RUN_ID=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" \
    --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)

  if [[ -n "$RUN_ID" ]]; then
    # 下载 screenshots artifact（GHA workflow 需上传 artifact name="screenshots"）
    mkdir -p /tmp/windows-cloud-screenshots
    gh run download "$RUN_ID" \
      --repo "$REPO" \
      --name "screenshots" \
      --dir /tmp/windows-cloud-screenshots 2>/dev/null || true

    # evaluator 必须用 Read tool 读取每张 PNG，对照 DoD [BEHAVIOR:E2E] 逐一视觉确认：
    # - 截图是否展示了期望的界面元素？
    # - 操作结果是否与 DoD 描述一致？
    # 如有截图与期望不符 → 输出 FAIL，feedback 说明哪张图有问题
    ls /tmp/windows-cloud-screenshots/*.png 2>/dev/null | head -20
  fi

  SCREENSHOTS_JSON="[]"
fi
```

---

#### Step B-3: 判断结果

**脚本 exit 0（通过）**：

```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","failed_step":null,"log_excerpt":null,"screenshots":${SCREENSHOTS_JSON:-[]}}
BREOF
```

**脚本 exit ≠ 0（失败）**：

分析 `/tmp/e2e-result.log`，定位哪个步骤失败（对照合同的 Step 1 / Step 2 / Step 3）：

```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"<Step N>","log_excerpt":"<失败行前后 5 行 + 具体失败原因 + 修复方向>"}
BREOF
```

---

## 输出规范

**输出协议（v1.5.0+ — 文件协议）**：最终结果写入 `"$WORKSPACE/.brain-result.json"`（Docker 默认 `/workspace/.brain-result.json`，mac_web host 执行时为 `$WORKSPACE_PATH/.brain-result.json`），Brain 读文件不读 stdout。

示例（PASS）：

```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","failed_step":null,"log_excerpt":null}
BREOF
```

示例（FAIL）：

```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"task-executor.js 未调用 updateTaskStatus，任务完成后状态未从 in_progress 变为 completed","log_excerpt":"got: in_progress, expected: completed"}
BREOF
```

**禁止**：
- 用 echo 输出 verdict JSON 到 stdout（Brain 不读 stdout）
- 输出摘要/说明文字代替写文件（必须真正写入 "$WORKSPACE/.brain-result.json"）

---

## 常见错误

1. **验证命令用 mock 或 dry-run** → 必须连接真实服务（brain 端口 5221，真实 DB）
2. **feedback 笼统** → 必须指明具体文件/函数/值，附修复方向
3. **输出带 markdown 代码块** → Brain 解析 verdict 字段时会失败
4. **模式 A 漏提取 [BEHAVIOR] 条目** → `grep -n '\[BEHAVIOR\]'` 验证提取数量
5. **模式 B E2E 脚本提取不全** → 确认 `## E2E 验收` 区块边界正确
