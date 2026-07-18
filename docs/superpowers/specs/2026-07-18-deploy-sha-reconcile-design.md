# Design: Dashboard 部署判变改生产自报 SHA 对账 + promote 终验 fatal 化

日期：2026-07-18 ｜ 任务：1e5bc3e4 ｜ Issue：89079934 ｜ 分支：cp-0718114217-deploy-sha-reconcile

## 问题

专用部署根（cecelia-deploy-main）每次部署先 `reset --hard origin/main`，之后 `git diff origin/main...HEAD` 恒空 → dashboard 改动永远判"无改动"跳过（PR #4022/#4038 合并后 07-17 两次部署日志实证）。Brain 有生产 git_sha 对账兜底（`deploy-local.sh:78-96`），dashboard 没有。叠加 `promote-dashboard.sh` 的 HK 同步与指纹终验失败全降级 warning，全链静默失败：指挥舱合并三天用户刷不出来、零告警。

## 方案（与 Brain SHA 对账同构：生产实体自报，不依赖账本文件）

`.production-release` 账本实测不存在（promote 07-14 跑过但账本没落盘），弃用账本基准，改为问真容器。

### 组件 1：build-info.json（产物自报身份）

- `apps/dashboard/vite.config.ts` 内联插件：`generateBundle` 钩子 `this.emitFile({type:'asset', fileName:'build-info.json', source: JSON.stringify({git_sha, built_at})})`——emitFile 自动跟随 `--outDir`（deploy-local 用 `--outDir .dist-staging`，写死 dist/ 的方案不可行）。
- sha 来源：`process.env.GIT_SHA` 优先，`execSync('git rev-parse HEAD')` 兜底（try/catch，都拿不到写 `unknown`）。
- `deploy-local.sh` 的 docker 容器构建路径（node:20-alpine 无 git）必须加 `-e GIT_SHA=$(git -C "$MAIN_ROOT" rev-parse HEAD)`。
- 不放 `public/`（部署根会多未跟踪文件且生成时机错）。
- PWA 无冲突已核实：workbox globPatterns 不含 json，navigateFallback=null，且判变 curl 是服务端行为不过 SW。

### 组件 2：deploy-local.sh 判变对账

- **位置**：部署根守卫块之后、NEED_* 判断之前（守卫 fetch 后 origin/main 才新鲜）。
- **顺手修现存时序 bug**：Brain SHA 对账（79 行 rev-parse origin/main）现在跑在守卫 fetch 之前，用旧引用可能误判一致——把守卫 fetch 提前或 Brain 对账一起挪到守卫后，一个脚本一套时序。
- **逻辑**：
  1. `DASH_PROD_SHA="${CECELIA_PROD_DASHBOARD_SHA:-}"`；为空且非测试模式 → `curl -sf --max-time 5 http://localhost:5211/build-info.json` + `node -e` 解析（禁 jq，照抄 84 行写法）。注意：文件不存在时 SPA fallback 返 **200+HTML 而非 404**（frontend-proxy.js 实证），`-f` 抓不住，靠 JSON 解析失败兜底。
  2. 拿到 sha → `git -C "$MAIN_ROOT" cat-file -e <sha>^{commit}` 校验存在（短 sha 先 rev-parse 展开）→ `git -C "$MAIN_ROOT" diff --name-only <sha>..origin/main -- apps/dashboard apps/api` 非空 → `DASHBOARD_SHA_MISMATCH=true` → NEED_DASHBOARD=true。
  3. **保守触发（仅真实模式）**：curl 失败 / 解析失败 / sha 不在历史 → NEED_DASHBOARD=true + 警告日志（宁多建不静默跳）。
  4. **测试模式**：`CECELIA_DEPLOY_ROOT` 已设且 `CECELIA_PROD_DASHBOARD_SHA` 未设 → 跳过对账（对齐 Brain PROD_SHA 空时"跳过对账"行为；CI 无 5211，无此规则所有 smoke 场景行为都会变）。禁复用 `CECELIA_PROD_GIT_SHA`（其语义=Brain sha，会连带 NEED_BRAIN 在 fixture 根炸 brain-deploy.sh）。
  5. changed_paths（--changed / webhook）保留为并集判据；"无改动即 exit 0"（168 行）条件叠加 `DASHBOARD_SHA_MISMATCH`（同 165 行 Brain 模式）。
- **去重闸防风暴**（刀2 完成前保守构建会成常态）：`.staging-pending` 已存在且其 `commit` == `git -C "$MAIN_ROOT" rev-parse --short origin/main` → 跳过重建、不杀 staging slot、不重发 Bark，日志说明"staging 已就绪等放行"。

### 组件 3：promote-dashboard.sh fatal 化（改现有代码，不写平行逻辑）

现实代码**已有** HK rsync（206-214 行，`CECELIA_SKIP_HK` 钩子）与指纹终验（217-222 行调 `check-deploy-fingerprint.sh`，含 Bark），只是失败均 warning。改造：

