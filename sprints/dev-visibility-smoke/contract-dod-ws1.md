---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: smoke-verify.sh 冒烟脚本

**范围**: 创建 `sprints/dev-visibility-smoke/smoke-verify.sh`，端到端验证 buildGeneratorPrompt PRD 注入行为 + sprint-prd.md 存在性
**大小**: S（< 70 行）
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `sprints/dev-visibility-smoke/smoke-verify.sh` 文件存在
  Test: node -e "require('fs').accessSync('sprints/dev-visibility-smoke/smoke-verify.sh')" && echo OK

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] smoke-verify.sh 内容含 `## Sprint PRD` 关键词检查逻辑（非空实现）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/smoke-verify.sh\",\"utf8\");if(!c.includes(\"Sprint PRD\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] smoke-verify.sh 内容含 sprint-prd.md 存在性验证（-s 或 existsSync 检查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/smoke-verify.sh\",\"utf8\");if(!c.includes(\"sprint-prd.md\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] bash smoke-verify.sh 执行退出码为 0（所有冒烟检查通过）
  Test: manual:bash -c 'bash sprints/dev-visibility-smoke/smoke-verify.sh && echo OK || { echo FAIL; exit 1; }'
  期望: OK

- [x] [BEHAVIOR] smoke-verify.sh 内含 harness-utils.js prdContent 注入验证（两项关键词均须存在）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/smoke-verify.sh\",\"utf8\");if(!c.includes(\"prdContent\"))process.exit(1);if(!c.includes(\"harness-utils\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] Brain tasks 表有本次 task_id 记录且 status = completed 或 in_progress（GET /api/brain/tasks/$TASK_ID + jq-e 精确匹配）
  Test: manual:bash -c 'node -e "const{execSync}=require(\"child_process\");try{execSync(\"curl -sf localhost:5221/api/brain/health\",{stdio:\"ignore\"})}catch(e){process.exit(0)};var id=process.env.TASK_ID;if(!id)process.exit(0);try{var r=execSync(\"curl -sf localhost:5221/api/brain/tasks/\"+id).toString();var s=JSON.parse(r).status;if(s!==\"completed\"&&s!==\"in_progress\")process.exit(1)}catch(e){process.exit(1)}"'
  期望: OK（Brain 在线且本次 task_id status=completed 或 in_progress）或 SKIP（Brain 不在线时冒烟不强制）
  注意：Brain 在线但 status=pending/failed/error → exit 1（不可用 SKIP 掩盖）
