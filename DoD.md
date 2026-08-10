contract_branch: cp-harness-propose-r1-9b3a2609-r78493175-a4
sprint_dir: sprints/08111930-bridge-readonly-credentials

---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: 宿主 bridge 凭据只读消费（消除多写入者竞态根因）

**范围**: 仅宿主 bridge（`cecelia-bridge.cjs` + 同源 `cecelia-bridge.js`）的 `/llm-call` 起 claude 时，Claude 凭据投递改为「按 attempt 复制独立临时 config dir → 只读消费权威 → 结束清理」。不动容器路径 / Codex 信封 / gear 分档 / evaluator/judge/mergeGate / infrastructure 仓库。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 新增只读消费 helper 模块，导出 provision/cleanup/resolve 三函数
  Test: node -e "const m=require('./packages/brain/scripts/lib/claude-config-provision.cjs');if(typeof m.provisionConfigDir!=='function'||typeof m.cleanupConfigDir!=='function'||typeof m.resolveAuthoritativeConfigDir!=='function')process.exit(1)"

- [x] [ARTIFACT] cecelia-bridge.cjs /llm-call 接入 helper，不再把 CLAUDE_CONFIG_DIR 直接指向权威账号目录
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-bridge.cjs','utf8');if(!c.includes('claude-config-provision')||!c.includes('provisionConfigDir'))process.exit(1)"

- [x] [ARTIFACT] cecelia-bridge.js（同源第二实现）同步同一只读消费模式
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-bridge.js','utf8');if(!c.includes('provisionConfigDir'))process.exit(1)"

- [x] [ARTIFACT] INV-2 顺序不可颠倒：本 PR 改动文件集不含 infrastructure / refresh-claude-tokens / 让位逻辑
  Test: bash -c 'git diff --name-only origin/main...HEAD | grep -Ei "infrastructure|refresh-claude-tokens|live_interactive_session_owns_refresh" && exit 1; echo OK'

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] INV-1 B-01: 经 bridge 派发一次 attempt 后权威文件 mtime+sha256 完全不变 [接缝×2]
  动作: 起 cecelia-bridge.cjs（fake HOME + fake-claude 忠实复现回写），记录 `~/.claude-account1/.credentials.json` mtime+sha256，POST /llm-call {accountId:account1}
  预期观察: attempt 返回 200 后，权威 .credentials.json 的 mtime 与 sha256 与调用前逐字节相等
  等待预算: 60s
  留证: e2e redline stdout 末行（含 "OK: redline — 权威文件 mtime + sha256 attempt 前后完全不变"）
  Test: manual:bash -c 'node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs redline'

- [x] [BEHAVIOR] [L2] B-02: CLAUDE_CONFIG_DIR 指向临时副本（非权威目录）且 attempt 结束后临时目录被清理 [接缝×2]
  动作: 经 bridge 派发一次 attempt，从 fake-claude 记录的 CLAUDE_CONFIG_DIR 取回本次指向的目录
  预期观察: 指向目录 ∈ os.tmpdir 且 !== ~/.claude-account1；within 5s 该临时目录被删除（existsSync=false）
  等待预算: 60s
  留证: e2e isolation stdout（含 "指向临时副本" + "结束后已清理"）
  Test: manual:bash -c 'node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs isolation'

- [x] [BEHAVIOR] [L2] B-03: 临时目录创建失败时主流程抛错告警，不回退到权威目录
  动作: 对 provisionConfigDir 传入不可创建的 tmpBase（父路径是文件 → ENOTDIR），触发真实创建失败
  预期观察: 函数抛错（attempt 侧应转 500+告警），且不把权威目录当 configDir 返回、不回退直用权威
  等待预算: 0s
  留证: vitest 单测 pass 输出（it "throws when the temp dir cannot be created"）
  Test: manual:bash -c 'npx vitest run sprints/08111930-bridge-readonly-credentials/tests/claude-config-provision.test.js -t "throws when the temp dir cannot be created"'

- [x] [BEHAVIOR] [L2] B-04: 临时副本清理失败时仅记日志返回 false，不抛错不影响结果
  动作: 对 cleanupConfigDir 注入抛错的 rmImpl（模拟 EACCES 清理失败），提供捕获 warn 的 logger
  预期观察: 调用不抛错、返回 false、logger.warn 收到含 cleanup/清理/EACCES 的告警
  等待预算: 0s
  留证: vitest 单测 pass 输出（it "returns false when removal fails"）
  Test: manual:bash -c 'npx vitest run sprints/08111930-bridge-readonly-credentials/tests/claude-config-provision.test.js -t "returns false when removal fails"'

- [x] [BEHAVIOR] [L2] B-05: 并发两 bridge attempt 各用互不相同临时目录，权威文件仍未被写 [接缝×2]
  动作: 并行 POST 两个 /llm-call {accountId:account1}，收集两次 fake-claude 记录的 CLAUDE_CONFIG_DIR
  预期观察: 两个指向目录去重后 >=2 个互异路径、均非权威目录；权威文件 mtime+sha256 仍不变
  等待预算: 60s
  留证: e2e concurrency stdout（含 "两 attempt 临时目录互异"）
  Test: manual:bash -c 'node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs concurrency'

- [x] [BEHAVIOR] [L2] INV-1 B-06: 零回归——容器路径（docker-executor 挂载策略）与 Codex 信封/broker 既有单测全绿、行为不变
  动作: 跑 docker-executor 挂载策略单测 + credential-broker 单测
  预期观察: 两组既有单测全部 pass（容器 :ro 挂载 + Codex 只读消费行为未被本 sprint 改动破坏）
  等待预算: 120s
  留证: 两次 vitest --reporter=basic 的 "Tests N passed" 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/docker-executor-mount-strategy.test.js src/orchestrator/credential-broker.test.js --reporter=basic'
