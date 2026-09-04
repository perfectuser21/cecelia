---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档是唯一实现交付物
  Test: `git diff --name-only bdaca81b5cbf78929fa3d8eeac2a24cae6113b98...HEAD` 分类后 `docs/current/*.md` 恰好一个、代码文件为零、范围外文件为零

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 两个端点、用途与鉴权边界完整
  动作: 读者打开说明的“端点与鉴权”章节，选择创建或查询入口。
  预期观察: 同时看到 POST 创建、GET 查询、internalAuthOrLoopback 及宿主/远端 Bearer token 要求，且没有远端免鉴权表述。
  等待预算: 0s
  留证: 命令输出 `B-01 OK`
  Test: manual:bash -c 'node -e '\''const t=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8"); for(const x of ["POST /api/brain/harness/attempt-run","创建","GET /api/brain/harness/attempt-run/:id","查询","internalAuthOrLoopback","Bearer CECELIA_INTERNAL_TOKEN"]) if(!t.includes(x)) process.exit(1); if(/宿主或远端.{0,12}(无需|免)鉴权/.test(t)) process.exit(1); console.log("B-01 OK")'\'''

- [ ] [BEHAVIOR] [L2] B-02: 角色白名单恰好九项且无额外角色
  动作: 读者查看“角色白名单”章节并逐项选择角色。
  预期观察: 封闭清单只含 planner、proposer、proposer-critic、generator、generator-critic、evaluator、evaluator-critic、reporter、reporter-critic，计数恰好九。
  等待预算: 0s
  留证: 命令输出 `B-02 OK roles=9`
  Test: manual:bash -c 'node -e '\''const t=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8"),s=t.split("## 角色白名单")[1]?.split("## payload 与实现基线")[0]||"",a=[...s.matchAll(/`([a-z-]+)`/g)].map(x=>x[1]).sort(),e=["evaluator","evaluator-critic","generator","generator-critic","planner","proposer","proposer-critic","reporter","reporter-critic"]; if(a.length!==9||JSON.stringify(a)!==JSON.stringify(e)) process.exit(1); console.log("B-02 OK roles=9")'\'''

- [ ] [BEHAVIOR] [L2] B-03: payload 必填字段与 base_sha 基线规则完整
  动作: 读者按“payload 与实现基线”章节组装请求。
  预期观察: 必填封闭清单恰好为 sprint_dir、base_repo、branch；base_sha 可省略并由生产 Brain 自解析，且 workspace base SHA 不替代不变的实现基线。
  等待预算: 0s
  留证: 命令输出 `B-03 OK required=3`
  Test: manual:bash -c 'node -e '\''const t=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8"),s=t.split("## payload 与实现基线")[1]?.split("## 派发失败自动回滚")[0]||"",a=[...s.matchAll(/^\\s*- `([^`]+)`：必填/mg)].map(x=>x[1]).sort(); if(JSON.stringify(a)!==JSON.stringify(["base_repo","branch","sprint_dir"])) process.exit(1); for(const x of ["`base_sha` 可省略","生产 Brain","实现基线","保持不变","workspace","不得替代"]) if(!s.includes(x)) process.exit(1); if(/`base_sha`：必填|角色切换可重置实现基线/.test(s)) process.exit(1); console.log("B-03 OK required=3")'\'''

- [ ] [BEHAVIOR] [L2] B-04: 派发失败回滚三对象终态完整
  动作: 读者查看派发失败出口。
  预期观察: 只得到 run→failed、session→closed、task→cancelled 三项完整终态，且不被描述为部分成功。
  等待预算: 0s
  留证: 命令输出 `B-04 OK rollback=3`
  Test: manual:bash -c 'node -e '\''const t=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8"),s=t.split("## 派发失败自动回滚")[1]||""; for(const x of ["run→failed","session→closed","task→cancelled"]) if(s.split(x).length-1!==1) process.exit(1); if(s.includes("部分成功")) process.exit(1); console.log("B-04 OK rollback=3")'\'''

- [ ] [BEHAVIOR] [L2] B-05: canonical 全仓差异严格限制为单文档实现
  动作: evaluator 从冻结实现基线计算候选 HEAD 的全仓三点 diff。
  预期观察: docs/current 实现文档恰好一份，除本 Sprint 合同资产外无其他文件，代码改动为零。
  等待预算: 0s
  留证: canonical `git diff --name-only` 完整输出
  Test: manual:bash -c 'BASE=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; SD=sprints/coding-harness-20260904034439-v1423a; mapfile -t F < <(git diff --name-only "$BASE"...HEAD); D=0; O=0; for f in "${F[@]}"; do case "$f" in docs/current/*.md) D=$((D+1));; "$SD"/contract-draft.md|"$SD"/contract-dod.md|"$SD"/task-plan.json|"$SD"/tests/*.test.ts) ;; *) O=$((O+1));; esac; done; [ "$D" -eq 1 ] && [ "$O" -eq 0 ] && ! printf "%s\\n" "${F[@]}" | grep -E "\\.(js|cjs|mjs|ts|tsx|jsx|py|sql)$" | grep -v "^$SD/tests/"'

## Invariant 映射

- INV-1 N/A：规划分支铁律覆盖 Planner workspace 与分支切换逻辑，本 Sprint 不触及；B-05 代码零改动 oracle 证明范围未越界。
- INV-2 N/A：权威地址铁律覆盖 Dispatcher、Fleet Worker 与 HARNESS_BRAIN_URL，本 Sprint 不触及；B-05 代码零改动 oracle 证明范围未越界。
