---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: 宿主 bridge 凭据只读消费（消除多写入者竞态根因）

**范围**: 仅改宿主 bridge（`cecelia-bridge.cjs` + 同源 `cecelia-bridge.js`）的 Claude 凭据投递方式——`/llm-call` spawn claude 前按 attempt 复制独立临时 config dir 并指向它、退出后清理；不动容器路径 / Codex 信封 / gear 分档 / evaluator / judge / mergeGate / infrastructure 仓库。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增 helper 模块 `packages/brain/scripts/ephemeral-claude-config.cjs`，导出 `prepareEphemeralClaudeConfig`
  Test: node -e "const m=require('./packages/brain/scripts/ephemeral-claude-config.cjs');if(typeof m.prepareEphemeralClaudeConfig!=='function')process.exit(1)"

- [ ] [ARTIFACT] `cecelia-bridge.cjs` 的 `/llm-call` spawn 路径引用 helper（不再直用 `~/.claude-account{N}` 作 CLAUDE_CONFIG_DIR）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-bridge.cjs','utf8');if(!c.includes('ephemeral-claude-config'))process.exit(1)"

- [ ] [ARTIFACT] 同源 `cecelia-bridge.js`（brain-deploy 推送到宿主 bin 的入口）同步引用 helper
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-bridge.js','utf8');if(!c.includes('ephemeral-claude-config'))process.exit(1)"

- [ ] [ARTIFACT] 第 2 步书面结论交付物存在（宿主写入者归零后可另行提案收窄让位；仅记录不实施）
  Test: node -e "const fs=require('fs');const p='sprints/08111800-bridge-readonly-credentials/step2-conclusion.md';const c=fs.readFileSync(p,'utf8');if(!c.includes('SKIP:live_interactive_session_owns_refresh')||!c.includes('4ce29c14'))process.exit(1)"

## INV 铁律映射（历史约束三源之铁律清单）

- [ ] [BEHAVIOR] [L2] INV-1 [单写入者]：bridge 侧对权威凭据文件写入归零（由 B-01 核心红线覆盖）
  动作: 经 bridge 跑完一次 /llm-call attempt
  预期观察: 权威 .credentials.json mtime+sha256 前后完全不变（bridge 不再是写入者）
  等待预算: 60s
  留证: bridge-readonly-e2e.sh redline 输出 OK[redline] 行
  Test: manual:bash -c 'bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh redline'
- INV-2 [顺序不可颠倒] → N/A：本 sprint 仅交付第 1 步代码（宿主写入者归零），不含任何让位逻辑改动；第 2 步为书面结论（见 step2-conclusion.md ARTIFACT），不落代码。
- [ ] [BEHAVIOR] [L2] INV-3 [不碰让位 / 不改 infrastructure]：本仓库不含且本 PR 不引入 refresh-claude-tokens.sh
  动作: 在被测仓库检索 refresh-claude-tokens.sh
  预期观察: 该文件在本仓库不存在（属 infrastructure 仓库，不在 WORKSPACE_REPOSITORIES 内），本 PR 未引入
  等待预算: 0s
  留证: find 命令输出为空
  Test: manual:bash -c 'if find . -name refresh-claude-tokens.sh -not -path "*/node_modules/*" | grep -q .; then echo FAIL; exit 1; fi; echo OK'
- INV-4 [证据分流] → N/A：judge FAIL 证据窗口 vs 实现缺陷的分流属 judge 侧协议，非本 sprint 代码交付物。

## BEHAVIOR 条目（五行剧本，evaluator 逐条真实执行）

- [ ] [BEHAVIOR] [L2] B-01: 经 bridge 跑完 attempt，权威 .credentials.json mtime+sha256 零变化（核心红线）[接缝×2]
  动作: 隔离 HOME 造权威 account1，记录其 .credentials.json 的 mtime+sha256，起真实 cecelia-bridge.cjs + stub CLAUDE_BIN，POST /llm-call {accountId:"account1"}
  预期观察: /llm-call 返回 ok:true，claude 的刷新回写落在临时副本；权威 .credentials.json mtime 与 sha256 前后完全不变
  等待预算: 60s
  留证: bridge-readonly-e2e.sh redline 输出（含 OK[redline]）
  Test: manual:bash -c 'bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh redline'

- [ ] [BEHAVIOR] [L2] B-02: claude 子进程 CLAUDE_CONFIG_DIR 指向临时目录（非权威），attempt 结束被清理
  动作: 同 B-01 装置发一次 /llm-call；stub claude 把它收到的 CLAUDE_CONFIG_DIR 写入 sentinel
  预期观察: sentinel 记录的目录 != 权威目录且不在 $HOME/.claude-* 家族（落在 os.tmpdir 临时区）；attempt 结束后该临时目录已不存在
  等待预算: 60s
  留证: bridge-readonly-e2e.sh wiring 输出（含 OK[wiring] 与临时目录路径）
  Test: manual:bash -c 'bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh wiring'

- [ ] [BEHAVIOR] [L2] B-03: 临时目录创建失败 → 主流程失败且不回退权威目录（防静默降级）
  动作: 权威 account1 完好，但把 bridge 进程 TMPDIR 指向不存在路径使临时目录创建失败，POST /llm-call
  预期观察: /llm-call 返回 ok 非 true；claude 未以权威目录为 CLAUDE_CONFIG_DIR 被 spawn（sentinel 不含权威路径）；权威 .credentials.json 仍不变
  等待预算: 60s
  留证: bridge-readonly-e2e.sh creation-fail 输出（含 OK[creation-fail]）
  Test: manual:bash -c 'bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh creation-fail'

- [ ] [BEHAVIOR] [L2] B-04: 并发两 attempt 各用互不相同临时目录，权威文件零写入 [接缝×2]
  动作: 同一 bridge 上并行发两次 /llm-call
  预期观察: sentinel 出现 ≥2 条且去重后 ≥2 条（两临时目录互不相同）；无任一条指向权威目录；权威 .credentials.json 不变
  等待预算: 60s
  留证: bridge-readonly-e2e.sh concurrency 输出（含 OK[concurrency] 与 distinct 计数）
  Test: manual:bash -c 'bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh concurrency'

- [ ] [BEHAVIOR] [L2] B-05: 临时目录清理失败仅记日志、不抛错（主流程不受影响）
  动作: 直接调 helper 造临时目录，外部删除该目录模拟清理失败，再调其 cleanup()
  预期观察: cleanup() 不抛异常、进程正常退出（清理失败被吞掉并可记日志）
  等待预算: 0s
  留证: bridge-readonly-e2e.sh cleanup-fail 输出（含 OK[cleanup-fail]）
  Test: manual:bash -c 'bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh cleanup-fail'

- [ ] [BEHAVIOR] [L2] B-06: 零回归——容器路径与 Codex 信封路径既有单测全绿、行为不变
  动作: 跑既有 docker-executor vitest 三件 + Codex credential-envelope node 测
  预期观察: 全部退出码 0，无失败用例
  等待预算: 300s
  留证: vitest/node 输出末尾 passed 汇总
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/docker-executor.test.js src/__tests__/docker-executor-mount-strategy.test.js src/__tests__/dockerfile-config-copy.test.js && node scripts/fleet-worker/credential-envelope.test.cjs'
