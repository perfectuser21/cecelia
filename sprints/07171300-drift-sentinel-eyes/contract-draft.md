# 行为合同 — 漂移哨兵容器内双目失明修复

**TASK_ID**: fe385921-603a-449f-ba88-606559fd2d43
**Sprint Dir**: sprints/07171300-drift-sentinel-eyes
**合同版本**: v1.0
**日期**: 2026-07-17

---

## 行为合同

### FR-FIX-01：sha_main 探针——容器内免凭据获取

**目标函数**: `defaultFetchMainSha()` in `packages/brain/src/cron/drift-sentinel.js`

**行为描述**:

1. 优先路径：执行 `git ls-remote https://github.com/perfectuser21/cecelia.git refs/heads/main`（公开仓，无需认证，容器有 git）。
   - 若 stdout 中第一个 token 长度 >= 7，视为有效 SHA，返回。
   - 若 stdout 为空或格式异常，抛出含具体信息的异常，降级执行路径 2。

2. 降级路径：执行 `curl -sf --max-time 10 https://api.github.com/repos/perfectuser21/cecelia/commits/main`，解析 JSON `.sha` 字段。
   - 若 `.sha` 字段存在且非空，返回该值。
   - 若字段缺失或解析失败，抛出含具体信息的异常。

3. 两条路均失败：抛出聚合异常，格式：`sha_main 两条路均失败: git=<gitErr.message>; curl=<curlErr.message>`。调用方捕获后打印 `verdict=network_error error=<原始错误原文>`。

4. **废弃**：`git ls-remote origin ...` 和 `gh api ...` 两条路不再使用（容器内不可用）。

**期望结果**:
- 容器内网络正常（github.com 可达）→ 返回 40 位 SHA 字符串，不再返回 UNKNOWN。
- 宿主机环境（有 gh CLI / origin 可达）→ `git ls-remote <HTTPS URL>` 同样生效，无退化。

---

### FR-FIX-02：sha_prod 探针——改用 localhost 自查

**目标函数**: `defaultFetchProdSha()` in `packages/brain/src/cron/drift-sentinel.js`

**行为描述**:

1. `BRAIN_PROD_URL` 的默认值从 `'https://brain.cecelia.ai'`（外网，容器内不可达） 改为 `'http://localhost:5221/api/brain'`（含路径前缀）。curl 拼接 `/health` 后完整端点为 `http://localhost:5221/api/brain/health`——该端点由 `src/routes/goals.js` 的 `router.get('/health', ...)` 提供，经 `app.use('/api/brain', brainRoutes)` 挂载（参见 `packages/brain/server.js:337`）。

2. 执行 `curl -sf --max-time 10 "${prodUrl}/health"`（prodUrl 含 `/api/brain` 时 = `http://localhost:5221/api/brain/health`），解析 JSON `.git_sha` 字段。
   - 若 `.git_sha` 存在且非空，返回。
   - 若字段缺失，抛出错误：`health endpoint missing git_sha: <前 200 字节响应>`。
   - 若 curl 失败，抛出错误：`sha_prod fetch failed (${prodUrl}): <err.message>`。

3. 仍支持环境变量 `BRAIN_PROD_URL` 覆盖（测试或多集群场景，覆盖时需包含路径前缀）。

**期望结果**:
- 容器内 Brain 进程运行中 → `defaultFetchProdSha()` 请求 `http://localhost:5221/api/brain/health` 返回 `git_sha`，不再返回 UNKNOWN。
- `BRAIN_PROD_URL` 显式设置时，沿用设置值（向后兼容，调用方负责包含正确路径前缀）。

---

### FR-FIX-03：错误日志带原始错误原文

**行为描述**:

所有 catch 块在打 `verdict=network_error` 或 `verdict=prod_unreachable` 的 console.log 时，必须附带 `error=<原始错误信息>`。

要求格式示例（不要求完全相同，但必须包含 `error=` 前缀和错误原文）：
```
[drift_check] sha_main=UNKNOWN sha_prod=UNKNOWN verdict=network_error error=sha_main 两条路均失败: git=...exit code 128; curl=...connection refused
[drift_check] sha_main=<SHA> sha_prod=UNKNOWN verdict=prod_unreachable error=sha_prod fetch failed (http://localhost:5221): connection refused
```

**期望结果**:
- 任何 `verdict=network_error` 或 `verdict=prod_unreachable` 日志行必须包含 `error=` 字段。
- 错误原文必须来自原始异常的 `err.message`，不得自行编写模糊描述。

---

### FR-FIX-04：新增容器环境探针测试（TDD）

**测试文件**: `packages/brain/src/cron/__tests__/drift-sentinel.test.js`

