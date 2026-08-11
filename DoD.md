contract_branch: cp-harness-propose-r1-be8babea-r88f76b1d-a4
sprint_dir: sprints/08111145-kernel-be8babea

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Dashboard HK/US 官方发布主链

**范围**: `scripts/deploy.sh --dashboard-only` 复用既有 promote、双节点指纹与真实 WebKit/日志验收。
**大小**: M

gate-allow: env-missing Playwright WebKit 在 PRD 指定的 mac_web evaluator 上运行；docker 命令经 ssh 在 HK 生产节点执行，不要求合同起草容器本地具备。

## ARTIFACT 条目

- [x] [ARTIFACT] 永久 Vitest CI 回归存在且使用 `describe/it/expect`，覆盖成功接力与失败传播
  Test: node -e "const c=require('fs').readFileSync('sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts','utf8');if(!c.includes('describe(')||!c.includes('it(')||!c.includes('expect('))process.exit(1)"
- [x] [ARTIFACT] `scripts/deploy.sh` 是唯一修改的官方入口，复用既有 `promote-dashboard.sh`，不新增第三份前端
  Test: git diff --name-only origin/main...HEAD | grep -E '^(scripts/deploy.sh|packages/quality/|sprints/08111145-kernel-be8babea/)' >/dev/null

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] B-01: Dashboard-only 成功路径必须调用既有双节点 promote 主链
  动作: 在隔离 fixture 执行 `scripts/deploy.sh --dashboard-only --skip-smoke`
  预期观察: rebuild 成功后 promote 恰好调用一次，发布命令退出 0
  等待预算: 10s
  留证: Vitest verbose 输出中的成功用例与调用次数
  Test: manual:bash -c 'npx vitest run sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts -t "Dashboard-only 成功路径必须调用既有双节点 promote 主链" --reporter=verbose'

- [x] [BEHAVIOR] [L2] B-02: HK 同步或终验失败必须让 Dashboard-only 发布非零退出
  动作: 在隔离 fixture 令 promote 主链返回 23，再执行 Dashboard-only 发布
  预期观察: deploy 返回非零并显示发布失败，不能静默成功
  等待预算: 10s
  留证: Vitest verbose 输出中的 exit code 与错误输出断言
  Test: manual:bash -c 'npx vitest run sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts -t "HK 同步或终验失败必须让 Dashboard-only 发布非零退出" --reporter=verbose'

- [x] [BEHAVIOR] [L3] B-03: HK 与 US 四类生产资源等于真实 PR head [接缝×2]
  动作: 发布后分别请求 HK/US 的 build-info、index、sw.js 与 `/workbench/tasks`
  预期观察: 两端均可达、SHA 等于 PR head、四类响应一致且无旧 PWA 注册
  等待预算: 120s
  留证: `${SPRINT_DIR}/hk-us-fingerprint.log` 与四类响应 SHA-256
  Test: evaluator:bash -c ': "${PR_HEAD_SHA:?}"; HK=http://100.86.118.99:5211; US=http://100.71.151.105:5211; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; for N in HK US; do eval U=\$$N; for P in build-info.json index.html sw.js workbench/tasks; do curl -fsS --max-time 15 "$U/${P#index.html}" > "$T/$N.${P//\//_}"; done; done; jq -e --arg s "$PR_HEAD_SHA" '\''.git_sha==$s'\'' "$T/HK.build-info.json"; jq -e --arg s "$PR_HEAD_SHA" '\''.git_sha==$s'\'' "$T/US.build-info.json"; for P in build-info.json index.html sw.js workbench_tasks; do cmp "$T/HK.$P" "$T/US.$P"; done; ! grep -q registerSW.js "$T/HK.index.html"; ! grep -q navigator.serviceWorker.register "$T/HK.sw.js"'

- [x] [BEHAVIOR] [L3] B-04: HK 生产入口 WebKit 私密新上下文等待刷新后保持 /workbench/tasks [接缝×2]
  动作: 用 Playwright WebKit 新 context 直达 HK 深链，等待 10 秒并刷新再等 10 秒
  预期观察: 三次 pathname 都是 `/workbench/tasks` 且 service worker 注册数为 0
  等待预算: 60s
  留证: `${SPRINT_DIR}/screenshots/hk-workbench-tasks.png` 与 Playwright line report
  Test: evaluator:bash -c 'npx playwright test sprints/08111145-kernel-be8babea/tests/hk-production-deeplink.spec.ts --project=webkit --reporter=line'

- [x] [BEHAVIOR] [L3] B-05: 本轮真实入口日志 Referer 保持深链
  动作: WebKit 请求后读取 HK 入口容器从 `E2E_STARTED_AT` 起的新日志
  预期观察: 至少一条 `/workbench/tasks` 请求的 Referer 仍含 `/workbench/tasks`，且无凭据字段
  等待预算: 30s
  留证: `${SPRINT_DIR}/hk-entry.log`
  Test: evaluator:bash -c ': "${E2E_STARTED_AT:?}"; ssh -o ConnectTimeout=10 hk-vps "docker logs --since '$E2E_STARTED_AT' cecelia-core-hk 2>&1" | tee "$SPRINT_DIR/hk-entry.log" | grep -E '\''/workbench/tasks.*[Rr]eferer[^ ]*(/workbench/tasks)|[Rr]eferer[^ ]*(/workbench/tasks).*/workbench/tasks'\''; ! grep -Ei '\''(cookie|authorization|token)='\'' "$SPRINT_DIR/hk-entry.log"'

