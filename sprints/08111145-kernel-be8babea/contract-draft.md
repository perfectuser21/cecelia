# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 本任务不新增 HTTP API；发布验收读取既有静态资源与进程日志。`build-info.json.git_sha` 按既有 `scripts/check-deploy-fingerprint.sh` 约定解释，未知值不得判成功。

## 已知约束

- [apps/dashboard/e2e/pwa-upgrade.spec.ts] → `旧版 catch-all Service Worker 升级后保留 Workbench 深层路由`
- [apps/dashboard/e2e/pwa-upgrade.spec.ts] → `隐私存储受限时升级旧 Service Worker 仍保留 /workbench/tasks`
- [scripts/smoke/deploy-chain-wounds-smoke.sh] → `promote-dashboard.sh` 必须同步 HK、调用指纹校验且只重建 frontend。
- [packages/engine/tests/integration/release-deploy-stage.test.sh] → release/deploy 两阶段和产物库契约不得回退。
- [累积FR] context-manifest: unavailable（端点返回 Cannot GET；PRD 明示本 line 暂无历史）。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

发布者执行 `scripts/deploy.sh --dashboard-only` → 官方主链发布同一 Dashboard 产物到 US/HK → 双节点资源语义对账 → WebKit 私密新上下文深链稳定 → 入口日志保留 Referer。

### Step 1: CI 先证明分叉会失败
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步与「范围限定」要求先新增永久 failing CI 回归。

**可观测行为**: fixture 中 US 更新而 HK 同步/终验失败时，`deploy.sh --dashboard-only` 返回非零；当前基线因未进入 promote 主链而产生 Red。

**验证命令**:
```bash
npx vitest run sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts --reporter=verbose
```

**硬阈值**: 基线至少 1 个测试失败；实现后 2 个测试全绿，失败路径 exit code ≠ 0。上述 Vitest 命令直接判定。

### Step 2: Dashboard-only 进入唯一既有发布主链
**来源**: `[FROM_PRD]` — PRD「范围限定」要求修复 `scripts/deploy.sh --dashboard-only` 并复用 `promote-dashboard.sh` 的 HK rsync 与指纹能力。

**可观测行为**: build 成功后调用既有 promote 主链；promote 的任一非零退出原样使 deploy 失败，不能降级为 warning 或继续成功。

**验证命令**:
```bash
npx vitest run sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts --reporter=verbose
```

**硬阈值**: 成功 fixture 中 promote 恰好调用 1 次；失败 fixture 中 deploy exit code 非 0，且 stdout/stderr 含失败原因。

### Step 3: HK/US 四类资源同版
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步逐项要求 `build-info`、`index`、`sw.js`、deep route 一致。

**可观测行为**: evaluator 真实访问 PRD 冻结的 HK/US 生产节点；任一节点不可达、SHA 不等于真实 PR head、HTML 资产引用不同、service worker 语义不同或 deep route 不同即失败。

**验证命令**:
```bash
bash -c 'set -euo pipefail; : "${PR_HEAD_SHA:?}"; HK=http://100.86.118.99:5211; US=http://100.71.151.105:5211; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; for N in HK US; do eval U=\$$N; curl -fsS --max-time 15 "$U/build-info.json" > "$T/$N.build"; curl -fsS --max-time 15 "$U/" > "$T/$N.index"; curl -fsS --max-time 15 "$U/sw.js" > "$T/$N.sw"; curl -fsS --max-time 15 "$U/workbench/tasks" > "$T/$N.deep"; done; jq -e --arg sha "$PR_HEAD_SHA" '\''.git_sha==$sha'\'' "$T/HK.build"; jq -e --arg sha "$PR_HEAD_SHA" '\''.git_sha==$sha'\'' "$T/US.build"; cmp "$T/HK.build" "$T/US.build"; cmp "$T/HK.index" "$T/US.index"; cmp "$T/HK.sw" "$T/US.sw"; cmp "$T/HK.deep" "$T/US.deep"; ! grep -q '\''registerSW.js'\'' "$T/HK.index"; ! grep -q '\''navigator.serviceWorker.register'\'' "$T/HK.sw"'
```

