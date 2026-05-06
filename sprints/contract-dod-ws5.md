# Contract DoD — Workstream 5: F0 7 step E2E smoke

**范围**: 编写 `tests/e2e/mj1-skeleton-smoke.spec.ts` 端到端测试，覆盖 7 step 完整路径，每个 step 显式标识。**E2E spec 必须 mock 上游接口**（不依赖物理 worktree、不依赖真实 KR DB），让 spec 在任意 CI runner 上可跑。
**大小**: M
**依赖**: WS1 / WS2 / WS3 / WS4 全部完成

**Round 2 修订**: 补"E2E spec mock 上游接口"两条 ARTIFACT；并明确 cascade FAIL 策略（Generator 阶段 WS1-WS4 任意红 → 直接判 sprint cascade FAIL，跳过 E2E 阶段）。

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `tests/e2e/mj1-skeleton-smoke.spec.ts` 存在
  Test: test -f tests/e2e/mj1-skeleton-smoke.spec.ts

- [ ] [ARTIFACT] 测试文件含 7 处 step 标识（step 1: ... step 7:）
  Test: node -e "const c=require('fs').readFileSync('tests/e2e/mj1-skeleton-smoke.spec.ts','utf8');for(let n=1;n<=7;n++){if(!new RegExp('step\\\\s*'+n+'\\\\s*:','i').test(c))process.exit(1)}"

- [ ] [ARTIFACT] 测试文件 import 至少一个 brain 模块（验证有真实集成断言而非纯 placeholder）
  Test: node -e "const c=require('fs').readFileSync('tests/e2e/mj1-skeleton-smoke.spec.ts','utf8');if(!/from\s+['\"][^'\"]*packages\/brain[^'\"]*['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件包含 KR before/after +1 的断言文本
  Test: node -e "const c=require('fs').readFileSync('tests/e2e/mj1-skeleton-smoke.spec.ts','utf8');if(!/before\s*\+\s*1|after.*===.*before.*\+\s*1|after\s*===\s*before\s*\+\s*1/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件含至少 3 处 vi.mock 调用（mock 上游接口，不依赖物理资源）
  Test: node -e "const c=require('fs').readFileSync('tests/e2e/mj1-skeleton-smoke.spec.ts','utf8');const m=c.match(/vi\.mock\s*\(/g)||[];if(m.length<3)process.exit(1)"

- [ ] [ARTIFACT] 测试文件含 createWorktree 与 processExecutionCallback 字面量（证明 worktree 与 callback-processor 上游被 mock）
  Test: node -e "const c=require('fs').readFileSync('tests/e2e/mj1-skeleton-smoke.spec.ts','utf8');if(!/createWorktree/.test(c))process.exit(1);if(!/processExecutionCallback/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws5/）

见 `tests/ws5/mj1-skeleton-smoke.test.ts`，覆盖：
- skeleton E2E covers 7 step path with step labels 1..7
- step 1: Dashboard 任务列表行有 start-dev-button testid
- step 2: POST /tasks/:id/start-dev → 200 + {worktree_path, branch}
- step 3: worktree 路径在 mock 返回值中非空（不依赖物理 fs，Round 2 修订）
- step 4: /dev mock 简化版被调用一次
- step 5: callback-processor 接收到 task=completed + pr_url 的 callback
- step 6: KR progress 从 X 升至 X+1
- step 7: LiveMonitor WebSocket 收到至少一条 status 变化事件
- E2E spec 含 vi.mock 调用至少 3 处（Round 2 新增）

## Cascade FAIL 策略（Round 2 新增）

Generator 阶段实际跑 E2E 之前，先看 WS1-WS4 的 BEHAVIOR 测试是否全绿。任意一个 workstream 标红 → 直接判该 sprint **cascade FAIL**，跳过 E2E 阶段。Reviewer/Evaluator 看到上游红时不应再追究 E2E 的具体红点（避免噪声）。