| 测试 ID | mock 条件 | 期望结果 |
|---------|-----------|---------|
| FR-NEW-container-main | `origin` 不可达、`gh` 不可用；仅 `git ls-remote <HTTPS URL>` 和 `curl github api` 可用。**修复前**：函数走旧路径（origin / gh），两条路失败 → 抛异常 → `verdict=network_error`（failing test 先验证此行为）；**修复后**：走新路径返回有效 SHA | `verdict ≠ network_error`，`sha_main` 长度 >= 7 |
| FR-NEW-container-prod | mock `http://localhost:5221/api/brain/health` 可达，返回含 `git_sha` 的 JSON；当前代码默认使用外网 URL 失败（修复前为 failing test）；修复后使用 localhost:5221/api/brain/health 成功 | `sha_prod` 有效，`verdict ≠ prod_unreachable` |
| FR-NEW-network-full-down | 所有路径均失败：`git ls-remote`、`curl github api`、`curl localhost:5221/api/brain/health` 全部抛异常 | `verdict=network_error`（保守跳过，业务逻辑不改变） |
| FR-NEW-error-log | `sha_main` 两条路均失败时，console.log 调用参数中必须包含 `error=` 字段和原始错误文本 | `console.log` 被调用且参数匹配 `/error=/` |

**TDD 纪律**：
- 必须先写 failing test（提交 failing 快照或 `// FAILING` 注释标记），再修实现，再确认 passing。
- mock 策略：注入 `fetchMainSha` / `fetchProdSha` 函数替换真实网络调用；不 mock `isDrifted()` 判定逻辑与 `runDeploy()` 之间的边（INV-04）。

---

### NFR 合同

| NFR | 合同断言 |
|-----|---------|
| NFR-1 | hotfix 范围：**仅** `defaultFetchMainSha()`、`defaultFetchProdSha()` 以及对应 catch 块的 console.log；不改 `runDriftCheck()` 核心判定逻辑（`isDrifted()`、防抖、redeploy、escalate 路径） |
| NFR-2 | 不引入新 npm 依赖；仅使用 `child_process.exec`（已有）和 Node.js 内置 `JSON.parse` |
| NFR-3 | 现有 FR-15 全部测试（8 个 describe case）必须继续通过，零 regression |
| NFR-4 | `git ls-remote https://github.com/perfectuser21/cecelia.git main` 在宿主机（有 origin / gh 的环境）同样返回有效 SHA（HTTPS 公开仓无需凭据） |
| NFR-5 | 修复后正常容器心跳日志格式：`[drift_check] sha_main=<40位SHA> sha_prod=<40位SHA> verdict=ok`，不再出现 `UNKNOWN` |

---

## E2E 验收

验收脚本：`sprints/07171300-drift-sentinel-eyes/e2e-verify.sh`

```bash
#!/bin/bash
# 容器内执行：验证漂移哨兵探针修复
cd /workspace
node -e "
import('./packages/brain/src/cron/drift-sentinel.js').then(async m => {
  // 验证默认 fetchProdSha 使用 localhost
  const src = (await import('fs')).readFileSync('./packages/brain/src/cron/drift-sentinel.js', 'utf8');
  if (src.includes('localhost:5221')) { console.log('PASS: sha_prod 已改 localhost'); }
  else { console.error('FAIL: sha_prod 未改 localhost'); process.exit(1); }
  
  // 验证 fetchMainSha 使用 github.com URL 而非 origin
  if (src.includes('github.com/perfectuser21/cecelia.git')) { console.log('PASS: sha_main 已改公开 URL'); }
  else { console.error('FAIL: sha_main 未改公开 URL'); process.exit(1); }
});
"
```

以下命令在工作区根目录（`/workspace`）执行，可在容器内或宿主机环境运行。

### 步骤 1：运行 smoke 脚本（静态代码检查）

```bash
bash packages/brain/scripts/smoke/drift-sentinel-smoke.sh
```

期望输出最后一行：`[drift-sentinel-smoke] ALL PASS`

扩展验证（修复后新增检查项，需手动追加到 smoke 脚本或单独执行）：
```bash
# 检查新路径：不再含 origin / gh api 旧逻辑
! grep -n "ls-remote origin" packages/brain/src/cron/drift-sentinel.js && echo "OK: origin 旧路径已移除"
! grep -n "gh api" packages/brain/src/cron/drift-sentinel.js && echo "OK: gh api 旧路径已移除"

# 检查 FR-FIX-02：默认 URL 已改为 localhost
grep "localhost:5221" packages/brain/src/cron/drift-sentinel.js && echo "OK: 默认 URL 已改为 localhost:5221"

# 检查 FR-FIX-03：error= 字段存在于 catch 块日志
grep -n "error=" packages/brain/src/cron/drift-sentinel.js && echo "OK: error= 字段存在"
```