- 失败路径 warning → 显式 `FAIL_FLAG`（脚本 `set -uo` 无 `-e`）+ Bark + 脚本尾部统一 `exit 1`。HK 失败**不回滚本机**（本机已原子换入成功）——退出码语义"本机已上线但对账红"写进头注释。
- rsync 补 `-e 'ssh -o ConnectTimeout=10'`（现无超时，Tailscale 断链会挂死）。
- `check-deploy-fingerprint.sh` 扩展：优先比 `build-info.json` 的 git_sha（本机 5211 vs HK `http://100.86.118.99:5211` vs 期望产物），拿不到退回现有 index hash 对比。红报文区分三种病因："取不到" / "sha 不等（分家：容器挂载 ≠ 部署根）" / "inode 陈旧（mv 换目录后容器持旧 inode）"。
- 清理 pending/slot 移到 HK 同步**之前**（终验红时 staging 已收尾，退出码干净）。
- 修 13 行过时头注释（"不同步 HK"与现实不符）。
- **刻意设计**：刀2（容器重建对齐部署根）前终验必红——静默失败变响亮失败。

### 组件 4：测试接缝（同 PR，防打红存量）

- `packages/engine/tests/integration/release-deploy-stage.test.sh` 的 `run()` 补 `CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1`（CI ubuntu rsync hk-vps 必失败，今天靠 warning 放过，fatal 化后必红）。
- `scripts/smoke/dashboard-staging-gate-smoke.sh` 场景 [B] 补 `CECELIA_SKIP_FINGERPRINT=1`。
- fixture（`STAGING_FIXTURE_DIST` 路径跳过真 build）补假 `build-info.json`。
- `dashboard-staging-selfcheck.sh` 增加断言：staging 产物含 `build-info.json` 且 git_sha 非空（真实构建路径的生成守卫）。

## 数据流

```
merge → Gate3 webhook → deploy-local.sh（部署根守卫 fetch/reset）
  → Brain 对账: health.git_sha vs origin/main（挪到守卫后）
  → Dashboard 对账: curl 5211/build-info.json 自报 sha vs origin/main -- apps/dashboard apps/api
  → NEED_DASHBOARD → build（产物烙 build-info.json）→ staging 自检 → Bark 等放行
  → 人工 promote → 原子换入本机 → HK rsync（fatal）→ 终验 sha 对账（fatal）→ exit 0/1
```

## 错误路径表

| 依赖 | 失败场景 | 行为 |
|---|---|---|
| curl 5211/build-info.json | SPA fallback 200+HTML（非 404）| JSON 解析失败 → 保守构建 |
| curl 5211 | 容器未起/超时 | 保守构建（真实模式）/ 跳过（测试模式）|
| 自报 sha | 不在 git 历史 | cat-file 校验失败 → 保守构建 |
| vite 插件 GIT_SHA | alpine 容器无 git | docker run -e GIT_SHA 传入，env 优先 |
| rsync hk-vps | Tailscale 断链 | ConnectTimeout=10 → FAIL_FLAG+Bark+exit 1，不回滚本机 |
| HK 终验 | HK 5211 不可达 | FAIL 报红，报文"取不到" |
| 本机终验（刀2 前）| 分家/inode 陈旧 | 必红 by design，报文区分病因 |
| Bark | 无 token/网络失败 | warning 不阻塞（照抄 317-329 行）|
| 保守构建风暴 | 刀2 前每次 webhook 触发 | 去重闸：pending.commit==origin/main → 跳过 |

## 测试策略（四档）

- **E2E**（不进 CI，merge 后人工 proven-to-fire）：真实部署根注入旧 sha → 亲见判变触发；伪造 sha 不一致 → 亲见终验报红+Bark。
- **Integration**（CI，核心）：新增 `scripts/smoke/dashboard-sha-reconcile-smoke.sh`（`*-smoke.sh` 命名自动进 ci.yml 394 行 glob job，**勿动 ci.yml**）。正向：隔离 fixture 仓 2 commit（第 2 个只改 `apps/dashboard/x`），`CECELIA_PROD_DASHBOARD_SHA=<commit1>` + `--dry-run` + 无 `--changed` → 断言输出含 Dashboard 构建行，**修复前必红**（现输出"跳过：没有…改动"）。反向：sha == origin/main → 断言跳过。fixture 仓不配 origin 时按 65-69 行模式回退本地 main。存量 release-deploy-stage / gate-smoke 保持绿。
- **Unit**：无独立单测（bash 判变逻辑由 integration smoke 直接覆盖；vite 插件产物由 selfcheck 断言覆盖）。
- **Trivial**：头注释修正、日志文案——不测。

TDD commit 顺序：commit-1 = failing smoke（红）；commit-2 = 实现（绿）。

## 不做（Scope 外）

- 刀2：cecelia-frontend 容器从 deploy-main 重建 + mount inode 处理（restart 或 rsync 原地覆盖）——本 PR 合并后立刻做（用户已拍板 A），终验红即其暴露面。
- 刀3：正规 release→promote 收账 + 清 5223 旧 staging。
- deploy-local 并发锁（双 webhook 互杀 staging slot）——现存问题，本 PR 不恶化不修。
