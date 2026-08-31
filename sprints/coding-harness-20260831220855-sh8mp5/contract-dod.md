---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 只新增 `docs/current/attempt-run-bridge-usage.md`；Harness 冻结合同产物不计入产品 diff，任何其他产品文件均失败。
**大小**: S

## Invariant 映射

- [端点鉴权] 文档必须明确两端点使用 `internalAuthOrLoopback`，宿主/远端携带 Bearer token。
- [凭据安全] 只展示环境变量名 `CECELIA_INTERNAL_TOKEN`，不得写真实 token。
- [环境假设] `base_sha` 明确由生产 Brain 自解析，不要求调用方猜测或写死。
- [真环境验证] N/A：本 sprint 不修改真实调用链或接缝，只新增说明文档。
- [Planner 分支] N/A：本 sprint 不修改 Planner 或分支签发行为。

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增唯一中文文档 `docs/current/attempt-run-bridge-usage.md`
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');if(!/[一-龥]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 产品 diff 相对权威基线仅含目标文档
  Test: bash -c 'git diff --name-only 0f52356135922cf5031406dae629211837c3de92...HEAD | grep -v "^sprints/coding-harness-20260831220855-sh8mp5/" | diff -u <(printf "%s\\n" docs/current/attempt-run-bridge-usage.md) -'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者区分创建与查询端点并获得鉴权规则
  动作: 打开 `docs/current/attempt-run-bridge-usage.md`，阅读端点与鉴权章节。
  预期观察: POST 明确用于创建/派发，GET 明确用于按 id 查询；两者使用 internalAuthOrLoopback，宿主/远端携带 Bearer CECELIA_INTERNAL_TOKEN。
  等待预算: 0s
  留证: 命令标准输出与目标文档路径
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-usage.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Bearer CECELIA_INTERNAL_TOKEN'"'"','"'"'宿主'"'"','"'"'远端'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 读者获得恰当的九项角色白名单
  动作: 阅读角色白名单章节并逐项核对生产角色。
  预期观察: 九项权威角色全部出现，不包含 commander 或 publisher。
  等待预算: 0s
  留证: 命令标准输出与白名单断言结果
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-usage.md'"'"','"'"'utf8'"'"');const r=['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'];for(const x of r)if(!s.includes('"'"'`'"'"'+x+'"'"'`'"'"'))process.exit(1);if(s.includes('"'"'`commander`'"'"')||s.includes('"'"'`publisher`'"'"'))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 读者正确填写 payload 并省略可选 base_sha
  动作: 阅读 payload 章节，核对必填字段与 base_sha 来源。
  预期观察: sprint_dir、base_repo、branch 均标为必填；base_sha 标为可省略且由生产 Brain 自解析。
  等待预算: 0s
  留证: 命令标准输出与字段语义断言结果
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-usage.md'"'"','"'"'utf8'"'"');for(const f of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"'])if(!new RegExp('"'"'`'"'"'+f+'"'"'`[^\\n]{0,40}必填'"'"').test(s))process.exit(1);if(!/`base_sha`[^\n]{0,50}可省略/.test(s)||!/生产 Brain[^\n]{0,40}自解析/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 读者理解派发失败后的自动回滚终态
  动作: 阅读派发失败自动回滚章节。
  预期观察: 文档逐项显示 run→failed、session→closed、task→cancelled。
  等待预算: 0s
  留证: 命令标准输出与三个终态断言结果
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-usage.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run→failed'"'"','"'"'session→closed'"'"','"'"'task→cancelled'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-05: 候选产品 diff 严格保持单文档范围
  动作: 相对冻结实现基线列出候选变更，只排除本 sprint 的 Harness 冻结合同目录。
  预期观察: 排除合同产物后仅剩 docs/current/attempt-run-bridge-usage.md；任何额外产品文件均失败。
  等待预算: 0s
  留证: `/tmp/attempt-run-product-files` 与 diff 输出
  Test: manual:bash -c 'git diff --name-only 0f52356135922cf5031406dae629211837c3de92...HEAD | grep -v "^sprints/coding-harness-20260831220855-sh8mp5/" > /tmp/attempt-run-product-files; printf "%s\\n" docs/current/attempt-run-bridge-usage.md | diff -u - /tmp/attempt-run-product-files'
