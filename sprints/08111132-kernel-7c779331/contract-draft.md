# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 本任务不新增 HTTP API；生产响应真相为静态 `build-info.json`、`index.html`、`sw.js`、深链 pathname 与入口日志 Referer。

## 已知约束（来自回归测试与累积 FR）

- `packages/engine/tests/integration/release-deploy-stage.test.sh` → release/deploy 两阶段末态一致、部署失败非零、Dashboard promote 不重启 Brain。
- `scripts/smoke/deploy-chain-wounds-smoke.sh` → HK rsync、部署指纹校验与 frontend 独立重绑必须保留。
- [累积FR] 本 line 暂无历史；context-manifest 本轮未返回可用正文。
- 铁律适用摘要：部署失败不得 warning 降级；PR head/生产 build-info 是判变真相；凭据不得入库或日志；真实生产接缝只有真目标验过才算 done；测试必须 Vitest 且先红后绿。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | `scripts/deploy.sh --dashboard-only` 经唯一官方主链把同一 PR head 产物发布并核验到 US 与 HK。 |
| NFR | HK/US 请求各 15 秒超时；WebKit 等待 10 秒并刷新；任一失败整次非零。 |
| Invariant | 不改 DNS/Tailscale/证书、不建第三份前端、不重启 Brain；两节点不得分叉或静默降级。 |
| 判定点 | 见下表。 |
| 保质期 | build-info SHA 对应当前 PR head；下一次正式发布替换。 |
| 死亡告警 | deploy 非零并保留节点/指纹输出；现有 Bark 指纹告警继续生效。 |
| 失败语义 | fail-closed；HK 同步、任一指纹或真实验收失败均非零，无成功文案。 |
| 效果确认 | 双节点内容对账、WebKit 深链与入口日志 Referer 三类独立回执。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 两节点是否同一 PR 产物 | 文件存在；build-info SHA + index 内容 | SHA 等于 PR_HEAD 且 index 资产引用一致 | PRD 要求核对真实 PR head | 旧 HK 静默面客 |
| ⚠️ Safari 私密深链是否稳定 | curl；WebKit 新 context | WebKit 首次、等待、刷新三次 pathname | 最接近 Safari 引擎与冷 context | 用户被送回主页 |
| 旧 PWA 是否退出控制 | 只查 sw.js；联合 index/registerSW/sw.js | 两节点三项联合断言 | 单查文件可能命中 SPA fallback | 旧 SW 继续导航 |

notes: judgment-pending-user: 两节点是否同一 PR 产物；Safari 私密深链是否稳定。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| HK rsync 不可达 | deploy 非零，禁止成功文案 | 是，同一产物可重跑 | 无 |
| HK/US 指纹或 PWA 不一致 | deploy 非零并输出两端证据 | 是 | 无 |
| WebKit/真实节点不可用 | evaluator FAIL | 可重跑验收 | 无 |

### 输入对抗面

N/A — 不新增对外 agent 或用户写入接口。

## 真实调用方请求 shape

生产浏览器无业务鉴权；请求为 `GET /workbench/tasks`，Host 指向 HK 入口，刷新仍为相同 path；静态核验请求为 `GET /build-info.json`、`GET /`、`GET /sw.js`。不得用 body/header 另造发布身份路径。

## 禁 mock 边清单

- `scripts/deploy.sh --dashboard-only` ↔ `scripts/promote-dashboard.sh`（本单修改官方发布接力，回归测试必须真实起子 shell，不得 mock 被调脚本的退出码）。
- `scripts/promote-dashboard.sh` ↔ HK rsync/`check-deploy-fingerprint.sh`（失败传播必须通过真实 fixture 可执行程序验证，不得函数 stub）。
- evaluator ↔ HK/US HTTP/WebKit（最终验收不得 route/mock/本地替身）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

覆盖父路 `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6` 第 1-5 步。

[真实 PR head] → [官方 dashboard-only 主链] → [US/HK 同步且 fail-closed] → [双节点与 PWA 对账] → [WebKit 深链稳定] → [日志 Referer 证据]