**硬阈值**: 每个请求 ≤15s；四类响应逐字一致；两端 `git_sha == PR_HEAD_SHA`；新产物不得注册旧 PWA。命令任一断言失败即非零。

### Step 4: WebKit 私密新上下文保持深链
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步要求 Playwright WebKit 新 context 直达 HK、等待并刷新后 pathname 不变。

**可观测行为**: 全新 WebKit context 直接打开 HK `/workbench/tasks`，等待 10 秒、刷新、再等待 10 秒后路径均不跳回 `/`，且无 service worker 注册。

**验证命令**:
```bash
PR_HEAD_SHA="$PR_HEAD_SHA" npx playwright test sprints/08111145-kernel-be8babea/tests/hk-production-deeplink.spec.ts --project=webkit --reporter=line
```

**硬阈值**: 必须使用 WebKit；新 context；首次导航、10s 等待、刷新后共三次 pathname 均为 `/workbench/tasks`，总预算 60s。

### Step 5: 生产入口日志留存正确 Referer
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步要求发布后用真实入口日志确认 Referer。

**可观测行为**: 在本轮 WebKit 请求发生后的时间窗内，HK 入口容器日志含 `/workbench/tasks` 请求且 Referer 路径保持 `/workbench/tasks`；日志不得输出 cookie、token 或 PII。

**验证命令**:
```bash
bash -c 'set -euo pipefail; : "${E2E_STARTED_AT:?}"; ssh -o ConnectTimeout=10 hk-vps "docker logs --since '$E2E_STARTED_AT' cecelia-core-hk 2>&1" | tee "$SPRINT_DIR/hk-entry.log" | grep -E '\''/workbench/tasks.*[Rr]eferer[^ ]*(/workbench/tasks)|[Rr]eferer[^ ]*(/workbench/tasks).*/workbench/tasks'\''; ! grep -Ei '\''(cookie|authorization|token)='\'' "$SPRINT_DIR/hk-entry.log"'
```

**硬阈值**: SSH ≤10s 建连；日志只取 `E2E_STARTED_AT` 后的新记录；至少 1 条命中；敏感字段 0 条。

## 真实调用方请求 shape

- 浏览器真实调用方：`GET http://100.86.118.99:5211/workbench/tasks`，无业务认证 body，普通导航请求；刷新仍为同一 GET。
- 静态对账：`GET /build-info.json`、`GET /`、`GET /sw.js`、`GET /workbench/tasks`；不增加自定义认证字段或替代路径。
- 发布者真实入口：`bash scripts/deploy.sh --dashboard-only`；不得另建第三条发布命令。

## 禁 mock 边清单

- `scripts/deploy.sh --dashboard-only` ↔ `scripts/promote-dashboard.sh`（本单修复官方入口到既有双节点发布主链的生命周期接力；测试只能用可执行 fixture 替换远端副作用，不能只读源码断言）。
- `promote-dashboard.sh` ↔ HK rsync/`check-deploy-fingerprint.sh`（最终验收必须真访问 HK/US；不能 mock 被改的生产接缝）。
- WebKit ↔ HK 静态入口（必须真实 WebKit + 真实 HK URL，禁止 `page.route()`）。

## 接缝清单

- Dashboard-only 发布到 HK/US：真目标执行一次官方发布，任一同步/对账错误非零退出；验前状态为 `logic-done-pending`。
- HK/US 静态资源：真实访问两个 Tailscale IP 对账四类资源；验前状态为 `logic-done-pending`。
- WebKit/入口日志：真实 WebKit 新 context 后查 HK 容器时间窗日志；验前状态为 `logic-done-pending`。

## 未覆盖真实链路清单

