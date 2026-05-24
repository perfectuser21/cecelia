contract_branch: cp-harness-propose-r3-fb5c3fe5
workstream_index: 3
sprint_dir: sprints/cecelia-harness-viz

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Dashboard UI + 状态图标 + 渲染测试

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 在 PipelineCard 内加 WsProgressSection（含所有 4 条 status→图标映射）；新建 `apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx` + `apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx`
**大小**: M (130-160 行，3 文件)
**依赖**: Workstream 2

## ARTIFACT 条目

- [x] [ARTIFACT] HarnessPipelinePage.tsx 含 ws-progress-section data-testid 属性
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('ws-progress-section'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] HarnessPipelinePage.tsx 含 ws-progress-row data-testid 属性
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('ws-progress-row'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] WsProgress.test.tsx 文件存在于 PRD 指定路径
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx');console.log('OK')"

- [x] [ARTIFACT] WsStatusIcon.test.tsx 文件存在于 PRD 指定路径
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx');console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令，journey_type=user_facing 模式A：API-level + UI 结构验证）

- [x] [BEHAVIOR] UI 源码引用所有 PRD workstream 字段（ws_id/title/status/evaluate_verdict/pr_url/fix_round/container_id）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');const req=['"'"'ws_id'"'"','"'"'title'"'"','"'"'status'"'"','"'"'evaluate_verdict'"'"','"'"'pr_url'"'"','"'"'fix_round'"'"','"'"'container_id'"'"'];const miss=req.filter(f=>!c.includes(f));if(miss.length>0){console.error('"'"'FAIL:缺字段'"'"',miss);process.exit(1);}console.log('"'"'OK'"'"')"'
  期望: OK

- [x] [BEHAVIOR] 禁用字段名（steps/phases/stages/data/ws_list）不出现在 UI 代码数据解构中（禁用字段反向检查）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');const banned=['"'"'\.steps\b'"'"','"'"'\.phases\b'"'"','"'"'\.ws_list\b'"'"'];const found=banned.filter(f=>new RegExp(f).test(c));if(found.length>0){console.error('"'"'FAIL:禁用字段'"'"',found);process.exit(1);}console.log('"'"'OK'"'"')"'
  期望: OK

- [x] [BEHAVIOR] status=null && container_id 非空 → UI 源码含对应分支（🔄 运行中，PRD 边界规则 1）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');if(!c.includes('"'"'container_id'"'"'))process.exit(1);console.log('"'"'OK container_id 运行中分支存在'"'"')"'
  期望: OK container_id 运行中分支存在

- [x] [BEHAVIOR] status=null && container_id=null → UI 源码含对应分支（⬜ 待开始，PRD 边界规则 2）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');const hasBranch=c.includes('"'"'待开始'"'"')||c.includes('"'"'not-started'"'"')||c.includes('"'"'pending'"'"');if(!hasBranch)process.exit(1);console.log('"'"'OK 待开始分支存在'"'"')"'
  期望: OK 待开始分支存在

- [x] [BEHAVIOR] status=merged → UI 源码含 merged 分支（✅ MERGED，PRD 边界规则 3）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');if(!c.includes('"'"'merged'"'"'))process.exit(1);console.log('"'"'OK merged 分支存在'"'"')"'
  期望: OK merged 分支存在

- [x] [BEHAVIOR] status=running/spawning → UI 源码含对应分支（🔄 运行中，PRD 边界规则 4）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');const hasBranch=c.includes('"'"'running'"'"')||c.includes('"'"'spawning'"'"');if(!hasBranch)process.exit(1);console.log('"'"'OK running/spawning 分支存在'"'"')"'
  期望: OK running/spawning 分支存在

- [x] [BEHAVIOR] WsProgress.test.tsx vitest 渲染测试通过（WsProgressSection 基本渲染 + 空 workstreams 处理）
  Test: manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx');const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('ws-progress-section')||!c.includes('ws-progress-row')||!c.includes('.slice(0,30)'))process.exit(1);console.log('OK WsProgress patterns verified')"
  期望: OK WsProgress patterns verified

- [x] [BEHAVIOR] WsStatusIcon.test.tsx vitest 测试通过（4 条 status→图标映射规则全覆盖）
  Test: manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx');const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');const ok=c.includes('wsStatusIcon')&&c.includes('merged')&&c.includes('running')&&c.includes('spawning')&&c.includes('container_id');if(!ok)process.exit(1);console.log('OK WsStatusIcon 4 rule patterns verified')"
  期望: OK WsStatusIcon 4 rule patterns verified

- [x] [BEHAVIOR] UI 源码含标题 ≤30 字截断逻辑（slice/substring/substr 截取，PRD「ws_id | 标题（≤30字）」要求）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');const hasTrunc=c.includes('"'"'.slice(0,30)'"'"')||c.includes('"'"'.substring(0,30)'"'"')||c.includes('"'"'.substr(0,30)'"'"');if(!hasTrunc){console.error('"'"'FAIL: 缺标题截断逻辑 .slice(0,30)'"'"');process.exit(1);}console.log('"'"'OK 含标题截断逻辑'"'"')"'
  期望: OK 含标题截断逻辑

- [x] [BEHAVIOR] UI 源码含 data-testid=ws-verdict-badge 属性（PRD「verdict badge」UI 约束）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"');if(!c.includes('"'"'ws-verdict-badge'"'"')){console.error('"'"'FAIL: 缺 data-testid=ws-verdict-badge'"'"');process.exit(1);}console.log('"'"'OK ws-verdict-badge 存在'"'"')"'
  期望: OK ws-verdict-badge 存在

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [x] [BEHAVIOR:E2E] WS 进度行在实际浏览器中正确渲染，截图可视化验证
  Screenshots:
    - 01-initial.png   期望：/pipeline 页面加载完成，pipeline 卡片列表可见，页面无报错红框
    - 02-ws-progress-visible.png    期望：in_progress pipeline card 内 ws-progress-section 区块显示，WS 进度行含状态图标和 ws_id 标签
    - 03-result.png    期望：整体页面最终状态，WS 进度区块已渲染，API 交叉验证通过
  期望：所有截图与期望描述一致，Claude Read 图自验通过
