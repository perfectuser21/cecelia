# Sprint Contract Draft (Round 1)

**Sprint**: kernel 终验 E — playground `GET /kernel-e` 返回 ok-e
**journey_type**: autonomous
**target_environment**: playground（is_skeleton 训练 sprint — PRD 明确为 kernel 终验，本地 `node playground/server.js` 起服务自测）

> gp-anchor: skipped (product-map.json not found)
> contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），按代码层 gate + skill 内置规则双审。

## 锚定父路声明

独立小路（无父路）—— PRD `step_id: none`、`gp_anchor=none(infra)`，本 line（journey e6f803f2）下 ability 均为 planned，无累积 FR，故本 sprint 为独立 marker 端点小路。

## Response Schema（推导来源: PRD 字面 + api_registry 推导）

### Endpoint: GET /kernel-e
**Success (HTTP 200)**:
```json
{"result": "ok-e"}
```
- `result` (string, 必填): 来源——PRD `## 假设` 显式 `{"result":"ok-e"}`，字面值恒为 `"ok-e"`；字段名 `result` 与 playground 现有 `/subtract`、`/increment`、`/decrement`、`/abs`、`/sign` 端点的成功字段命名约定一致（api_registry 推导）。
- **顶层 keys 完整性**: 恰为 `["result"]`，不允许多余字段。

**禁用字段名**（不得作为成功响应 key 出现）: `ok`（/health 用）、`pong`（/ping 用）、`msg`/`echo`（/echo 用）、`status`、`message`、`data`、`output`、`operation`（本端点为无运算 marker，不带 operation 字段）。

**Error / 非 GET 方法**:
- 本端点为无参 marker 端点，**不做参数校验**：携带任意多余 query 参数仍返回 200 + `{"result":"ok-e"}`（区别于 /sum /multiply 等算术端点）。
- `POST /kernel-e`（及其他非 GET 方法）未注册 → 走 Express 默认 404（沿用 /ping 的行为约定）。

## 已知约束（来自回归测试 + 累积 FR）

- [playground/tests/ping.test.js] → GET /ping → 200 + {pong: true}；带任意 query 参数仍 200；keys 完整性 == ["pong"]；禁用 key 反向；POST /ping → 404
- [playground/tests/echo.test.js] → GET /echo?msg=hello → 200 + {echo}；keys 完整性 == ["echo"]；禁用 key 反向
- [累积FR] （本 line journey e6f803f2 下 ability 均为 planned，无历史已验收行为，无回退风险）
- context-manifest: 未拉取（本 sprint 为独立 marker 端点，与累积 FR 无耦合；PRD 累积 FR 段已显式声明本 line 暂无历史）

## Invariant 覆盖（PRD 铁律逐条映射）

- INV-1 [验证命令实跑]：本合同所有验证命令均已实跑确认 exit code 语义（见「TDD Red 采集方式」），vitest 对 include 范围内路径（playground/tests/）跑绿 exit 0、Red 时 exit 1。→ 见 contract-dod.md INV-1 条目。
- INV-2 [证据分流]：N/A —— 本 sprint 无 judge 补证轮设计职责（evaluator/judge 侧规则，proposer 合同不引入违反）。
- INV-3 [台账不入库]：N/A —— 本 sprint 不触碰 `.harness/progress.md`，git add 仅限 sprints/kernel-final-e 与 playground 交付物。
- INV-area（76 条 harness 过程学习）：N/A —— 均为链路自愈/证据窗口/毕业步过程铁律，与本 playground marker 端点无功能耦合，evaluator 侧按 area 全量生效。

## 禁 mock 边清单

（本单为纯新增 marker 端点 route handler，不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径；合同测试用 supertest 打真实 express app（`import app from '../server.js'`），无替身。无接缝边，N/A。）

## 真实调用方请求 shape