## Invariant 映射

- [x] [BEHAVIOR] [L3] INV-1: 真环境验证必须真实访问 HK/US 与 WebKit
  动作: 执行 B-03、B-04、B-05，不提供离线替代入口
  预期观察: 任一真实能力不可用时命令非零
  等待预算: 120s
  留证: 三条 L3 evidence 与 exit code
  Test: evaluator:bash -c 'test -n "${PR_HEAD_SHA:?}"; curl -fsS --max-time 15 http://100.86.118.99:5211/build-info.json | jq -e --arg s "$PR_HEAD_SHA" '\''.git_sha==$s'\''; curl -fsS --max-time 15 http://100.71.151.105:5211/build-info.json | jq -e --arg s "$PR_HEAD_SHA" '\''.git_sha==$s'\'''

- [x] [BEHAVIOR] [L2] INV-2: validation identity 仅从 Runner late-bound
  动作: evaluator 启动前检查当前角色身份变量
  预期观察: HARNESS attempt 与 capability snapshot 均非空，合同无 UUID 固化
  等待预算: 0s
  留证: provenance JSON
  Test: evaluator:bash -c ': "${HARNESS_ATTEMPT_ID:?}"; : "${CAPABILITY_SNAPSHOT_ID:?}"; ! grep -nE '\''(ATTEMPT_ID|CAPABILITY_SNAPSHOT_ID).*[0-9a-f]{8}-[0-9a-f-]{27,}'\'' sprints/08111145-kernel-be8babea/contract-*.md'

- [x] [BEHAVIOR] [L2] INV-3: deploy 失败禁止 warning 降级
  动作: 令 promote fixture 返回 23 并运行 Dashboard-only
  预期观察: deploy 返回非零
  等待预算: 10s
  留证: Vitest 失败传播用例输出
  Test: manual:bash -c 'npx vitest run sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts -t "HK 同步或终验失败必须让 Dashboard-only 发布非零退出" --reporter=verbose'

- [x] [BEHAVIOR] [L3] INV-4: 判变使用生产自报 build-info
  动作: 分别读取 HK/US 生产 build-info
  预期观察: 两端 git_sha 都等于真实 PR head
  等待预算: 30s
  留证: 两端 JSON 响应
  Test: evaluator:bash -c ': "${PR_HEAD_SHA:?}"; for U in http://100.86.118.99:5211 http://100.71.151.105:5211; do curl -fsS --max-time 15 "$U/build-info.json" | jq -e --arg s "$PR_HEAD_SHA" '\''.git_sha==$s'\''; done'

- [x] [BEHAVIOR] [L3] INV-5: 判变端与终验端使用相同版本语义
  动作: 对两端 build-info 执行同一精确比较
  预期观察: git_sha 非 unknown 且完全一致
  等待预算: 30s
  留证: jq/cmp 输出
  Test: evaluator:bash -c ': "${PR_HEAD_SHA:?}"; A=$(curl -fsS --max-time 15 http://100.86.118.99:5211/build-info.json); echo "$A" | jq -e --arg s "$PR_HEAD_SHA" '\''.git_sha == $s'\''; B=$(curl -fsS --max-time 15 http://100.71.151.105:5211/build-info.json); echo "$B" | jq -e --arg s "$PR_HEAD_SHA" '\''.git_sha == $s'\''; [ "$A" = "$B" ]'

- [x] [BEHAVIOR] [L2] INV-6: 验证命令真实产生 Red exit code
  动作: 在未修实现上运行永久 Vitest 回归
  预期观察: 当前基线至少一条失败且进程非零
  等待预算: 30s
  留证: `/tmp/sprint-red.log`
  Test: evaluator:bash -c 'if npx vitest run sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts --reporter=verbose > /tmp/sprint-red.log 2>&1; then exit 1; fi; grep -E '\''FAIL|failed|×'\'' /tmp/sprint-red.log'

- [x] [BEHAVIOR] [L1] INV-7: 合同与测试不固化凭据
  动作: 扫描本 sprint 交付物中的常见真实凭据格式
  预期观察: 无私钥块、GitHub token 或 Bearer token
  等待预算: 0s
  留证: 扫描 exit code
  Test: manual:bash -c 'if rg -n '\''BEGIN (RSA |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}'\'' sprints/08111145-kernel-be8babea; then exit 1; fi'

- [x] [BEHAVIOR] [L3] INV-8: 入口日志证据必须脱敏
  动作: 对本轮 HK 入口日志扫描凭据字段
  预期观察: cookie、authorization、token 等号字段 0 条
  等待预算: 0s
  留证: `${SPRINT_DIR}/hk-entry.log` 扫描结果
  Test: evaluator:bash -c 'grep -q '\''/workbench/tasks'\'' "$SPRINT_DIR/hk-entry.log"; ! grep -Ei '\''(cookie|authorization|token)='\'' "$SPRINT_DIR/hk-entry.log"'