（本合同最终验收无 mock 豁免，N/A；Vitest Red 使用隔离可执行 fixture 仅防止 CI 真部署，不替代 L3 生产验收。）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能需求 | Dashboard-only 官方发布必须同步并验收 HK/US，WebKit 深链保持。 |
| NFR（做得多好） | 性能/可靠性 | 静态请求单次 15s、WebKit 全程 60s；任何不可达或不一致 fail closed。 |
| Invariant（永不违反） | 不变量 | 不改 DNS/Tailscale/证书，不建第三份前端；发布错误不降级；凭据不入库/日志。 |
| 判定点（怎么知道） | 判断方法 | 见登记表。 |
| 保质期（何时过期） | 能力失效 | 每次发布重新以真实 PR head 与两端生产自报对账，不复用历史证据。 |
| 死亡告警（停了谁知道） | 告警 | 发布命令当场非零且既有指纹脚本 Bark 告警，发布者立即知道。 |
| 失败语义（挂了怎么办） | 故障策略 | fail closed；不把 HK 不可达、不一致、WebKit 缺失判成功。 |
| 效果确认（已发≠已生效） | 回执 | 两端四资源 + WebKit pathname + 新时间窗入口日志三层证据。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ HK/US 是否同一发布产物 | 只比 HTTP 200；比 SHA；比四类内容 | PR head SHA + build-info/index/sw/deep route 全对账 | PRD 明确要求且可防 SPA fallback 假绿 | 旧 PWA 继续直接面客 |
| ⚠️ 私密深链是否稳定 | Chromium；WebKit 单次；WebKit 等待+刷新 | WebKit 新 context，等待和刷新后三次断言 | Safari 问题需同内核复现 | Safari 用户被静默带回主页 |
| 入口 Referer 是否保持 | 浏览器变量；服务端日志 | WebKit 后时间窗内 HK 真实入口日志 | 服务端证据不可由页面自证 | 用户流末端证据误判 |

notes: judgment-pending-user: HK/US 是否同一发布产物；私密深链是否稳定（PRD 已指定所选方法，视为 PrepPRD 已拍板）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| HK rsync/对账失败 | deploy 非零退出并保留错误 | 再次运行同一 release deploy 可重试 | 无成功降级 |
| 任一真实 URL 不可达 | evaluator FAIL | 网络恢复后可重跑 | 无离线 fixture 替代 |
| WebKit 未安装或未执行 | evaluator FAIL | 安装依赖后可重跑 | Chromium 不替代 |
| Referer 日志缺失 | evaluator FAIL | 新 context 重新产生请求后重查 | 不用历史日志替代 |

### 输入对抗面

N/A — 不新增对外 agent 或用户可写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `deploy.sh --dashboard-only` 与互斥参数组合必须退出非零。
- 重复提交: 同一 release 重跑 deploy，不得产生 HK/US 不一致成功态。
- 中途中断: HK rsync 后、指纹检查前中断时，下次执行仍必须对账。
- 边界值: `build-info.git_sha` 缺失、`unknown`、SPA fallback HTML 均不得算一致。
发现分级: P0/P1（旧 PWA 直接面客、双节点分叉静默成功）阻塞 merge；P2/P3 记 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: mac_web

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PR_HEAD_SHA:?evaluator 必须注入真实 PR head SHA}"
: "${HARNESS_ATTEMPT_ID:?Runner 必须注入当前 evaluator attempt}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner 必须注入当前 capability snapshot}"
SPRINT_DIR="${SPRINT_DIR:-sprints/08111145-kernel-be8babea}"
HK=http://100.86.118.99:5211
US=http://100.71.151.105:5211
E2E_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export E2E_STARTED_AT SPRINT_DIR PR_HEAD_SHA
git fetch origin pull/${PR_NUMBER:?}/head
[ "$(git rev-parse FETCH_HEAD)" = "$PR_HEAD_SHA" ]
npx vitest run "$SPRINT_DIR/tests/dashboard-only-production-chain.test.ts" --reporter=verbose
bash scripts/smoke/deploy-chain-wounds-smoke.sh
npx playwright test apps/dashboard/e2e/pwa-upgrade.spec.ts --project=webkit --reporter=line
bash scripts/deploy.sh --dashboard-only
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
for N in HK US; do
  eval U=\$$N
  curl -fsS --max-time 15 "$U/build-info.json" > "$T/$N.build"
  curl -fsS --max-time 15 "$U/" > "$T/$N.index"
  curl -fsS --max-time 15 "$U/sw.js" > "$T/$N.sw"
  curl -fsS --max-time 15 "$U/workbench/tasks" > "$T/$N.deep"