N/A —— 本端点无外部设备/agent 调用方（无 Android/Windows agent、无 webhook），为浏览器/curl 直接可访问的无参 marker 端点，无认证、无 body 字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，无 force_*/stub/假数据，N/A。）

---

## Golden Path

[playground 服务启动] → [客户端 GET /kernel-e] → [返回 200 + {result:"ok-e"}] →（harness 元层）[claude 全链自动实现 + PR 自动 merge + 终验绿]

### Step 1: playground 服务在 PLAYGROUND_PORT 监听
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点「playground 服务在 PLAYGROUND_PORT（默认 3000）监听」

**可观测行为**: `node playground/server.js` 启动后，端口进入 LISTEN，`GET /health` 返回 200 `{ok:true}`（就绪信号）。

**验证命令**:
```bash
PLAYGROUND_PORT=3910 node playground/server.js >/tmp/kernel-e-srv.log 2>&1 & SP=$!
for i in $(seq 1 40); do curl -sf localhost:3910/health >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf localhost:3910/health | jq -e '.ok == true' || { echo "FAIL: 服务未就绪"; kill $SP; exit 1; }
```
**硬阈值**: 10s 内 /health 返回 `{ok:true}`（就绪）。

---

### Step 2: 客户端 GET /kernel-e（无参）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点「客户端对 playground 发起 GET /kernel-e（无 query 参数）」

