# PRD: Stop Hook 多 Worktree Session 路由修复（Engine 16.0.0 → 17.0.0）

## 背景

empirical 定位（2026-04-19 Phase 6 E2E 重测）：**Stop Hook 在并行多 worktree 场景下路由错误**。

- `hooks/stop.sh` 找到第一个 `.dev-lock` 就 `break 2` route 到 stop-dev.sh
- 并行多 /dev 会话时 Stop Hook 总是处理第一个被扫到的，不区分当前 session
- 验证 PR #2435：stop.sh 路由到 `ci-harden-batch1` 而不是当前 `phase6-e2e-marker2` → exit 0 放行 → PR 永不自动合并

更深层：stop-dev.sh `_session_matches` 用 `$CLAUDE_SESSION_ID` env var 做 session 匹配，**但 Claude Code 不传这个 env var**。实测 Claude Code 只通过 stdin JSON 传 `session_id`/`transcript_path`/`cwd`/`stop_hook_active`。`_session_matches` session 分支永远失败，退到 branch/tty 失败，stop-dev.sh 找不到匹配 → exit 0。

之前 PR #2373/#1189/#1190 反复修但都没触及根因：**env var 就是空的**。

## 真实目的

Stop Hook 在并行多 worktree 下 **100% 正确路由到当前 session**。修 session_id 来源（从 stdin JSON 读）。

## 成功标准

1. `hooks/stop.sh` 顶部读 stdin JSON，export `CLAUDE_HOOK_SESSION_ID`/`CLAUDE_HOOK_TRANSCRIPT_PATH`/`CLAUDE_HOOK_CWD`/`CLAUDE_HOOK_STDIN_JSON`
2. stop.sh 改扫描逻辑：有 session_id 时按 owner_session 精确匹配；没 session_id fallback 老 break 2 行为
3. stop-dev.sh `_session_matches` 优先用 `$CLAUDE_HOOK_SESSION_ID`
4. `worktree-manage.sh init-or-check` 写 `.dev-lock` 时用 `ps -o args` 解析父 claude 的 `--session-id` 作为 owner_session
5. 新加 regression test 模拟 2 个 worktree 不同 owner_session
6. Engine 6 处版本 bump 17.0.0

## 方案选择

| 方案 | 选 |
|---|---|
| a. stop.sh 读 stdin + session_id 精确匹配 + 修 worktree-manage | ✅ |
| b. 对所有 .dev-lock 都跑 stop-dev.sh | ❌ 浪费 + exit code 混乱 |
| c. 只看 branch + cwd | ❌ cwd 永远是 main |

## 涉及文件

**修改**：
- `hooks/stop.sh`
- `hooks/stop-dev.sh`
- `packages/engine/skills/dev/scripts/worktree-manage.sh`
- Engine 6 处版本文件
- `packages/engine/feature-registry.yml`

**新建**：
- `packages/engine/tests/hooks/stop-hook-multi-worktree-routing.test.ts`

## 不做

- 不改 Claude Code runtime
- 不改 Brain / Superpowers / devloop-check
- 不改 CI workflow

## 假设

- Claude Code 通过 stdin JSON 传 session 信息（2.1.114 实测验证）
- `ps -o args= $PPID` 在 macOS/Linux 可用
- headless claude 启动指定 `--session-id`（launcher + Brain 都这么做）

## DoD

- [ ] [ARTIFACT] stop.sh 含 stdin 读取 + CLAUDE_HOOK_SESSION_ID export
  Test: manual:node -e "const c=require('fs').readFileSync('hooks/stop.sh','utf8');if(!c.includes('CLAUDE_HOOK_SESSION_ID')||!c.includes('.session_id'))process.exit(1)"
- [ ] [ARTIFACT] stop.sh 按 owner_session 精确匹配（非无脑 break 2）
  Test: manual:node -e "const c=require('fs').readFileSync('hooks/stop.sh','utf8');if(!c.includes('owner_session'))process.exit(1)"
- [ ] [ARTIFACT] stop-dev.sh _session_matches 读 CLAUDE_HOOK_SESSION_ID
  Test: manual:node -e "const c=require('fs').readFileSync('hooks/stop-dev.sh','utf8');if(!c.includes('CLAUDE_HOOK_SESSION_ID'))process.exit(1)"
- [ ] [ARTIFACT] worktree-manage.sh 从 ps 解析 session-id
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('ps -o args')||!c.includes('session-id'))process.exit(1)"
- [ ] [ARTIFACT] Engine 6 处版本 17.0.0
  Test: manual:node -e "const fs=require('fs');['packages/engine/VERSION','packages/engine/.hook-core-version','packages/engine/hooks/VERSION'].forEach(f=>{if(fs.readFileSync(f,'utf8').trim()!=='17.0.0')process.exit(1)})"
- [ ] [ARTIFACT] feature-registry 含 17.0.0
  Test: manual:node -e "if(!require('fs').readFileSync('packages/engine/feature-registry.yml','utf8').includes('17.0.0'))process.exit(1)"
- [ ] [BEHAVIOR] multi-worktree Stop Hook routing regression 通过
  Test: tests/hooks/stop-hook-multi-worktree-routing.test.ts
- [ ] [ARTIFACT] Learning 文件存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-04192140-stophook-session-routing.md')"
