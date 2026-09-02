---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文桥接说明存在，且相对 implementation baseline 唯一产品变更为该文件
  Test: node -e "const fs=require('fs');fs.accessSync('docs/current/attempt-run-bridge-guide.md')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 中文标题并覆盖两个端点与鉴权边界
  动作: 打开 `docs/current/attempt-run-bridge-guide.md` 并阅读端点与鉴权节
  预期观察: 中文标题、POST 创建、GET 查询、internalAuthOrLoopback 与远端 Bearer 要求均清晰可见
  等待预算: 0s
  留证: node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'# attempt-run 桥接使用说明'"'"','"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Authorization: Bearer <CECELIA_INTERNAL_TOKEN>'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 恰好列出九项角色并说明 payload 必填字段
  动作: 阅读角色白名单与 payload 两节
  预期观察: 九个生产角色逐项列出，且 sprint_dir、base_repo、branch 标为必填
  等待预算: 0s
  留证: node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');const roles=['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'];const sec=(s.match(/## 角色白名单[\\s\\S]*?(?=\\n## |$)/)||['"'"''"'"'])[0];const got=[...sec.matchAll(/^- `([^`]+)`$/gm)].map(m=>m[1]);if(JSON.stringify(got)!==JSON.stringify(roles))process.exit(1);for(const f of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"'])if(!s.includes(f))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: base_sha 可省略并由生产 Brain 自解析
  动作: 阅读 payload 字段说明中的 base_sha 条目
  预期观察: 文档没有把 base_sha 写成必填，而是明确可省略及生产解析责任
  等待预算: 0s
  留证: node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'base_sha'"'"','"'"'可省略'"'"','"'"'生产 Brain 自解析'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 同时说明派发失败的三个终态
  动作: 阅读派发失败自动回滚一节
  预期观察: run、session、task 三个对象的终态一次性完整呈现
  等待预算: 0s
  留证: node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run→failed'"'"','"'"'session→closed'"'"','"'"'task→cancelled'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-1 Planner 分支保持服务端签发值
  动作: 核对本合同分支与 task bundle 的 propose_branch
  预期观察: 当前分支为服务端签发的 `cp-harness-propose-r1-2dc7be04-re9e94714-a1`
  等待预算: 0s
  留证: git branch 输出
  Test: manual:bash -c 'test "$(git branch --show-current)" = "cp-harness-propose-r1-2dc7be04-re9e94714-a1"'

- [ ] [BEHAVIOR] [L1] INV-2 凭据不硬编码且文档不泄露令牌值
  动作: 扫描目标文档的鉴权示例
  预期观察: 仅出现 CECELIA_INTERNAL_TOKEN 占位符，不出现 UUID 或长 token 字面值
  等待预算: 0s
  留证: node 扫描退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!s.includes('"'"'CECELIA_INTERNAL_TOKEN'"'"')||/Bearer [A-Za-z0-9_-]{24,}/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-3 端点鉴权契约未被遗漏
  动作: 核对两个端点说明均位于鉴权契约覆盖范围
  预期观察: 文档明确两个端点使用 internalAuthOrLoopback
  等待预算: 0s
  留证: node 断言退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!/POST[\\s\\S]*GET[\\s\\S]*internalAuthOrLoopback/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-4 不写死环境假设
  动作: 核对文档没有固化 token 值或 base_sha 值
  预期观察: token 使用环境变量占位，base_sha 明确由生产 Brain 解析
  等待预算: 0s
  留证: node 断言退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(/base_sha[^\\n]*[a-f0-9]{40}/.test(s)||/Bearer [A-Za-z0-9_-]{24,}/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-5 真环境接缝验收不适用
  动作: 确认本 sprint 只新增文档且不执行真实派发
  预期观察: 相对权威基线的产品范围只有目标文档
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'test "$(git diff --name-only 7a156f791feca8815bfabfbadce2ad874acf02af...HEAD -- docs/current packages apps | tr -d '"'"'\n'"'"')" = "docs/current/attempt-run-bridge-guide.md"'

- [ ] [BEHAVIOR] [L1] INV-6 验证命令退出码语义明确
  动作: 运行冻结测试
  预期观察: 文档未实现时测试非零，实施完成且内容正确后退出零
  等待预算: 30s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts'