### Step 1: 从真实 PR head 触发唯一发布主链
**来源**: `[FROM_PRD]` — Golden Path 第 1 步。

**可观测行为**: `scripts/deploy.sh --dashboard-only` 不再只执行本地 rebuild；它进入既有 Dashboard promote 主链，且传递失败退出码。

**验证命令**: `npx vitest run sprints/08111132-kernel-7c779331/tests/deploy-dashboard-dual-node.test.ts -t 'dashboard-only 调用唯一发布主链并传播失败'`

**硬阈值**: 测试 exit 0；缺主链接线或子链失败却返回 0 必须 FAIL。

### Step 2: US 发布并同步 HK，任一失败阻断成功
**来源**: `[FROM_PRD]` — Golden Path 第 2 步与边界情况。

**可观测行为**: 同一产物送达两节点；HK rsync 或指纹校验失败时顶层 deploy 非零，输出失败节点。

**验证命令**: `npx vitest run sprints/08111132-kernel-7c779331/tests/deploy-dashboard-dual-node.test.ts -t 'HK 同步失败时顶层发布非零且不静默成功'`

**硬阈值**: exit 非零且日志含 HK/FAIL；不得出现最终 deployed 成功行。

### Step 3: 对账 HK/US 的 SHA、index、sw.js 与深链响应
**来源**: `[FROM_PRD]` — Golden Path 第 3 步。

**可观测行为**: 两端 `build-info.git_sha` 均等于 `$PR_HEAD_SHA`，index 内容哈希一致且不注册 PWA，`sw.js` 状态一致，深链返回可启动 Dashboard 的 HTML。

**验证命令**: `bash -c ': "${PR_HEAD_SHA:?}"; for U in http://100.86.118.99:5211 http://100.71.151.105:5211; do curl -fsS --max-time 15 "$U/build-info.json" | jq -e --arg s "$PR_HEAD_SHA" ".git_sha==\$s"; curl -fsS --max-time 15 "$U/workbench/tasks" | grep -q "<div id=\"root\""; curl -fsS --max-time 15 "$U/" | grep -vq "/registerSW.js"; C=$(curl -sS -o /tmp/sw.$$ -w "%{http_code}" --max-time 15 "$U/sw.js"); [ "$C" = 404 ] || ! grep -q "service-worker" /tmp/sw.$$; done'`

**硬阈值**: 两节点全部在 15 秒内响应；SHA 精确等于 PR head；任一差异非零。

### Step 4: WebKit 新 context 深链等待与刷新不跳转 [接缝×2]
**来源**: `[FROM_PRD]` — Golden Path 第 4 步。

**可观测行为**: WebKit 新 context 直达 HK `/workbench/tasks`，等待 10 秒及 reload 后 pathname 始终相同。

**验证命令**: 见 E2E 脚本的 Playwright WebKit 段。

**硬阈值**: browserName=`webkit`；初次、等待、刷新 pathname 均严格为 `/workbench/tasks`。

### Step 5: 真实入口日志保留深链 Referer
**来源**: `[FROM_PRD]` — Golden Path 第 5 步。

**可观测行为**: 本轮 WebKit 请求后 HK 入口日志的新时间窗记录含 `/workbench/tasks` Referer。

**验证命令**: `bash -c ': "${HK_ACCESS_LOG_COMMAND:?}"; OUT=$(eval "$HK_ACCESS_LOG_COMMAND"); printf "%s\n" "$OUT" | grep -F "/workbench/tasks"'`

**硬阈值**: 日志查询必须限定 `$E2E_STARTED_AT` 之后且至少一行 Referer 含 `/workbench/tasks`；空日志 FAIL。

## 接缝清单

