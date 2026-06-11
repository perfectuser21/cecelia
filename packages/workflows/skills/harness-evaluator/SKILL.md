---
id: harness-evaluator-skill
description: |
  Harness Evaluator — 阶段 B **pre-merge gate**（不是 merge 后）：
  Generator 写完代码 push PR 后，CI 跑过基础卫生（lint/type/vitest mock/build），
  evaluator 在 CI 绿之后、PR merge 之前真启服务 + 跑 contract 的 manual:bash 命令验真行为。
  PASS → 允许 merge；FAIL → 不 merge，带反馈打回 Generator 在 PR 分支 fix loop（main 不变动）。
  单模式（harness v2 始终 IS_FINAL_E2E=true）：读 contract-draft.md 的 ## E2E 验收 脚本，按 target_environment 派发跑 Golden Path 端到端真实行为。
version: 1.15.0
created: 2026-05-06
updated: 2026-06-11
changelog:
  - 1.15.0: 链路审计修复 7 项 — (a) 清理模式 A/WS 拆分残留（description/常见错误/变量表统一为单模式 IS_FINAL_E2E=true 跑 contract-draft.md ## E2E 验收，全文清掉 ws_id/contract-dod-ws）；(b) 修 Step B-2 双重执行 bug（删无条件首跑，windows 环境不再 bash 不存在的 .sh，超时 124 判定并入 case 后统一）；(c) 新增 Step B-1.6 环境预检 + localhost 重写（容器内 sed 重写 + 二进制 command -v 缺失即 env_missing FAIL，禁止降级）；(d) 新增 Step B-1.7 弱 oracle/作弊扫描；(e) 新增 Step B-1.8 Golden Path 覆盖核对；(f) 新增「领域验证死规则」（视频 ffprobe / 发布真实出现 / DB 时间窗 / UI 可见断言）；(g) 修注入变量表 WECHAT_RPA_WORKFLOW/WORKSPACE_PATH/mac_web 注解
  - 1.14.0: windows_wechat E2E 路由 3 项修复 — P0: 删除 ;;&fallthrough，windows_wechat 合并入 OR pattern 触发 e2e-wechat-rpa.yml（xian-rog self-hosted）；P1: Step B-1 ps1 提取条件加入 windows_wechat；P2: B33 autonomous 检测排除 windows_cloud/windows_wechat（PowerShell E2E 不含 localhost:5221 是正常的）
  - 1.13.0: 截图路径从 ~/claude-output/ 改为 SPRINT_DIR/screenshots/（与 Report Step8 index.html 对齐）
  - 1.12.0: 修复历史 DoD 文件名 + 变量名双重不匹配 — proposer v8.0 起统一写 contract-dod.md（取代旧 per-WS 拆分文件名）；统一解析变量名（历史条目，单模式后已不再有多文件 fallback）
  - 1.11.1: 修复空壳检测正则漏掉 npm test/npm ci 和 PowerShell 业务命令 — eval 中发现 BUSINESS_STEPS 正则用 "npm run" 但未含 "npm test"（GHA 常用写法）及 "npm ci"，导致用了 npm test 的真实业务 workflow 被误判为空壳；同步补充 PowerShell 业务模式（Set-Content/New-Item/ConvertTo-Json）防止 PS 脚本的 session 写入被漏判
  - 1.11.0: windows_cloud 模式 B trigger 前新增 workflow 内容检查 — 在 gh workflow run 之前检查：(1) workflow 文件是否存在；(2) 合同 contract-dod.md 是否有 [BEHAVIOR] 条目；(3) workflow 是否只有文件存在/大小检查而不含业务逻辑验证（node/npx/vitest/playwright/curl 等）。第 3 条命中时直接 FAIL，防止 workflow 空壳导致假绿
  - 1.10.0: mac_web host executor 兼容 — 新增 WORKSPACE="${WORKSPACE_PATH:-/workspace}" 变量；所有 .brain-result.json 写入路径改为 "$WORKSPACE/.brain-result.json"（Docker /workspace，宿主 worktreePath）；mac_web Step B-2 修复：由 node /tmp/e2e-verify.js（文件不存在）改为优先 bash /tmp/e2e-verify.sh 并 fallback node .js；更新注入变量表格添加 WORKSPACE_PATH 和 WINDOWS_CLOUD_WORKFLOW
  - 1.9.0: Step B-2.5 截图处理（mac_web 专属）— 复制 screenshots/*.png 到 sprint 截图目录（v1.13 后统一 SPRINT_DIR/screenshots/）；Claude Read 每张 PNG 视觉自验（对照 BEHAVIOR:E2E 期望描述）；生成公网 URL（38.23.47.81:9998）；PASS brain-result.json 增加 screenshots 字段
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

# /harness-evaluator — Harness Evaluator（阶段 B · 验证层）

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
| `IS_FINAL_E2E` | harness v2 始终注入 `true`（单模式 E2E）；缺失或非 `true` = Brain dispatch 异常，直接 FATAL（见 Step 0） |
| `SPRINT_DIR` | Sprint 目录，如 `sprints/run-20260506-1400` |
| `TASK_ID` | Brain 中当前 evaluate task 的 UUID |
| `JOURNEY_TYPE` | `user_facing` / `autonomous` / `dev_pipeline` / `agent_remote` |
| `TARGET_ENV` | `mac_web` / `windows_cloud` / `windows_wechat` / `linux_server` / `local_api` / `playground`（来自 PRD `target_environment` 字段；`mac_web` = 在宿主 Mac 直跑（非 Docker），Playwright 可达 localhost:5174；`windows_wechat` = xian-rog self-hosted，微信已登录；`windows_cloud` = GHA windows-latest 云端）|
| `WORKSPACE_PATH` | 结果文件写入目录。**mac_web 宿主执行时由 host-executor 注入**（值为 worktreePath）；Docker 默认不注入，脚本 fallback `/workspace` |
| `WINDOWS_CLOUD_WORKFLOW` | GHA workflow 文件名（harness-initiative.graph.js 根据 base_repo 注入：zenithjoy → `agent-e2e-video.yml`，否则 `e2e-windows.yml`）|
| `WECHAT_RPA_WORKFLOW` | windows_wechat 专用 GHA workflow 文件名，**由 `evaluateContractNode` 注入，缺省 `e2e-wechat-rpa.yml`**；在 xian-rog self-hosted runner（微信已登录）上运行 |
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
3. **缺 [BEHAVIOR] Test: 命令直接 FAIL**。如果合同 contract-dod.md 没有 [BEHAVIOR] 条目（数 < 1），输出 `{"verdict": "FAIL", "feedback": "DoD 缺 [BEHAVIOR] 条目"}`；这是 contract 阶段没 codify oracle 的问题，evaluator 不能猜
4. **缺 jq -e 严匹配直接 FAIL**。如果 [BEHAVIOR] Test: 命令只 `curl -f /xxx` 不带 jq 校验 body shape，输出 `{"verdict":"FAIL","feedback":"命令缺 jq -e 严匹配，属弱 oracle，schema drift 无法被抓，拒绝通过；请在 contract-dod 里补充 jq -e 值校验命令后重新提交"}` — 禁止"容忍但报告"的中间态，GAN 已收敛后不存在"下轮 reviewer 再严化"的机会

**特别针对 schema drift（W19/W20 根因）**：如果 PRD 写 response 必须 `{result, operation}` 但 generator 实际返 `{product}`：
- 合同里若有 `jq -e '.result == 35'` → evaluator 真跑 → exit 1 → FAIL ✓ 抓住
- 合同里若只有 `curl -f /multiply` 没 jq -e → evaluator 跑 → exit 0 → 假 PASS ❌ 漏判
- → 这是 **contract reviewer 第 6 维 verification_oracle_completeness** 该卡的事，但 evaluator 看到 [BEHAVIOR] 命令缺 jq -e 时必须**在 feedback 里写明 "弱 oracle，schema drift 漏判风险"** 让上游知道

---

## 执行流程

### Step 0a：切到 PR 分支（pre-merge gate 前置）

evaluator 必须先切到 PR 分支才能跑 server 验真行为。evaluator 跑 generator 在 PR 分支写的代码，PR 分支名由 `$PR_BRANCH` env 提供（brain `evaluateContractNode` 透传 — B14 修复）。

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

# harness v2 始终注入 IS_FINAL_E2E=true；若未注入说明 Brain dispatch 异常
[[ "$IS_FINAL_E2E" == "true" ]] || {
  echo "FATAL: IS_FINAL_E2E 未注入，Brain dispatch 异常，请检查 harness-initiative.graph.js" >&2
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"dispatch_error","log_excerpt":"IS_FINAL_E2E 未注入，Brain evaluateContractNode 配置异常"}
BREOF
  exit 1
}
echo "模式 B — 最终 E2E"
```

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

if [[ "$TARGET_ENV" == "windows_cloud" || "$TARGET_ENV" == "windows_wechat" ]]; then
  # windows_cloud / windows_wechat：提取 ps1/powershell 代码块写到 sprint_dir/e2e-verify.ps1，供 GHA runner 使用
  awk '/^## E2E 验收/{found=1} found && /^```(powershell|ps1)/{in_block=1; next} in_block && /^```/{in_block=0; exit} in_block{print}' \
    "$CONTRACT" > /tmp/e2e-verify.ps1
  if [[ ! -s /tmp/e2e-verify.ps1 ]]; then
    # fallback：尝试 bash 块（兼容旧合同格式）
    awk '/^## E2E 验收/{found=1} found && /^```bash/{in_block=1; next} in_block && /^```/{in_block=0; exit} in_block{print}' \
      "$CONTRACT" > /tmp/e2e-verify.ps1
  fi
  if [[ ! -s /tmp/e2e-verify.ps1 ]]; then
    cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"setup","log_excerpt":"windows_cloud/windows_wechat 合同中未找到 ## E2E 验收 区块或区块内无 ps1/powershell 脚本"}
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
  # windows_cloud/windows_wechat 的 E2E 是 PowerShell，通过 GHA 运行，不直接调 localhost:5221，跳过此检测
  if [[ "$JOURNEY_TYPE" == "autonomous" && "$TARGET_ENV" != "windows_cloud" && "$TARGET_ENV" != "windows_wechat" ]]; then
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

#### Step B-1.6: 环境预检 + localhost 重写（执行前置，与 generator Step 6.5 镜像）

**在执行 E2E 脚本前必须先做两件事：容器内 URL 重写 + 工具可用性预检。windows_cloud/windows_wechat 走 GHA runner，跳过本步（脚本是 .ps1，在远端机器执行）。**

```bash
if [[ "$TARGET_ENV" != "windows_cloud" && "$TARGET_ENV" != "windows_wechat" ]]; then
  # ── 1) 容器内 localhost 重写（$BRAIN_URL 含 host.docker.internal 说明在容器里跑）──
  # 与 harness-generator Step 6.5 的替换逻辑镜像，保证 evaluator 与 generator 自验环境一致
  if [[ "$BRAIN_URL" == *"host.docker.internal"* ]]; then
    BRAIN_HOST_PORT=$(echo "$BRAIN_URL" | sed -E 's|https?://||')
    sed -i "s|localhost:5221|$BRAIN_HOST_PORT|g" /tmp/e2e-verify.sh
    sed -i "s|postgresql://localhost|postgresql://host.docker.internal|g" /tmp/e2e-verify.sh
    echo "[evaluator] 容器内 URL 重写完成：localhost:5221→$BRAIN_HOST_PORT, pg→host.docker.internal"
  fi

  # ── 2) 二进制可用性预检（脚本引用的工具逐个 command -v）──
  REQUIRED_BINS=""
  grep -qE '\bpsql\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS psql"
  grep -qE '\b(playwright|npx playwright)\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS playwright"
  grep -qE '\bffprobe\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS ffprobe"
  grep -qE '\bffmpeg\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS ffmpeg"
  grep -qE '\bnode\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS node"
  grep -qE '\bjq\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS jq"
  grep -qE '\bcurl\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS curl"

  for bin in $REQUIRED_BINS; do
    BIN_CHECK="$bin"
    [[ "$bin" == "playwright" ]] && BIN_CHECK="npx"   # playwright 通过 npx 调用
    if ! command -v "$BIN_CHECK" >/dev/null 2>&1; then
      MISS_LINE=$(grep -nE "\b$bin\b" /tmp/e2e-verify.sh | head -1)
      cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"env_missing","log_excerpt":"E2E 脚本需要 $bin 但当前环境未安装（脚本引用行：$MISS_LINE）。这是环境路由问题，Brain 应把本 sprint 派到装有 $bin 的目标环境，evaluator 不改写/降级验证。"}
BREOF
      exit 0
    fi
  done
fi
```

**死规则（加粗，必须遵守）**：**禁止在工具缺失时改写验证命令、降级验证、或跳过该步——`env_missing` 就是 FAIL，让 Brain 路由到正确环境，这不是 evaluator 该变通的事。** 例如脚本要 ffprobe 验视频但本机无 ffprobe → 直接 `env_missing` FAIL，绝不允许改成"检查文件大小"凑过。

#### Step B-1.7: 弱 oracle / 作弊扫描（执行前置）

**执行前扫描 /tmp/e2e-verify.sh，命中任一即 FAIL，禁止 PASS。** windows_cloud/windows_wechat 同理扫描 /tmp/e2e-verify.ps1（关键词换成 PowerShell 等价物）。

```bash
SCAN_FILE=/tmp/e2e-verify.sh
[[ "$TARGET_ENV" == "windows_cloud" || "$TARGET_ENV" == "windows_wechat" ]] && SCAN_FILE=/tmp/e2e-verify.ps1

# 1) 有 curl 但全文无 jq -e 值校验 → 弱 oracle
if grep -qE '\bcurl\b' "$SCAN_FILE" && ! grep -qE 'jq -e' "$SCAN_FILE"; then
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"weak_oracle","log_excerpt":"脚本含 curl 但全文无 jq -e 值校验，属弱 oracle，schema drift 无法被抓。请在 contract-draft 的 ## E2E 验收 里补 jq -e 值断言后重交。"}
BREOF
  exit 0
fi

# 2) MOCK_ / 无条件 exit 0 兜底 / 断言上吞错的 || true / dry-run
if grep -qE 'MOCK_|--dry-run|--dryrun|\bdryRun\b' "$SCAN_FILE"; then
  HIT=$(grep -nE 'MOCK_|--dry-run|--dryrun|\bdryRun\b' "$SCAN_FILE" | head -1)
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"cheat_scan","log_excerpt":"脚本含 MOCK_/dry-run 作弊标志（行：$HIT），非真实执行路径。E2E 必须打真实服务/真实产物，禁止 mock 与 dry-run。"}
BREOF
  exit 0
fi
if grep -qE '\|\|[[:space:]]*true' "$SCAN_FILE" || grep -qE '^[[:space:]]*exit 0[[:space:]]*$' "$SCAN_FILE"; then
  HIT=$(grep -nE '\|\|[[:space:]]*true|^[[:space:]]*exit 0[[:space:]]*$' "$SCAN_FILE" | head -1)
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"cheat_scan","log_excerpt":"脚本含吞错 || true 或无条件 exit 0 兜底（行：$HIT），断言失败也会假绿。删除兜底，让真实 exit code 驱动结果。"}
BREOF
  exit 0
fi

# 3) 只有文件存在/大小检查而无内容断言
if grep -qE 'test -[ef]|\[ -[ef] |\.size|stat -c|ls -l' "$SCAN_FILE" && ! grep -qE 'jq -e|ffprobe|toBeVisible|toHaveText|psql' "$SCAN_FILE"; then
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"weak_oracle","log_excerpt":"脚本只做文件存在/大小检查，无任何内容/行为断言（jq -e / ffprobe / DOM 断言 / psql 均缺）。产出物存在 ≠ 行为正确，请补真实内容断言。"}
BREOF
  exit 0
fi
```

#### Step B-1.8: Golden Path 覆盖核对（LLM 判断步骤）

**读 `${SPRINT_DIR}/sprint-prd.md` 的 Golden Path 段，逐步核对 E2E 脚本是否对每一步都有对应的真实命令 + 断言。任何一步未覆盖 → FAIL，feedback 列出未覆盖步骤。**

这是 **LLM 判断步骤**（不是纯 bash）。evaluator 必须：

1. 用 Read 工具读 `${SPRINT_DIR}/sprint-prd.md`，提取 Golden Path 每个步骤（Step 1/2/3…）。
2. 用 Read 读 `/tmp/e2e-verify.sh`（或 .ps1）。
3. **输出一张逐步对照表**（这是硬要求，不能只给结论）：

   | Golden Path 步骤 | 脚本中对应命令行号 | 是否有断言（jq -e / ffprobe / DOM / psql）|
   |---|---|---|
   | Step 1: <用户动作> | L<行号> 或「未覆盖」 | ✅/❌ |

4. 任一步骤「未覆盖」或「无断言」→ 写 FAIL：

```bash
cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"golden_path_gap","log_excerpt":"Golden Path 第 N 步「<步骤描述>」在 E2E 脚本中无对应命令/断言。E2E 必须覆盖 Golden Path 每一步，请补该步的真实命令 + 断言。"}
BREOF
exit 0
```

#### 领域验证死规则（evaluator 侧卡点 — 执行前扫描，缺对应 oracle 直接 FAIL）

**sprint 涉及对应领域时，E2E 脚本必须含下表的 oracle，缺则 FAIL（failed_step=domain_oracle_missing）。与 proposer 合同侧「领域验证规则」死规则一一呼应。**

| sprint 涉及 | 脚本必须含的 oracle | 缺失时 feedback |
|---|---|---|
| **视频**（生成/剪辑/转码，产出 .mp4/.mov 等）| `ffprobe` 验**视频流 + 音频流 + 时长合理**（如 `ffprobe -v error -show_streams` + 判断 codec_type=video/audio + duration>0）| "视频类 sprint 但脚本无 ffprobe 视频流/音频流/时长断言" |
| **发布**（抖音/快手/小红书/视频号/公众号等）| 验证内容**真实出现**（平台 API 查到帖子 / 截图确认），非"脚本 echo ok" | "发布类 sprint 但脚本未验证内容真实出现（平台 API/截图）" |
| **DB 写入** | `psql` 查行数且带 **`created_at > NOW() - interval`** 时间窗（防历史数据冒充本轮）| "DB 写入类 sprint 但脚本无带时间窗的 psql 行数断言" |
| **UI 交互** | 可见状态断言：`toBeVisible` / `toHaveText` / 截图比对 | "UI 类 sprint 但脚本无可见状态断言（toBeVisible/toHaveText/截图）" |

判断"sprint 涉及哪个领域"以 `${SPRINT_DIR}/sprint-prd.md` 的 Golden Path + journey_type + target_environment 为准。命中领域但脚本缺对应 oracle → FAIL，不允许放行。

#### Step B-2: 执行 E2E 脚本

**只执行一次**。按 `target_environment` 选择执行方式（v1.6 — 机器感知派发）。每个 case 分支自行设 `EXIT_CODE`；超时（exit 124）判定在 case 之后**统一**处理。

> ⚠️ v1.15 删除了旧版的无条件首跑（旧版先无条件 `timeout 120 bash /tmp/e2e-verify.sh` 再按 case 重跑一遍 = 双重执行；且 windows_cloud/windows_wechat 时首跑会 `bash` 一个不存在的 `.sh`——脚本实际是 `.ps1`）。现在只在对应 case 分支里执行一次。

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

  windows_cloud|windows_wechat)
    # GitHub Actions runner（ZenithJoy Agent 等连公网产品）
    # windows_cloud  → GHA windows-latest 云端 runner（全新干净 VM）
    # windows_wechat → xian-rog self-hosted runner（微信已登录的 Windows 环境）
    # 合同 e2e 脚本必须是 .ps1 格式（见 proposer windows_cloud 模板）
    # 等待结果：轮询 run 状态，最长 10 分钟
    # GITHUB_REPO 由 harness-initiative.graph.js 注入，base_repo 含 zenithjoy → perfectuser21/zenithjoy-workspace
    REPO="${GITHUB_REPO:-perfectuser21/cecelia}"
    if [[ "$TARGET_ENV" == "windows_wechat" ]]; then
      WORKFLOW="${WECHAT_RPA_WORKFLOW:-e2e-wechat-rpa.yml}"
    else
      WORKFLOW="${WINDOWS_CLOUD_WORKFLOW:-e2e-windows.yml}"
    fi
    # ── 前置检查：workflow 内容是否覆盖合同 BEHAVIOR（防假绿）──────────────
    # 读取 workflow 文件，对比合同 BEHAVIOR 断言
    WORKFLOW_FILE=".github/workflows/${WORKFLOW}"
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
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"workflow_content_check","log_excerpt":"workflow $WORKFLOW 只包含文件存在/大小检查，不含任何业务逻辑验证（node/npx/vitest/playwright/curl）。合同 BEHAVIOR 断言无法通过此 workflow 真实验证。请更新 workflow 加入业务行为测试。workflow 前30行: $WORKFLOW_PREVIEW"}
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

# ── 统一超时判定（timeout 退出码 124 = 超时）──────────────────────────
# 各 case 分支用 timeout 跑脚本，超时统一在此判定，不在分支内重复
if [[ "$EXIT_CODE" -eq 124 ]]; then
  cat > "$WORKSPACE/.brain-result.json" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"timeout","log_excerpt":"E2E 脚本执行超时，请检查被测服务是否正常启动或脚本是否有无限等待"}
BREOF
  exit 0
fi
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
  SCREENSHOT_DEST="$SPRINT_DIR/screenshots"
  mkdir -p "$SCREENSHOT_DEST"

  # 1. 复制截图到 sprint 目录
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

  # 3. 生成链接列表
  SCREENSHOT_URLS=()
  for f in "$SCREENSHOT_DEST"/*.png; do
    [ -f "$f" ] || continue
    SCREENSHOT_URLS+=("$f")
  done
  SCREENSHOTS_JSON=$(printf '%s\n' "${SCREENSHOT_URLS[@]}" | jq -R . | jq -s .)
else
  SCREENSHOTS_JSON="[]"
fi
```

---

#### Step B-2.6: windows_cloud artifact 下载 + 视觉验证

```bash
if [[ "$TARGET_ENV" == "windows_cloud" || "$TARGET_ENV" == "windows_wechat" ]]; then
  REPO="${GITHUB_REPO:-perfectuser21/zenithjoy-workspace}"
  if [[ "$TARGET_ENV" == "windows_wechat" ]]; then
    WORKFLOW="${WECHAT_RPA_WORKFLOW:-e2e-wechat-rpa.yml}"
  else
    WORKFLOW="${WINDOWS_CLOUD_WORKFLOW:-e2e-windows.yml}"
  fi

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
4. **E2E 脚本提取不全** → 确认 `contract-draft.md` 的 `## E2E 验收` 区块边界正确，提取后 `/tmp/e2e-verify.sh`（或 `.ps1`）非空
5. **跳过环境预检/弱 oracle 扫描直接执行** → 执行前必跑 Step B-1.6/B-1.7/B-1.8：工具缺失 = `env_missing` FAIL（禁止降级），弱 oracle/作弊命中 = FAIL，Golden Path 有步骤未覆盖 = FAIL
