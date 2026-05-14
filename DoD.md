contract_branch: cp-05141706-ws-ec8811e7-ws1
workstream_index: 1
sprint_dir: sprints/w49-b37-validation

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 创建 verify-b37.sh 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh`，含 ≥4 断言，脚本运行 exit 0 输出 "B37 验证全部通过"
**大小**: S(<100行)
**依赖**: 无（sprint-prd.md 由 Planner 提前创建，sprint-contract.md 由 Proposer 提前创建）

## ARTIFACT 条目（预条件 + Generator 产出物）

- [x] [ARTIFACT] `sprints/w49-b37-validation/sprint-prd.md` 存在（planner 产出，验证起点预条件）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-prd.md');console.log('OK')"

- [x] [ARTIFACT] `sprints/w49-b37-validation/sprint-contract.md` 存在（proposer 产出，parsePrdNode B37 fix 生效的直接证明）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-contract.md');console.log('OK')"

- [x] [ARTIFACT] `sprints/w49-b37-validation/verify-b37.sh` 存在（generator 产出；运行时 PASS 计数由 BEHAVIOR 3 校验）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/verify-b37.sh');console.log('OK')"

## BEHAVIOR 条目（内嵌可独立执行的 manual:bash 命令，evaluator 直接执行）

- [x] [BEHAVIOR] `git diff --name-only origin/main HEAD -- sprints/` 输出含 `sprints/w49-b37-validation/` 路径（B37 git diff 逻辑运行时验证）
  Test: manual:bash -c 'git fetch --depth=1 origin main 2>/dev/null; diff=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null) && test "${diff#*sprints/w49-b37-validation/}" != "$diff" && printf OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] `bash verify-b37.sh` exit 0 且 stdout 含 "B37 验证全部通过"（全链路运行时验证）
  Test: manual:bash sprints/w49-b37-validation/verify-b37.sh
  期望: exit 0

- [x] [BEHAVIOR] `bash verify-b37.sh` 输出 ≥4 条 `✅ PASS` 断言（脚本覆盖全部关键检查点）
  Test: manual:bash -c 'out=$(bash sprints/w49-b37-validation/verify-b37.sh 2>&1) && n=0 && r="$out" && while [ "${r}" != "${r%%✅ PASS*}" ]; do n=$((n+1)); r="${r#*✅ PASS}"; done && [ $n -ge 4 ] && printf Ok || exit 1'
  期望: Ok

- [x] [BEHAVIOR] Brain Docker 日志（动态查找容器名）无 ENOENT 关联 w49-b37-validation（全程无目录查找失败）
  Test: manual:bash -c 'node -e "const{spawnSync}=require(\"child_process\"),r=spawnSync(\"docker\",[\"ps\",\"--filter\",\"name=brain\",\"--format\",\"{{.Names}}\"],{encoding:\"utf8\"}),c=(r.stdout?r.stdout:\"\").trim().split(\"\\n\")[0],_=!c?(process.stdout.write(\"SKIP\"),process.exit(0)):null,l=spawnSync(\"docker\",[\"logs\",c],{encoding:\"utf8\",stdio:[\"pipe\",\"pipe\",\"pipe\"]}),m=((l.stderr?l.stderr:\"\")+(l.stdout?l.stdout:\"\")).match(/ENOENT.*w49-b37-validation/),__=m?process.exit(1):process.stdout.write(\"OK\")"'
  期望: OK（或 SKIP 若容器未运行）