- HK rsync 与静态容器目录：真实发布必须同步成功并由外部 HTTP 再读验证；未真验为 `logic-done-pending`。
- HK/US 生产 HTTP：两 IP 均须可达且对账；无法访问直接 FAIL。
- Safari/WebKit 与真实入口日志：新 context、等待、刷新及时间窗日志须真跑；未跑 WebKit 直接 FAIL。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `scripts/deploy.sh --dashboard-only --unknown` 必须非零。
- 重复提交: 同一 PR head 连续发布两次不得产生不同 build-info。
- 中途中断: HK rsync 中断后重跑必须收敛且首次不得成功。
- 边界值: `/workbench/tasks?x=1#top` 刷新后 pathname 仍为深链。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: mac_web

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PR_HEAD_SHA:?真实 PR head SHA 必须由 evaluator 注入}"
: "${HK_ACCESS_LOG_COMMAND:?必须注入只读且限定 E2E_STARTED_AT 后的 HK 入口日志查询命令}"
export HARNESS_ATTEMPT_ID="${HARNESS_ATTEMPT_ID:?}"
export CAPABILITY_SNAPSHOT_ID="${CAPABILITY_SNAPSHOT_ID:?}"
SPRINT_DIR="sprints/08111132-kernel-7c779331"
mkdir -p "$SPRINT_DIR/screenshots"
E2E_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ); export E2E_STARTED_AT
[ "$(git rev-parse HEAD)" = "$PR_HEAD_SHA" ]
npx vitest run "$SPRINT_DIR/tests/deploy-dashboard-dual-node.test.ts"
bash scripts/smoke/deploy-chain-wounds-smoke.sh
HK=http://100.86.118.99:5211; US=http://100.71.151.105:5211
for U in "$HK" "$US"; do
  curl -fsS --max-time 15 "$U/build-info.json" | tee "/tmp/build-$(echo "$U" | tr -cd 0-9).json" | jq -e --arg s "$PR_HEAD_SHA" '.git_sha==$s'
  curl -fsS --max-time 15 "$U/" > "/tmp/index-$(echo "$U" | tr -cd 0-9).html"
  curl -fsS --max-time 15 "$U/workbench/tasks" | grep -q '<div id="root"'
  grep -vq '/registerSW.js' "/tmp/index-$(echo "$U" | tr -cd 0-9).html"
done
cmp /tmp/build-10086118995211.json /tmp/build-100711511055211.json
node --input-type=module - <<'NODE'
import { webkit } from 'playwright';
const browser = await webkit.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('http://100.86.118.99:5211/workbench/tasks', { waitUntil: 'networkidle', timeout: 30000 });
if (new URL(page.url()).pathname !== '/workbench/tasks') throw new Error('首次深链 pathname 漂移');
await page.waitForTimeout(10000);
if (new URL(page.url()).pathname !== '/workbench/tasks') throw new Error('等待后 pathname 漂移');
await page.screenshot({path:'sprints/08111132-kernel-7c779331/screenshots/hk-workbench-wait.png'});
await page.reload({waitUntil:'networkidle', timeout:30000});
if (new URL(page.url()).pathname !== '/workbench/tasks') throw new Error('刷新后 pathname 漂移');
await page.screenshot({path:'sprints/08111132-kernel-7c779331/screenshots/hk-workbench-refresh.png'});
await browser.close();
NODE
LOG_OUT=$(eval "$HK_ACCESS_LOG_COMMAND")
printf '%s\n' "$LOG_OUT" | tee /tmp/hk-referer-evidence.log | grep -F '/workbench/tasks'
```

## staging 预览闸

- 步骤 A：仅引用现有 Cecelia staging 发布链落到 `localhost:5212`，不得新建部署脚本。
- 步骤 B：Final E2E 在 staging 先跑并将截图写入 `${SPRINT_DIR}/screenshots/staging-workbench-tasks.png`；生产两节点验收仍不可省略。
- 步骤 C：通过 `$BARK_URL` 发送 staging 链接与截图，注明“24h 无异议自动放行”，并 PATCH Brain task metadata 写入 `staging_deployed:true`、UTC+24h `promote_after` 与 `staging_url`。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Dashboard 双节点发布主链 | `sprints/08111132-kernel-7c779331/tests/deploy-dashboard-dual-node.test.ts` | dashboard-only 调用唯一发布主链并传播失败；HK 同步失败时顶层发布非零且不静默成功 | 当前 deploy.sh 仅调用 rebuild-dashboard.sh，断言失败 |

