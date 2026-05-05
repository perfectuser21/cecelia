# DoD: cp-0505191801 stop-hook-session-id-routing

## 概述
Stop Hook 隔离 key 切到 session_id（v22.0.0），彻底解多 session 撞 .cecelia/ 池串线问题。

## 验收

- [x] [BEHAVIOR] 多 session 物理隔离 — sess-A1 路由到 cp-aaa；sess-B1 路由到 cp-bbb；互不串线
  Test: manual:bash packages/engine/tests/integration/stop-dev-session-id-routing.test.sh

- [x] [BEHAVIOR] session 漂主仓库 — cwd=主仓库 + hook session_id 命中 → 仍 block（路由不依赖 cwd）
  Test: manual:bash packages/engine/tests/integration/stop-dev-session-id-routing.test.sh

- [x] [BEHAVIOR] 普通对话不在 /dev — session_id 不匹配 → exit 0 放行
  Test: manual:bash packages/engine/tests/integration/stop-dev-session-id-routing.test.sh

- [x] [BEHAVIOR] 向下兼容 — 旧 dev-active schema cwd→branch fallback 仍工作
  Test: manual:bash packages/engine/tests/integration/stop-dev-session-id-routing.test.sh

- [x] [BEHAVIOR] 既有 multi-worktree 测试 5/5 通过（无 regression）
  Test: manual:bash packages/engine/tests/integration/stop-dev-multi-worktree.test.sh

- [x] [BEHAVIOR] 既有 ralph-loop-mode 测试 4/4 通过（Case C 改为 v22 session_id 路由）
  Test: manual:bash packages/engine/tests/integration/ralph-loop-mode.test.sh

- [x] [BEHAVIOR] 既有 7stage-flow 测试 5/5 通过
  Test: manual:bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh

- [x] [BEHAVIOR] verify-dev-complete unit 测试 32 case 通过
  Test: manual:bash packages/engine/tests/unit/verify-dev-complete.test.sh

- [x] [ARTIFACT] stop-dev.sh 入口读 stdin payload session_id
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8'); if(!c.includes('hook_session_id')) process.exit(1)"

- [x] [ARTIFACT] worktree-manage.sh v22.0.0 注释存在（_resolve_claude_session_id 优先 ps）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8'); if(!c.includes('v22.0.0')) process.exit(1)"

- [x] [ARTIFACT] 新测试文件 stop-dev-session-id-routing.test.sh 存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/integration/stop-dev-session-id-routing.test.sh')"

- [x] [ARTIFACT] Engine 6 处版本文件全 bump 18.23.0
  Test: manual:node -e "const v='18.23.0'; const fs=require('fs'); const files=['packages/engine/VERSION','packages/engine/.hook-core-version','packages/engine/hooks/VERSION','packages/engine/hooks/.hook-core-version']; for (const f of files) if (fs.readFileSync(f,'utf8').trim()!==v) process.exit(1); if (JSON.parse(fs.readFileSync('packages/engine/package.json')).version!==v) process.exit(1); if (!fs.readFileSync('packages/engine/regression-contract.yaml','utf8').includes('version: 18.23.0')) process.exit(1)"

- [x] [ARTIFACT] feature-registry.yml changelog 含 18.23.0 entry
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8'); if(!c.includes('version: \"18.23.0\"')) process.exit(1)"
