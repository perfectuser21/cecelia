---
skeleton: false
journey_type: user_facing
---
# Contract DoD — HK/US Dashboard 单一发布主链

## ARTIFACT 条目

- [ ] [ARTIFACT] 永久 Vitest 回归测试存在且使用 `describe/it/expect`
  Test: node -e "const s=require('fs').readFileSync('sprints/08111132-kernel-7c779331/tests/deploy-dashboard-dual-node.test.ts','utf8');if(!['describe','it','expect'].every(x=>s.includes(x)))process.exit(1)"
- [ ] [ARTIFACT] 官方 deploy 主链与现有 promote/fingerprint 脚本复用，不新增第三份前端
  Test: node -e "const s=require('fs').readFileSync('scripts/deploy.sh','utf8');if(!s.includes('promote-dashboard.sh'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: dashboard-only 调用唯一发布主链并传播失败
  动作: 在隔离 fixture 中执行 `scripts/deploy.sh --dashboard-only`，令既有 promote 子链返回非零
  预期观察: 顶层 deploy 非零，不能以本地 rebuild 成功代替双节点发布
  等待预算: 30s
  留证: Vitest stdout、exit_code 与 PR head SHA
  Test: manual:bash -c 'npx vitest run sprints/08111132-kernel-7c779331/tests/deploy-dashboard-dual-node.test.ts -t "dashboard-only 调用唯一发布主链并传播失败"'

- [ ] [BEHAVIOR] [L2] B-02: HK 同步失败时顶层发布非零且不静默成功
  动作: 在隔离 fixture 中令 HK 同步路径失败并执行 dashboard-only 主链
  预期观察: 顶层退出非零，日志含 HK 失败且无最终成功标志
  等待预算: 30s
  留证: Vitest stdout 与子进程 stderr/stdout
  Test: manual:bash -c 'npx vitest run sprints/08111132-kernel-7c779331/tests/deploy-dashboard-dual-node.test.ts -t "HK 同步失败时顶层发布非零且不静默成功"'

- [ ] [BEHAVIOR] [L3] B-03: HK/US 同一 PR head 且 PWA 状态一致 [接缝×2]
  动作: 从 evaluator 的真实 PR head 分别读取 HK/US build-info、index、sw.js 与深链
  预期观察: 两端 SHA 等于 PR head、index 资产一致、不注册旧 PWA、深链返回 Dashboard
  等待预算: 60s
  留证: 两端响应 body 哈希与 HTTP 状态，写入 behavior evidence
  Test: manual:bash -c ': "${PR_HEAD_SHA:?}"; H=http://100.86.118.99:5211; U=http://100.71.151.105:5211; for X in "$H" "$U"; do curl -fsS --max-time 15 "$X/build-info.json" | jq -e --arg s "$PR_HEAD_SHA" ".git_sha==\$s"; curl -fsS --max-time 15 "$X/" | grep -vq "/registerSW.js"; curl -fsS --max-time 15 "$X/workbench/tasks" | grep -q "<div id=\"root\""; done'

- [ ] [BEHAVIOR] [L3] B-04: WebKit 新 context 等待与刷新保持深链 [接缝×2]
  动作: Playwright WebKit 新 context 直达 HK `/workbench/tasks`，等待 10 秒并刷新
  预期观察: 三个观测点 pathname 均为 `/workbench/tasks`
  等待预算: 45s
  留证: `${SPRINT_DIR}/screenshots/hk-workbench-wait.png` 与 `hk-workbench-refresh.png`
  Test: manual:bash -c 'node --input-type=module -e "import{webkit}from '\''playwright'\'';const b=await webkit.launch();const c=await b.newContext();const p=await c.newPage();await p.goto('\''http://100.86.118.99:5211/workbench/tasks'\'',{waitUntil:'\''networkidle'\'',timeout:30000});if(new URL(p.url()).pathname!=='\''/workbench/tasks'\'')process.exit(1);await p.waitForTimeout(10000);if(new URL(p.url()).pathname!=='\''/workbench/tasks'\'')process.exit(1);await p.reload({waitUntil:'\''networkidle'\''});if(new URL(p.url()).pathname!=='\''/workbench/tasks'\'')process.exit(1);await b.close()"'

- [ ] [BEHAVIOR] [L3] B-05: 真实入口日志保留深链 Referer
  动作: WebKit 验收后执行只读入口日志查询，范围限定 `$E2E_STARTED_AT` 后
  预期观察: 至少一条本轮日志 Referer 含 `/workbench/tasks`
  等待预算: 30s
  留证: `/tmp/hk-referer-evidence.log`
  Test: manual:bash -c ': "${HK_ACCESS_LOG_COMMAND:?}"; : "${E2E_STARTED_AT:?}"; O=$(eval "$HK_ACCESS_LOG_COMMAND"); printf "%s\n" "$O" | tee /tmp/hk-referer-evidence.log | grep -F "/workbench/tasks"'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 部署失败不得 warning 降级，覆盖本 sprint 触及的部署铁律
  动作: 运行 HK 失败回归场景
  预期观察: exit_code 非零且失败证据位于 judge 前八条证据内
  等待预算: 30s
  留证: Vitest 输出与 Red→Green commit 顺序
  Test: manual:bash -c 'npx vitest run sprints/08111132-kernel-7c779331/tests/deploy-dashboard-dual-node.test.ts -t "HK 同步失败时顶层发布非零且不静默成功"'

其余 PRD 铁律 N/A：本 sprint 不触及 DB、租户、API 鉴权、agent、调度状态机、通知语义或 canonical 文件；凭据/日志铁律由 E2E 只接受只读命令且不输出 secret 遵守。

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] WebKit 真实生产深链截图已保存至 `${SPRINT_DIR}/screenshots/`
  Screenshots: `hk-workbench-wait.png`、`hk-workbench-refresh.png`、`staging-workbench-tasks.png`

