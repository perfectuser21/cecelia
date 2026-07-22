---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Codex/Grok 有头 Launcher + 无头 Provider-Neutral Supervisor + 四路 Executor 路由修正

**范围**: 修正 harness-skill-relay.js + entrypoint.sh 二元路由 Bug；新增 codex-launch.sh / grok-launch.sh / codex-supervisor.mjs / grok-supervisor.mjs；幂等安装脚本
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/harness-skill-relay.js` `_spawnHeadedSession` 的 `innerCmd` 含显式三分支（claude/grok/codex），executor=grok 时含 `grok-launch.sh`
  Test: node -e "const s=require('fs').readFileSync('/workspace/packages/brain/src/harness-skill-relay.js','utf8');if(!/grok-launch\.sh/.test(s)){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `docker/cecelia-runner/entrypoint.sh` 旧路径含 grok 显式分支，未知 executor exit 1 + 错误日志
  Test: node -e "const s=require('fs').readFileSync('/workspace/docker/cecelia-runner/entrypoint.sh','utf8');if(!/CECELIA_EXECUTOR.*grok|provider.*grok/.test(s)||!/exit 1/.test(s)){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `scripts/codex-launch.sh` 存在且含 MAX_RETRIES=3、trap SIGABRT、codex resume、凭据快照路径
  Test: node -e "const s=require('fs').readFileSync('/workspace/scripts/codex-launch.sh','utf8');if(!/MAX_RETRIES.*3/.test(s)||!/trap.*ABRT/.test(s)||!/codex.*resume/.test(s)||!/codex-relay-cred|snapshot/.test(s)){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `scripts/grok-launch.sh` 存在且含 MAX_RETRIES=3、trap SIGABRT、grok --resume、debug log
  Test: node -e "const s=require('fs').readFileSync('/workspace/scripts/grok-launch.sh','utf8');if(!/MAX_RETRIES.*3/.test(s)||!/trap.*ABRT/.test(s)||!/grok.*--resume|--resume/.test(s)||!/LOG_FILE|debug.*log/.test(s)){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `scripts/codex-supervisor.mjs` 存在且含 MAX_TURNS=10、28800、continue/blocked 三态、Brain PATCH
  Test: node -e "const s=require('fs').readFileSync('/workspace/scripts/codex-supervisor.mjs','utf8');if(!/MAX_TURNS.*10/.test(s)||!/28800/.test(s)||!/blocked/.test(s)||!/PATCH|tasks/.test(s)){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `scripts/grok-supervisor.mjs` 存在且含 MAX_TURNS=10、grok -p --resume、blocked Brain PATCH
  Test: node -e "const s=require('fs').readFileSync('/workspace/scripts/grok-supervisor.mjs','utf8');if(!/MAX_TURNS.*10/.test(s)||!/grok.*-p.*--resume|--resume/.test(s)||!/blocked/.test(s)){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `scripts/install-launchers.sh` 存在且含 cecelia-launchers-begin/end 受控 block
  Test: node -e "const s=require('fs').readFileSync('/workspace/scripts/install-launchers.sh','utf8');if(!/launchers-begin/.test(s)||!/launchers-end/.test(s)){process.exit(1)}console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] `harness-skill-relay.js` executor=grok 时 innerCmd 含 grok-launch.sh（三分支修正，INV-1）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/harness-skill-relay.js\",\"utf8\");if(!/grok-launch\\.sh/.test(s)){console.error(\"FAIL: grok-launch.sh 缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `harness-skill-relay.js` 无二元 `isClaudeHeaded ? ... : codex` 形态（INV-1 反向断言）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/harness-skill-relay.js\",\"utf8\");const section=s.slice(s.indexOf(\"_spawnHeadedSession\"));const binary=/isClaudeHeaded\s*\?\s*[^:]+:\s*[^\"]*codex\s/.test(section);if(binary){console.error(\"FAIL: 二元路由 bug 仍存在\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `harness-skill-relay.js` executor=unknown 时返回 {ok:false} + unsupported executor 信息（INV-8）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/harness-skill-relay.js\",\"utf8\");if(!/unsupported executor|unknown executor/.test(s)){console.error(\"FAIL: loud-fail 缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `entrypoint.sh` 含 CECELIA_EXECUTOR=grok 显式分支（INV-2 + GP6 修正）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"/workspace/docker/cecelia-runner/entrypoint.sh\",\"utf8\");if(!/CECELIA_EXECUTOR.*grok|provider.*==.*grok/.test(s)){console.error(\"FAIL: grok 分支缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `entrypoint.sh` 未知 executor loud-fail exit 1（INV-2 + GP7）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"/workspace/docker/cecelia-runner/entrypoint.sh\",\"utf8\");if(!/unsupported executor|unknown executor|CECELIA_EXECUTOR.*invalid/.test(s)){console.error(\"FAIL: loud-fail 缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `codex-launch.sh` exit 0 / exit 130（SIGINT）不重启（INV-3）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-launch.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `codex-launch.sh` SIGABRT/137/143 最多重试 3 次超限 exit 1（INV-4）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-launch.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `codex-launch.sh` 重试时用 session-id 恢复（INV-5 + codex resume）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-launch.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `codex-launch.sh` 用凭据快照目录（INV-11，非真实 CODEX_HOME）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-launch.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `grok-launch.sh` exit 0 / exit 130 不重启（INV-3）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-launch.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `grok-launch.sh` SIGABRT 最多重试 3 次超限 exit 1（INV-4）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-launch.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `grok-launch.sh` 重试时用 grok --resume session-id（INV-5）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-launch.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `grok-launch.sh` session 建立前崩溃重开新 TUI，建立后用 grok --resume 恢复（GP3 区分）
  Test: manual:bash -c 'grep -qE "session.*建立前|pre.*session.*crash|pre_session_crash" /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-launch.test.sh && bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-launch.test.sh && echo OK'
  期望: OK（含 test_pre_session_crash_no_resume 用例，整体通过）

- [ ] [BEHAVIOR] `codex-supervisor.mjs` continue 时用同一 session-id 续跑（INV-5 + GP5，静态分析）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-supervisor.test.mjs && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `codex-supervisor.mjs` complete 须外部验收（不信模型自称，INV-6，静态分析）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-supervisor.test.mjs && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `codex-supervisor.mjs` blocked 写 Brain 不伪装 completed（INV-7，静态分析）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-supervisor.test.mjs && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `codex-supervisor.mjs` 超 MAX_TURNS 标 timed_out exit 1（FR-R5，静态分析）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-supervisor.test.mjs && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `grok-supervisor.mjs` continue 用 grok -p --resume session-id（GP6 + INV-5，静态分析）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-supervisor.test.mjs && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `grok-supervisor.mjs` blocked 写 Brain 不伪装 completed（INV-7，静态分析）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-supervisor.test.mjs && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `grok-launch.sh` 源码不含修改 Grok 内部逻辑的代码（INV-10）
  Test: manual:bash -c 'if grep -qE "patch|sed.*grok|awk.*grok" /workspace/scripts/grok-launch.sh 2>/dev/null; then echo FAIL; exit 1; else echo OK; fi'
  期望: OK（不含 patch/sed.*grok/awk.*grok 等修改 Grok 内部的操作）

- [ ] [BEHAVIOR] `codex-launch.sh` 和 `grok-launch.sh` 不含强制去 TTY 标志（INV-12 janitor 兼容）
  Test: manual:bash -c 'if grep -qE "\-\-no-tty|--no-pty|script -q /dev/null" /workspace/scripts/codex-launch.sh /workspace/scripts/grok-launch.sh 2>/dev/null; then echo FAIL; exit 1; else echo OK; fi'
  期望: OK（不含 --no-tty 或其他强制去 TTY 的标志）

- [ ] [BEHAVIOR] `install-launchers.sh` 重复运行不产生重复 alias（INV-9 幂等）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/install-launchers.test.sh && echo OK'
  期望: OK（整体 exit 0，0 FAIL）

- [ ] [BEHAVIOR] `dispatch-worker.mjs` buildCommand 遇未知 vendor 抛错（INV-8 不回归）
  Test: manual:bash -c 'node -e "import(\"/workspace/scripts/dispatch-worker.mjs\").then(m=>{try{m.buildCommand(\"unknown\",{home:\"/tmp\"},\"brief\",\"/tmp\")}catch(e){if(e.message.includes(\"unknown vendor\")){console.log(\"OK\")}else{process.exit(1)}}})"'
  期望: OK

- [ ] [BEHAVIOR] GP1 不回归：executor=claude headed 时 innerCmd 仍含 claude-launch.sh（零回归，INV 兼容性）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/harness-skill-relay.js\",\"utf8\");if(!/claude-launch\.sh/.test(s)){console.error(\"FAIL: claude-launch.sh 回归\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（autonomous journey，CI linux 跑）

- [ ] [BEHAVIOR:E2E] 路由单元测试（GREEN 断言）全部通过——harness-skill-relay.js 三分支 + entrypoint.sh 三分支 + unknown loud-fail（RED 阶段通过 git stash 前后对比验证，不纳入 CI 正式断言，由 generator 执行后注释在 PR 描述中）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-grok-launcher-routing.test.sh && echo OK'
  期望: OK（0 FAIL）

- [ ] [BEHAVIOR:E2E] codex-launch.sh fake binary 测试全部通过
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-launch.test.sh && echo ALL_PASS'
  期望: ALL_PASS

- [ ] [BEHAVIOR:E2E] grok-launch.sh fake binary 测试全部通过（含 test_pre_session_crash_no_resume）
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-launch.test.sh && echo ALL_PASS'
  期望: ALL_PASS

- [ ] [BEHAVIOR:E2E] codex-supervisor.mjs 静态源码断言全部通过（静态分析，非运行时验证）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-supervisor.test.mjs && echo ALL_PASS'
  期望: ALL_PASS

- [ ] [BEHAVIOR:E2E] grok-supervisor.mjs 静态源码断言全部通过（静态分析，非运行时验证）
  Test: manual:bash -c 'node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-supervisor.test.mjs && echo ALL_PASS'
  期望: ALL_PASS

- [ ] [BEHAVIOR:E2E] entrypoint.sh bash 集成测试全部通过
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-grok-entrypoint-routing.test.sh && echo ALL_PASS'
  期望: ALL_PASS

- [ ] [BEHAVIOR:E2E] install-launchers.sh 幂等测试通过
  Test: manual:bash -c 'bash /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/install-launchers.test.sh && echo ALL_PASS'
  期望: ALL_PASS
