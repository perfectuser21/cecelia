---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文件位于约定路径
  Test: node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者找到中文说明与四个主题节
  动作: 从候选 Git 树打开 `docs/current/attempt-run-bridge-guide.md`
  预期观察: 文档为中文，并清楚分出端点用途、鉴权方式、角色白名单、payload 与失败回滚四节
  等待预算: 0s
  留证: node 检查输出与候选 SHA
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1);for(const h of ["端点用途","鉴权方式","角色白名单","payload 与失败回滚"])if(!s.includes(h))process.exit(1)'\'''

- [ ] [BEHAVIOR] [L2] B-02: 两个端点用途和远端 Bearer 鉴权准确
  动作: 阅读端点用途与鉴权节，按宿主或远端调用场景核对请求要求
  预期观察: POST 被说明为派发、GET 被说明为查询，且宿主/远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`
  等待预算: 0s
  留证: node 检查输出
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["POST /api/brain/harness/attempt-run","GET /api/brain/harness/attempt-run/:id","internalAuthOrLoopback","Bearer CECELIA_INTERNAL_TOKEN","派发","查询"])if(!s.includes(x))process.exit(1)'\'''

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单严格等于权威九项闭集
  动作: 从文档角色白名单逐项读取角色并与冻结路由合同核对
  预期观察: 顺序与集合严格为 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge，无额外角色
  等待预算: 0s
  留证: node 闭集比较输出
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");const got=[...s.matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)].map(x=>x[1]).filter(x=>!["sprint_dir","base_repo","branch","base_sha"].includes(x));const want=["canary","planner","proposer","reviewer","generator","generator-fix","evaluator","evaluator-evidence-repair","judge"];if(JSON.stringify(got)!==JSON.stringify(want))process.exit(1)'\'''

- [ ] [BEHAVIOR] [L2] B-04: payload 必填与可选字段边界准确
  动作: 按文档构造派发 payload，区分三个必填字段与可省略的 base_sha
  预期观察: sprint_dir、base_repo、branch 被标为必填；base_sha 被标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: node 检查输出
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["`sprint_dir`（必填）","`base_repo`（必填）","`branch`（必填）","`base_sha`（可省略）","生产 Brain 自解析"])if(!s.includes(x))process.exit(1)'\'''

- [ ] [BEHAVIOR] [L2] B-05: 派发失败回滚三对象终态完整
  动作: 阅读派发失败段并逐一核对 run、session、task 的回滚终态
  预期观察: 文档同时说明 run → failed、session → closed、task → cancelled
  等待预算: 0s
  留证: node 检查输出
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["run → `failed`","session → `closed`","task → `cancelled`"])if(!s.includes(x))process.exit(1)'\'''

- [ ] [BEHAVIOR] [L2] B-06: 唯一产品交付文件是桥接说明
  动作: 相对冻结实现基线检查候选变更并排除本 sprint 的合同产物
  预期观察: 产品变更集合严格等于 docs/current/attempt-run-bridge-guide.md，不含代码或配置
  等待预算: 0s
  留证: git diff --name-only 输出
  Test: manual:bash -c 'FILES=$(git diff --name-only 109d1df64cdc68fbec8852c3ad2d0e3291e648ef...HEAD | grep -v "^sprints/coding-harness-20260901070958-avqlef/" || :); [ "$FILES" = "docs/current/attempt-run-bridge-guide.md" ]'

## Invariant 映射

- INV-1 端点鉴权：B-02 明确 `internalAuthOrLoopback` 与宿主/远端 Bearer 要求。
- INV-2 凭据安全：ARTIFACT 与 E2E 只检查环境变量名称，不允许真实 token 值。
- INV-3 日志脱敏：N/A，本任务不产生日志或处理 PII。
- INV-4 分支归属：N/A，本 proposer 使用服务端签发分支，文档功能不改变分支流程。
- INV-5 验证命令：冻结测试和合同自查实跑并保留 exit code 证据。
- INV-6 真环境验证：N/A，静态文档无真实调用方接缝。
- INV-7 共享文件禁区：B-06 将产品变更闭集限制为唯一授权文档。