done
jq -e --arg sha "$PR_HEAD_SHA" '.git_sha==$sha' "$T/HK.build"
jq -e --arg sha "$PR_HEAD_SHA" '.git_sha==$sha' "$T/US.build"
cmp "$T/HK.build" "$T/US.build"
cmp "$T/HK.index" "$T/US.index"
cmp "$T/HK.sw" "$T/US.sw"
cmp "$T/HK.deep" "$T/US.deep"
! grep -q 'registerSW.js' "$T/HK.index"
! grep -q 'navigator.serviceWorker.register' "$T/HK.sw"
npx playwright test "$SPRINT_DIR/tests/hk-production-deeplink.spec.ts" --project=webkit --reporter=line
ssh -o ConnectTimeout=10 hk-vps "docker logs --since '$E2E_STARTED_AT' cecelia-core-hk 2>&1" | tee "$SPRINT_DIR/hk-entry.log" | grep -E '/workbench/tasks.*[Rr]eferer[^ ]*(/workbench/tasks)|[Rr]eferer[^ ]*(/workbench/tasks).*/workbench/tasks'
! grep -Ei '(cookie|authorization|token)=' "$SPRINT_DIR/hk-entry.log"
node -e 'const fs=require("fs"),crypto=require("crypto"); const p=process.env.SPRINT_DIR+"/validation-provenance.json"; fs.writeFileSync(p,JSON.stringify({attempt_id:process.env.HARNESS_ATTEMPT_ID,provider:process.env.HARNESS_PROVIDER,account:process.env.HARNESS_ACCOUNT,machine:process.env.HARNESS_MACHINE,model:process.env.HARNESS_MODEL,runner_digest:process.env.HARNESS_RUNNER_DIGEST,capability_snapshot_id:process.env.CAPABILITY_SNAPSHOT_ID,pr_head_sha:process.env.PR_HEAD_SHA,evidence_sha256:crypto.createHash("sha256").update(fs.readFileSync(process.env.SPRINT_DIR+"/hk-entry.log")).digest("hex")},null,2))'
```

## staging 预览闸

- 步骤 A：仅引用现有 `bash scripts/deploy-local.sh` 将候选版本落到 Cecelia staging `http://localhost:5212`，不得重造部署逻辑。
- 步骤 B：在 staging 运行同一 WebKit 深链剧本，截图写入 `${SPRINT_DIR}/screenshots/staging-workbench-tasks.png`。
- 步骤 C：用 `$BARK_URL` 发送 staging 链接与截图 URL，文案包含“24h 无异议自动放行”；随后 PATCH Brain task metadata：`staging_deployed:true`、`promote_after:<UTC+24h>`、`staging_url:http://localhost:5212/workbench/tasks`。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 官方主链接力 | `tests/dashboard-only-production-chain.test.ts` | `Dashboard-only 成功路径必须调用既有双节点 promote 主链` | 当前 deploy 仅 rebuild，不调用 promote，expect 失败 |
| 失败传播 | `tests/dashboard-only-production-chain.test.ts` | `HK 同步或终验失败必须让 Dashboard-only 发布非零退出` | 当前 deploy 忽略 promote，错误 exit 0 |
| 生产深链 | `tests/hk-production-deeplink.spec.ts` | `HK 生产入口 WebKit 私密新上下文等待刷新后保持 /workbench/tasks` | 仅 evaluator 在真实生产 PR head 上执行 |

