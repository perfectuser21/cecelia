---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 只新增 `docs/current/attempt-run-bridge-guide.md` 中文文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge-guide.md` 存在，且为中文说明页
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('# attempt-run 桥接使用说明'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 目标中文文档存在且包含两个端点用途与鉴权
  动作: 打开 `docs/current/attempt-run-bridge-guide.md`，阅读“端点用途与鉴权”一节
  预期观察: 能看到 POST 异步派发、GET 轮询结果、internalAuthOrLoopback 与宿主/远端 Bearer token 要求
  等待预算: 0s
  留证: 命令输出与目标文档路径
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Authorization: Bearer \$CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 完整列出九项角色白名单
  动作: 阅读“角色白名单”一节并逐项核对
  预期观察: 九项角色全部出现，计数为九项
  等待预算: 0s
  留证: 命令输出与角色列表
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'])if(!s.includes('"'"'`'"'"'+x+'"'"'`'"'"'))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 说明 payload 必填字段及 base_sha 省略语义
  动作: 阅读“payload 字段”一节
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 明确可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: 命令输出与字段说明
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"','"'"'base_sha'"'"','"'"'生产 Brain'"'"','"'"'可省略'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 说明派发失败自动回滚的三组终态
  动作: 阅读“派发失败自动回滚”一节
  预期观察: 派发抛错或非 LAUNCHED 时，新建 run、session、task 分别进入 failed、closed、cancelled
  等待预算: 0s
  留证: 命令输出与回滚状态表
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run → failed'"'"','"'"'session → closed'"'"','"'"'task → cancelled'"'"','"'"'LAUNCHED'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-05: 实现范围不包含代码改动
  动作: 对比冻结实现基线与当前提交的变更路径
  预期观察: 除目标文档和本 Sprint 合同产物外无变更
  等待预算: 0s
  留证: `git diff --name-only` 输出
  Test: manual:bash -c 'node -e "const{execFileSync}=require('"'"'child_process'"'"');const files=execFileSync('"'"'git'"'"',['"'"'diff'"'"','"'"'--name-only'"'"','"'"'5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD'"'"'],{encoding:'"'"'utf8'"'"'}).trim().split('"'"'\n'"'"').filter(Boolean);if(files.some(f=>f!=='"'"'docs/current/attempt-run-bridge-guide.md'"'"'&&!f.startsWith('"'"'sprints/coding-harness-20260831142046-muda2u/'"'"')))process.exit(1)"'

## 铁律映射

- 语言铁律：B-01 至 B-04 验证中文文档及四节事实。
- 分支与提交铁律：在 `cp-harness-propose-r1-ffd928a0-rcc743f54-a1` 上产出，不操作 main。
- Brain DevGate：N/A，本 Sprint 不修改 `packages/brain`。
- Bug failing test：N/A，本任务为新增文档，不是 bug 修复；仍提供冻结 Red 测试锁定验收。
- 凭据铁律：文档仅引用环境变量名，不写入 token 值。
