---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改产品代码、配置或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品交付文件是中文说明页
  Test: node -e 'const fs=require("fs");const p="docs/current/attempt-run-bridge-guide.md";const s=fs.readFileSync(p,"utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者看到两个端点的用途
  动作: 打开 `docs/current/attempt-run-bridge-guide.md`，阅读端点说明。
  预期观察: POST 被说明为创建并派发 attempt，GET 被说明为按 id 查询状态。
  等待预算: 0s
  留证: 命令输出中的 `OK endpoints`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["## 端点与鉴权","POST /api/brain/harness/attempt-run","创建","派发","GET /api/brain/harness/attempt-run/:id","查询"])if(!s.includes(x))throw new Error(x);console.log("OK endpoints")'\'''

- [ ] [BEHAVIOR] [L1] B-02: 读者看到宿主与远端鉴权合同
  动作: 阅读鉴权章节并检查调用示例。
  预期观察: 文档说明 internalAuthOrLoopback，宿主或远端必须携带 Bearer CECELIA_INTERNAL_TOKEN，且没有真实 token。
  等待预算: 0s
  留证: 命令输出中的 `OK auth`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["internalAuthOrLoopback","Authorization: Bearer $CECELIA_INTERNAL_TOKEN","宿主","远端","必须"])if(!s.includes(x))throw new Error(x);if(/Authorization:\\s*Bearer\\s+(?!\\$CECELIA_INTERNAL_TOKEN)[A-Za-z0-9_.-]{32,}/.test(s))throw new Error("token leak");console.log("OK auth")'\'''

- [ ] [BEHAVIOR] [L1] B-03: 读者看到九项角色白名单
  动作: 阅读角色白名单章节并逐项核对。
  预期观察: 文档明确白名单且逐项包含 planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、judge、reporter。
  等待预算: 0s
  留证: 命令输出中的 `OK roles=9`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");const a=["planner","proposer","critic","generator","generator-fix","evaluator","evaluator-fix","judge","reporter"];if(!s.includes("## 角色白名单"))throw new Error("角色白名单章节");for(const x of a)if(!s.includes(x))throw new Error(x);console.log("OK roles=9")'\'''

- [ ] [BEHAVIOR] [L1] B-04: 读者能区分 payload 必填与可选字段
  动作: 阅读 payload 章节并据此构造请求。
  预期观察: sprint_dir、base_repo、branch 被标为必填；base_sha 被标为可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: 命令输出中的 `OK payload`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["## payload 字段","sprint_dir","base_repo","branch","必填","base_sha","可省略","生产 Brain","自解析"])if(!s.includes(x))throw new Error(x);console.log("OK payload")'\'''

- [ ] [BEHAVIOR] [L1] B-05: 读者识别派发失败的完整自动回滚
  动作: 阅读失败处理章节并核对三类对象终态。
  预期观察: 文档同时说明 run → failed、session → closed、task → cancelled。
  等待预算: 0s
  留证: 命令输出中的 `OK rollback`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8").replace(/`/g,"").replace(/\\s+/g," ");for(const r of [/## 派发失败自动回滚/,/run\\s*(?:→|->)\\s*failed/,/session\\s*(?:→|->)\\s*closed/,/task\\s*(?:→|->)\\s*cancelled/])if(!r.test(s))throw new Error(String(r));console.log("OK rollback")'\'''

- [ ] [BEHAVIOR] [L1] B-06: 产品交付范围没有越过唯一文档
  动作: 将候选 HEAD 与冻结 implementation baseline 比较产品目录变更。
  预期观察: `docs/current`、`packages`、`apps` 范围内只出现 `docs/current/attempt-run-bridge-guide.md`。
  等待预算: 0s
  留证: 命令输出中的唯一文件路径。
  Test: manual:bash -c 'git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750...HEAD -- docs/current packages apps | node -e '\''let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=s.trim().split(/\\n/).filter(Boolean);if(JSON.stringify(a)!==JSON.stringify(["docs/current/attempt-run-bridge-guide.md"]))process.exit(1);console.log(a[0])})'\'''

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 凭据安全不回退
  动作: 检查文档中的 Authorization 示例。
  预期观察: 只使用 `$CECELIA_INTERNAL_TOKEN` 占位符，不出现疑似真实 Bearer token。
  等待预算: 0s
  留证: 命令输出中的 `OK secret-safe`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(!s.includes("Authorization: Bearer $CECELIA_INTERNAL_TOKEN"))process.exit(1);if(/Authorization:\\s*Bearer\\s+(?!\\$CECELIA_INTERNAL_TOKEN)[A-Za-z0-9_.-]{32,}/.test(s))process.exit(1);console.log("OK secret-safe")'\'''

- [ ] [BEHAVIOR] [L1] INV-2: 端点鉴权不回退
  动作: 检查两个端点的鉴权章节。
  预期观察: 文档明确两端点采用 `internalAuthOrLoopback`，非 loopback 调用不能被描述为匿名可访问。
  等待预算: 0s
  留证: 命令输出中的 `OK auth-invariant`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const x of ["internalAuthOrLoopback","宿主","远端","必须","Authorization: Bearer $CECELIA_INTERNAL_TOKEN"])if(!s.includes(x))process.exit(1);console.log("OK auth-invariant")'\'''

- [ ] [BEHAVIOR] [L1] INV-3: 环境值不写死
  动作: 检查 token 的表达方式。
  预期观察: token 来自环境变量，文档不提供固定密钥值。
  等待预算: 0s
  留证: 命令输出中的 `OK env-derived`。
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(!s.includes("CECELIA_INTERNAL_TOKEN"))process.exit(1);if(/Bearer\\s+[A-Za-z0-9_.-]{32,}/.test(s.replace("Bearer $CECELIA_INTERNAL_TOKEN","")))process.exit(1);console.log("OK env-derived")'\'''

- INV-4 Planner 分支：N/A，本 Sprint 不执行或描述 Planner 分支切换。