**可观测行为**: HTTP 200，Content-Type application/json。

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:3910/kernel-e)
[ "$CODE" = "200" ] || { echo "FAIL: 期望 200 实得 $CODE（新路由未注册=404）"; kill $SP; exit 1; }
```
**硬阈值**: HTTP 200（404 = 路由未注册 = FAIL，禁止 404-acceptable 旁路）。

---

### Step 3: 响应体含标记 ok-e（`{"result":"ok-e"}`）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 点「返回 HTTP 200，响应体含标记 ok-e，`{"result":"ok-e"}`」+ PRD 边界情况「携带任意多余 query 参数仍稳定返回 200 + ok-e」

**可观测行为**: 响应体 `.result == "ok-e"`，顶层 keys 恰为 `["result"]`，无禁用字段；带任意多余 query 参数行为不变。

**验证命令**:
```bash
R=$(curl -sf localhost:3910/kernel-e)
echo "$R" | jq -e '.result == "ok-e"'                 || { echo "FAIL: result 非 ok-e"; kill $SP; exit 1; }
echo "$R" | jq -e 'keys == ["result"]'                || { echo "FAIL: keys 非 [result]"; kill $SP; exit 1; }
echo "$R" | jq -e 'has("ok") or has("pong") or has("operation") | not' || { echo "FAIL: 禁用字段漏网"; kill $SP; exit 1; }
# 多余 query 参数稳定性
RQ=$(curl -sf "localhost:3910/kernel-e?foo=bar&x=1&value=zzz")
echo "$RQ" | jq -e '.result == "ok-e"' || { echo "FAIL: 带多余参数未稳定返回 ok-e"; kill $SP; exit 1; }
kill $SP 2>/dev/null
```
**硬阈值**: `.result == "ok-e"` 且 `keys == ["result"]` 且禁用字段全不存在 且多余 query 参数下仍 `.result=="ok-e"`。

---

### Step 4:（harness 元层）claude 全链无人工干预跑通并自动 merge，终验绿
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 点「claude 全链无人工干预跑通并自动 merge」

**可观测行为**: 本合同本身经 planner→proposer→generator→evaluator→merge 全链在零人工干预下收官，Brain harness run 记录为终验绿。

**说明（不作为 sprint 内 BEHAVIOR 断言 — 避免循环依赖）**: 此步骤是 harness 内核对自身的元验证——它由承载本合同的 harness run 执行并由 Brain harness run 记录裁决，**无法在本 sprint 的 E2E/BEHAVIOR 命令里自证**（sprint 命令无法断言"承载它的那次 merge 成功了"）。因此 Step 1–3 的端点行为是本 sprint 唯一可执行的功能验收面；Step 4 的达成信号是"本 PR 被 claude 全链自动 merge 且 Brain harness run=绿"，由 Kernel/Brain 侧观测，不进 contract-dod.md 的 BEHAVIOR。

---

## TDD Red 采集方式

`sprints/kernel-final-e/tests/kernel-e.test.js` 的 `import '../server.js'` 相对路径以 `playground/tests/` 为基准（vitest.config.js `include: ['tests/**']` 亦以 playground 为根）。因此 Red 证据在 playground 上下文采集，而非 sprints/ 下直跑（sprints/** 在 vitest include 范围外，绿态也 exit 1，属 INV-1 语义）：

```bash
cd playground
cp ../sprints/kernel-final-e/tests/kernel-e.test.js tests/kernel-e.test.js
npx vitest run tests/kernel-e.test.js --reporter=verbose   # 期望 exit 1，多条 FAIL（/kernel-e 未实现）
rm -f tests/kernel-e.test.js
```

**本轮实测 Red 证据**：`Tests 4 failed | 1 passed (5)`，`EXIT=1`（`/kernel-e` 未注册，GET 返回 404 → 4 条断言 FAIL）。generator 阶段实现 `app.get('/kernel-e', ...)` 后转绿。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 新增 `GET /kernel-e`，返回 200 + `{"result":"ok-e"}`；无参、忽略多余 query 参数 |
| **NFR（做得多好）** | 性能/可靠性 | 即时同步返回（无 IO），PRD 未指定超时/频控阈值 → 沿用 express 默认，无额外约束 |
| **Invariant（永不违反）** | 不变量 | 不改动任何现有端点（/ping /sum /multiply /divide /power /modulo /subtract /increment /decrement /factorial /abs /echo /sign）；顶层 keys 恒为 `["result"]` |
| **判定点（怎么知道）** | 对模糊现实的判断 | N/A（无接缝判定点，见下方登记表） |
| **保质期（何时过期）** | 何时失效 | marker 端点无过期语义，长期有效 |
| **死亡告警（停了谁知道）** | 告警手段 | 端点自身返回即可观测信号；全链失败落 Brain harness run 记录（PRD NFR 段） |
| **失败语义（挂了怎么办）** | 故障策略 | 服务未启动 → curl 连接失败属环境问题（非端点缺陷）；端点本身无失败分支（无 IO/无校验） |
| **效果确认（已发≠已生效）** | 回执确认 | curl GET /kernel-e 收 200 + `.result=="ok-e"` 即为生效回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |

（本任务无接缝判定点，N/A —— marker 端点为纯同步内存返回，不推断任何外部真实状态。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 | 是 | 客户端重试 |
| playground 服务未启动 | curl 连接失败（非 200） | 是（GET 幂等，无副作用） | 属环境问题，重启服务即可 |
| /kernel-e 内部 | 无失败分支（无 IO / 无参数校验） | 是（纯函数式返回常量） | N/A |

### 输入对抗面（对外暴露 agent 必填）

N/A —— 本端点非对外暴露 agent，无 LLM/prompt 处理，无用户可写入 pipeline；无参 marker 端点，忽略所有 query 输入，无 prompt injection / 越权面。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 5 分钟 / 8 动作（marker 端点面极小，缩小默认预算）
高风险面:
- 错输入: `GET /kernel-e?value=abc`、超长 query（`?x=` + 10000 字符）→ 仍应稳定 200 + `{"result":"ok-e"}`，不得 500
- 重复提交: 连续 20 次 `GET /kernel-e` → 每次均 200 + `{"result":"ok-e"}`，无状态漂移
- 中途中断: 请求进行中 kill 服务再重启 → 重启后端点恢复 200（无持久化状态）
- 边界值: 非 GET 方法（POST/PUT/DELETE /kernel-e）→ 404；大小写变体 `/KERNEL-E` → 404（Express 大小写敏感，属预期）
发现分级: P0/P1（返回非 200 / result 非 ok-e / 改动了现有端点行为）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑 — target_environment=playground）

**journey_type**: autonomous
**target_environment**: playground

```bash
#!/bin/bash
set -euo pipefail
PORT="${PLAYGROUND_PORT:-3920}"
SP=""
cleanup() { [ -z "$SP" ] || kill "$SP" 2>/dev/null || true; }
trap cleanup EXIT

