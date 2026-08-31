---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在于约定路径且有四个独立二级章节
  Test: node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');if(!/[\u4e00-\u9fff]/.test(c)||((c.match(/^## /gm)||[]).length<4))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能确认 POST 与 GET 端点用途及鉴权方式
  动作: 打开 attempt-run 桥接说明并阅读“端点与鉴权”章节
  预期观察: 看到 POST 异步派发、GET 按 id 轮询，以及 internalAuthOrLoopback 和宿主/远端 Bearer 要求
  等待预算: 0s
  留证: 文档校验命令输出
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge.md\",\"utf8\");for(const x of [\"POST /api/brain/harness/attempt-run\",\"GET /api/brain/harness/attempt-run/:id\",\"internalAuthOrLoopback\",\"Authorization: Bearer\",\"CECELIA_INTERNAL_TOKEN\"])if(!c.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能从九项角色白名单选择合法角色
  动作: 阅读“角色白名单”章节并逐项核对角色
  预期观察: 九个生产白名单角色均以字面量列出，且说明白名单外角色被拒绝
  等待预算: 0s
  留证: 角色集合校验命令输出
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge.md\",\"utf8\");for(const r of [\"canary\",\"planner\",\"proposer\",\"reviewer\",\"generator\",\"generator-fix\",\"evaluator\",\"evaluator-evidence-repair\",\"judge\"])if(!c.includes(String.fromCharCode(96)+r+String.fromCharCode(96)))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能构造必填 payload 并省略 base_sha
  动作: 阅读“请求 payload”章节并核对必填与可选字段
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: payload 语义校验命令输出
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge.md\",\"utf8\");for(const x of [\"sprint_dir\",\"base_repo\",\"branch\",\"base_sha\",\"可省略\",\"生产 Brain\"])if(!c.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能识别派发失败后的三项自动回滚
  动作: 阅读“派发失败自动回滚”章节
  预期观察: run、session、task 分别进入 failed、closed、cancelled
  等待预算: 0s
  留证: 回滚终态校验命令输出
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge.md\",\"utf8\");for(const x of [\"run → failed\",\"session → closed\",\"task → cancelled\"])if(!c.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-1: 产品变更仅包含目标文档
  动作: 比较权威 baseline 与候选 HEAD 的产品路径变更
  预期观察: docs/current、packages、apps 范围内只出现 docs/current/attempt-run-bridge.md
  等待预算: 0s
  留证: git diff 文件列表
  Test: manual:bash -c 'CHANGED=$(git diff --name-only 1ef19bd6f70b79e14a20ecb0e37ba8492f71a029...HEAD -- docs/current packages apps | sort); [ "$CHANGED" = "docs/current/attempt-run-bridge.md" ]'

- [ ] [BEHAVIOR] [L1] INV-2: 文档不包含真实 Bearer 凭据
  动作: 扫描文档中的 Authorization 示例
  预期观察: 示例只引用环境变量 CECELIA_INTERNAL_TOKEN，不出现硬编码长 token
  等待预算: 0s
  留证: 凭据模式扫描输出
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge.md\",\"utf8\");if(/Bearer [A-Za-z0-9_-]{24,}/.test(c))process.exit(1);if(!c.includes(\"Bearer $CECELIA_INTERNAL_TOKEN\"))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-3: 冻结测试使用 Vitest 且保留在 Sprint tests 目录
  动作: 执行 Sprint 冻结测试
  预期观察: Vitest 找到四个用例；实现文档后全部通过
  等待预算: 30s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-doc.test.ts --reporter=verbose'
