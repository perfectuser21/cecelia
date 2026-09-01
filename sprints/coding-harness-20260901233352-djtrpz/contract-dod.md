---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改代码或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('fs'),p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与鉴权边界可核对
  动作: 阅读端点用途和鉴权方式两节。
  预期观察: POST 创建、GET 查询、loopback 与远端 Bearer 要求均有明确字面。
  等待预算: 0s
  留证: 静态断言输出与文档路径
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Bearer CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 九项角色白名单与服务端事实源完全一致
  动作: 阅读角色白名单并逐项核对。
  预期观察: 列表按顺序仅含 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge。
  等待预算: 0s
  留证: Vitest 中角色数组相等断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t "文档逐项列出恰好九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填性与 base_sha 省略语义可核对
  动作: 阅读 payload 字段节。
  预期观察: sprint_dir、base_repo、branch 标为必填；base_sha 标为可省略且由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 字段语义断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t "文档区分 payload 必填字段与可省略 base_sha"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败的三个回滚终态完整可见
  动作: 阅读派发失败自动回滚节。
  预期观察: 同时看到 run→failed、session→closed、task→cancelled。
  等待预算: 0s
  留证: 静态断言输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run→failed'"'"','"'"'session→closed'"'"','"'"'task→cancelled'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-05: canonical 范围 oracle 拒绝代码、既有文档或额外交付
  动作: 相对权威实现基线检查候选 HEAD 的非 sprint diff。
  预期观察: 只有一行 `A docs/current/attempt-run-bridge-guide.md`；任何其他路径或 M/D/R 状态均失败。
  等待预算: 0s
  留证: git diff --name-status 输出
  Test: manual:bash -c 'node -e "const{execFileSync}=require('"'"'child_process'"'"');const b='"'"'37fc357d927b1429de59e1b50e4de762c5e7ea18'"'"',d='"'"'sprints/coding-harness-20260901233352-djtrpz/'"'"';const a=execFileSync('"'"'git'"'"',['"'"'diff'"'"','"'"'--name-status'"'"',b+'"'"'...HEAD'"'"'],{encoding:'"'"'utf8'"'"'}).trim().split(/\n/).filter(x=>x&&!x.includes(d));if(a.length!==1||a[0]!==('"'"'A'"'"'+String.fromCharCode(9)+'"'"'docs/current/attempt-run-bridge-guide.md'"'"')){console.error(a);process.exit(1)}"'

- [ ] [BEHAVIOR] [L1] INV-1: 凭据安全与 trace 不变量保持
  动作: 检查文档 trace 行及 token 示例。
  预期观察: 精确 task_request_hash 存在，且没有为 CECELIA_INTERNAL_TOKEN 写入实际值。
  等待预算: 0s
  留证: 负向凭据 oracle 输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!s.includes('"'"'task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946'"'"'))process.exit(1);if(/CECELIA_INTERNAL_TOKEN\\s*=\\s*[^$<{\\s][^\\s]*/.test(s))process.exit(1)"'

## Invariant 映射

- 分支归属：N/A，约束 Planner；本角色只在服务端签发 proposer 分支提交。
- 凭据安全：由 INV-1 负向 oracle 覆盖。
- 端点鉴权：由 B-01 验证文档明确记录既有 `internalAuthOrLoopback`；本 sprint 不改端点。
- 基线权威：B-05 字面使用 `inputs.implementation_baseline.base_sha`，不使用 workspace checkout 替换。