# 1. 启动 playground（is_skeleton 训练 sprint，允许 node playground/server.js）
PLAYGROUND_PORT="$PORT" node playground/server.js >/tmp/kernel-e-e2e.log 2>&1 &
SP=$!
for i in $(seq 1 40); do
  curl -sf "localhost:$PORT/health" >/dev/null 2>&1 && break
  [ "$i" = 40 ] && { echo "FAIL: playground 10s 内未就绪"; exit 1; }
  sleep 0.25
done

# 2. GET /kernel-e 必须 200（404 = 路由未注册 = FAIL，禁止 404-acceptable）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/kernel-e")
[ "$CODE" = "200" ] || { echo "FAIL: GET /kernel-e 期望 200 实得 $CODE"; exit 1; }

# 3. 响应体 schema：result==ok-e + keys 完整性 + 禁用字段反向
#    注：先经 step 2 的 200 硬闸，再读 body（避免 curl -sf 在非 200 时得空串、jq -e 对空输入误判 exit 0 的假绿）
BODY=/tmp/kernel-e-body.json
curl -s -o "$BODY" "localhost:$PORT/kernel-e"
jq -e '.result == "ok-e"'  "$BODY" || { echo "FAIL: result 非 ok-e，实得 $(cat $BODY)"; exit 1; }
jq -e 'keys == ["result"]' "$BODY" || { echo "FAIL: keys 非 [result]，实得 $(cat $BODY)"; exit 1; }
jq -e 'has("ok") or has("pong") or has("msg") or has("operation") | not' "$BODY" || { echo "FAIL: 禁用字段漏网 $(cat $BODY)"; exit 1; }

# 4. 边界：多余 query 参数稳定返回 200 + ok-e（独立 200 硬闸）
QCODE=$(curl -s -o "$BODY" -w "%{http_code}" "localhost:$PORT/kernel-e?foo=bar&x=1&value=zzz")
[ "$QCODE" = "200" ] || { echo "FAIL: 带多余参数期望 200 实得 $QCODE"; exit 1; }
jq -e '.result == "ok-e"' "$BODY" || { echo "FAIL: 带多余参数未稳定返回 ok-e，实得 $(cat $BODY)"; exit 1; }

# 5. 非 GET 方法 → 404
PCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:$PORT/kernel-e")
[ "$PCODE" = "404" ] || { echo "FAIL: POST /kernel-e 期望 404 实得 $PCODE"; exit 1; }

# 6. 未回归：现有端点仍工作（抽查 /ping，独立 200 硬闸防空串假绿）
GCODE=$(curl -s -o "$BODY" -w "%{http_code}" "localhost:$PORT/ping")
[ "$GCODE" = "200" ] || { echo "FAIL: 现有端点 /ping 期望 200 实得 $GCODE"; exit 1; }
jq -e '.pong == true' "$BODY" || { echo "FAIL: 现有端点 /ping 回归，实得 $(cat $BODY)"; exit 1; }

echo "✅ kernel-e Golden Path 验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /kernel-e | `tests/kernel-e.test.js` | `GET /kernel-e → 200 + {result: "ok-e"}` / `带任意多余 query 参数 → 忽略参数仍 200 + {result: "ok-e"}` / `response keys 完整性 == ["result"]` / `禁用 key 反向` / `POST /kernel-e → 404` | 本轮实测 → 4 failed / 1 passed，exit 1 |
