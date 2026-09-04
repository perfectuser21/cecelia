---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

task_request_hash: 541dc1728c1cd6aed31701812cd4e8bdc2a35773bcaf39af521e12d23c1c7b7d

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档，不改产品代码、API、数据库或其他文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge-guide.md` 存在且标题为《attempt-run 桥接使用说明》
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('# attempt-run 桥接使用说明'))process.exit(1)"
- [ ] [ARTIFACT] 相对实现基线仅新增目标文档与冻结 sprint 合同产物
  Test: bash -c "test \"$(git diff --name-only 033e0feae6474eff023a3974a94a17ad0a6a53b9...HEAD | grep -vE '^(docs/current/attempt-run-bridge-guide\\.md|sprints/coding-harness-20260904093148-3cc0bn/)' | wc -l | tr -d ' ')\" -eq 0"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能识别两个端点用途与鉴权边界
  动作: 打开说明并阅读“端点与鉴权”一节。
  预期观察: 同时看到 POST 创建用途、GET 查询用途、internalAuthOrLoopback，以及宿主/远端 Bearer 要求。
  等待预算: 0s
  留证: 命令输出与最终文档正文
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Authorization: Bearer CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能获得完整九项角色白名单
  动作: 打开说明并阅读“角色白名单”一节。
  预期观察: 九项角色逐项出现，不以“等角色”省略。
  等待预算: 0s
  留证: 命令输出与九项角色清单
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'])if(!s.includes(x))process.exit(1);if(s.includes('"'"'等角色'"'"'))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能正确组装 payload
  动作: 打开说明并阅读“payload 字段”一节。
  预期观察: `sprint_dir`、`base_repo`、`branch` 标为必填，`base_sha` 明确可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: 命令输出与 payload 字段说明
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"','"'"'base_sha'"'"','"'"'可省略'"'"','"'"'生产 Brain 自解析'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能判断派发失败的完整回滚终态
  动作: 打开说明并阅读“派发失败自动回滚”一节。
  预期观察: 同时看到 run、session、task 三类资源对应 failed、closed、cancelled 终态。
  等待预算: 0s
  留证: 命令输出与三资源回滚说明
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run→failed'"'"','"'"'session→closed'"'"','"'"'task→cancelled'"'"'])if(!s.includes(x))process.exit(1)"'

## Invariant 覆盖

- 分支归属：N/A，本角色使用服务端签发的 proposer 分支，未切换 planner 工作区。
- 实现基线：由 E2E diff 检查固定对比 `033e0feae6474eff023a3974a94a17ad0a6a53b9`。
- 凭据安全：文档仅写环境变量名，不含 token 值；`rg -n 'Bearer [A-Za-z0-9_-]{20,}' docs/current/attempt-run-bridge-guide.md` 必须无匹配。
- 端点鉴权：B-01 要求两个端点的 `internalAuthOrLoopback` 与 Bearer 规则均出现。
- 真环境验证：N/A，本 sprint 不改变或执行真实链路，仅记录生产合同。