### 步骤 2：运行单测（包含新增 FR-NEW-* 场景）

```bash
cd /workspace/packages/brain && npx vitest run src/cron/__tests__/drift-sentinel.test.js --reporter=verbose
```

期望：
- 全部 12 个（原 8 个 FR-15 + 新增 4 个 FR-NEW）测试通过（0 failed）。
- FR-NEW-container-main、FR-NEW-container-prod 在修复前为 FAIL，修复后为 PASS（TDD 验证）。

### 步骤 3：验证 sha_main 公开 HTTPS 路径（网络可用时）

```bash
# 在容器内或宿主机（无需 gh CLI / git origin 凭据）
git ls-remote https://github.com/perfectuser21/cecelia.git refs/heads/main | cut -f1
```

期望输出：一个 40 位十六进制 SHA（容器内可达时）。

### 步骤 4：验证 sha_prod localhost 路径（Brain 进程运行中时）

```bash
curl -sf http://localhost:5221/api/brain/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK:', d.get('git_sha','MISSING'))"
```

期望输出：`OK: <40位SHA>`（或至少包含 git_sha 字段）。

### 步骤 5：验收 Final E2E（手动触发心跳）

```bash
# 手动调用 runDriftCheck（需 Brain 运行中）
curl -sf -X POST http://localhost:5221/api/brain/run-drift-check 2>/dev/null || \
  node -e "
    import('./packages/brain/src/cron/drift-sentinel.js').then(m => m.runDriftCheck()).then(r => console.log(JSON.stringify(r)));
  "
```

期望结果（JSON）：
```json
{"verdict":"ok","sha_main":"<40位SHA>","sha_prod":"<40位SHA>"}
```
或 `verdict=drifting/redeploying`（当 SHA 真实不一致时），但不得为 `network_error` 或 `prod_unreachable`（在网络正常、Brain 运行的情况下）。

---

## Test Contract 表

| 测试 ID | [BEHAVIOR] 描述 | 验收断言 | 修复前 | 修复后 |
|---------|----------------|---------|--------|--------|
| T1 | [BEHAVIOR] `defaultFetchMainSha()` 在 origin 不可达、gh 无 auth 时，通过 HTTPS URL `git ls-remote` 返回有效 SHA（≥7位） | `result.sha_main.length >= 7` 且 `result.verdict !== 'network_error'` | FAIL（走旧路径 origin/gh 失败） | PASS |
| T2 | [BEHAVIOR] `defaultFetchMainSha()` 在 git 全部失败时，通过 `curl https://api.github.com/...` 降级返回 `.sha` 字段 | `sha` 来自 curl JSON 解析，`result.verdict !== 'network_error'` | FAIL（旧降级路径为 gh api） | PASS |
| T3 | [BEHAVIOR] `defaultFetchProdSha()` 默认使用 `http://localhost:5221/api/brain/health` 而非外网 URL | mock `localhost:5221/api/brain/health` 返回 `{"git_sha":"def..."}` → `result.sha_prod === 'def...'` | FAIL（默认使用外网 URL 失败） | PASS |
| T4 | [BEHAVIOR] 探针失败时 console.log 日志包含 `error=` 前缀和原始错误原文（来自 `err.message`） | spy `console.log` 参数匹配 `/error=.*ECONNREFUSED/` | FAIL（只打 `network_error`，无错误原文） | PASS |
| T5 | [BEHAVIOR] 两探针均失败时，`runDriftCheck` 不抛出；返回 `verdict=network_error`；`consecutiveNetworkErrors` 递增 | `result.verdict === 'network_error'`，不 throw，状态递增 | PASS（保守跳过逻辑已存在） | PASS |

---

## 未覆盖真实链路清单

| 链路 | 是否 mock | 原因（豁免理由） |
|------|-----------|----------------|
| `git ls-remote https://github.com/perfectuser21/cecelia.git` | 是（单测） | CI 环境不保证外网 github.com 可达；通过步骤 3 手动验证覆盖真实路径 |
| `curl https://api.github.com/repos/.../commits/main` | 是（单测） | 同上；步骤 3 降级路径可手动验证 |
| `curl http://localhost:5221/api/brain/health` | 是（单测） | 单测中 Brain 进程不运行；通过步骤 4 手动验证（正确端点为 /api/brain/health，由 goals.js 提供） |
| `brain-deploy.sh` 执行 | 是（mock child_process.exec） | 补部署脚本不应在单测中实际执行；INV-02 要求必须调用该脚本，由 mock 断言 `stringContaining('brain-deploy.sh')` 覆盖 |

所有 mock 均为 I/O 边界豁免，不涉及判定逻辑（符合 INV-04）。
