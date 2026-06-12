contract_branch: cp-harness-propose-r5-60728100
sprint_dir: sprints/06120546-report-scriptize-r3

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness-report.mjs 脚本化 + 宿主 git 零接触（R3）

**范围**: `packages/brain/scripts/harness-report.mjs` 新建（7 步顺序 CLI 脚本）+ vitest 单测 + reportNode spawn 路径改接本脚本
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/scripts/harness-report.mjs` 存在且为有效 ESM 模块
  Test: node -e "import('packages/brain/scripts/harness-report.mjs').catch(e=>{ if(!e.message.includes('missing argument'))process.exit(1) })"

- [ ] [ARTIFACT] `packages/brain/scripts/__tests__/harness-report.test.mjs` 存在且含 describe 块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/__tests__/harness-report.test.mjs','utf8');if(!c.includes('describe'))process.exit(1)"

- [ ] [ARTIFACT] `harness-initiative.graph.js` reportNode 含 `harness-report.mjs` spawn 调用路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('harness-report.mjs'))process.exit(1)"

- [ ] [ARTIFACT] `harness-report.mjs` awk 修复 + thickness 枚举正确
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8'); if(c.includes(\"awk '{print \$1}'\"))throw new Error('awk $1 found'); if(c.includes('\"thickness\":\"done\"')||c.includes(\"'thickness':'done'\"))throw new Error('invalid thickness done'); console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] S2 harness-report.md 存在且含摘要关键字
- [ ] [BEHAVIOR] S3+S4 learning.md + index.html 存在
- [ ] [BEHAVIOR] S5 tasks.result->>pr_url 非空
- [ ] [BEHAVIOR] S6 journey_features.status = done
- [ ] [BEHAVIOR] S7 notes 5 分钟内新增记录
- [ ] [BEHAVIOR] 幂等性：重复执行第二次 exit 0
- [ ] [BEHAVIOR] git 零接触
- [ ] [BEHAVIOR] PARTIAL_FAIL：Brain API 不可达时文件仍生成，exit 非零
- [ ] [BEHAVIOR] 降级报告：evaluator-output.json 缺失时 harness-report.md 含 N/A
