---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在并固定精确 task_request_hash
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');if(!s.includes('fb7e86a156d48c9d342f74c8feee26cf570d7fed705eb39c86b41cd320c73050')||!/[\\u3400-\\u9fff]/u.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者可区分两个端点用途
  动作: 打开新增说明，查找 POST 创建端点与 GET 查询端点。
  预期观察: 两个端点分别有创建、查询用途说明，并写明共同鉴权中间件。
  等待预算: 0s
  留证: 文档内容断言命令输出
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-usage.md\",\"utf8\");for(const x of [\"POST /api/brain/harness/attempt-run\",\"GET /api/brain/harness/attempt-run/:id\",\"创建\",\"查询\",\"internalAuthOrLoopback\"])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-02: 读者可按调用位置正确鉴权
  动作: 阅读鉴权章节并检查 loopback、宿主和远端说明。
  预期观察: 宿主与远端被明确要求携带 Bearer CECELIA_INTERNAL_TOKEN，且无真实 token。
  等待预算: 0s
  留证: 文档内容断言命令输出
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-usage.md\",\"utf8\");for(const x of [\"宿主\",\"远端\",\"Bearer\",\"CECELIA_INTERNAL_TOKEN\"])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单恰为生产九项
  动作: 读取角色白名单章节的机器边界并逐项计数。
  预期观察: 列表恰含九个生产角色，无缺项、增项或改名。
  等待预算: 0s
  留证: 角色数组比对命令输出
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-usage.md\",\"utf8\");const b=s.match(/<!-- ROLE_LIST_START -->([\\s\\S]*?)<!-- ROLE_LIST_END -->/);if(!b)process.exit(1);const g=[...b[1].matchAll(/^- \\x60([^\\x60]+)\\x60$/gm)].map(x=>x[1]);const w=[\"canary\",\"planner\",\"proposer\",\"reviewer\",\"generator\",\"generator-fix\",\"evaluator\",\"evaluator-evidence-repair\",\"judge\"];if(JSON.stringify(g)!==JSON.stringify(w))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-04: payload 必填字段与 base_sha 省略语义准确
  动作: 阅读 payload 章节并核对四个字段的必填性描述。
  预期观察: sprint_dir、base_repo、branch 标为必填；base_sha 标为可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: 字段语义断言命令输出
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-usage.md\",\"utf8\");for(const x of [\"sprint_dir\",\"base_repo\",\"branch\",\"必填\",\"base_sha\",\"可省略\",\"生产 Brain\",\"自解析\"])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败自动回滚终态完整
  动作: 阅读失败回滚章节并核对三个资源终态。
  预期观察: 文档明确 run→failed、session→closed、task→cancelled。
  等待预算: 0s
  留证: 回滚终态断言命令输出
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-usage.md\",\"utf8\");for(const x of [\"run→failed\",\"session→closed\",\"task→cancelled\"])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-06: 精确 task_request_hash 可追溯
  动作: 从文档读取 task_request_hash 并与冻结 PRD 比对。
  预期观察: 文档只引用本任务的精确哈希值。
  等待预算: 0s
  留证: hash 字面比对命令输出
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-usage.md\",\"utf8\");if(!s.includes(\"fb7e86a156d48c9d342f74c8feee26cf570d7fed705eb39c86b41cd320c73050\"))process.exit(1)"'

## Invariant 映射

- [端点鉴权] 由 B-01、B-02 验证文档保留 `internalAuthOrLoopback` 与远端 Bearer 要求。
- [凭据安全] 由 ARTIFACT 与 B-02 验证仅出现环境变量名；真实值不得进入提交。
- [环境假设] 本任务不写死环境值；N/A。
- [真环境验证] 本任务不改变真实调用链；N/A。
- [Planner 分支] 本任务不修改 Planner 分支行为；N/A。
