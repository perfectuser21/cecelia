# DoD：executor.js 两个机械 bug 修复

Brain task: ff3a8ec2-4f1e-40f4-a746-db97d22742e7
分支: cp-0603091820-executor-claim-report-fix

## Bug A — claim 锁泄漏（重启后任务死锁 queued）

- [x] [ARTIFACT] `syncOrphanTasksOnStartup` 的 harness_initiative requeue UPDATE 清空 claim 三件套
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('claimed_by = NULL'))process.exit(1)"
- [x] [BEHAVIOR] requeue 分支 UPDATE 同时设 claimed_by/claimed_at/started_at = NULL（防 dispatch-helpers `AND claimed_by IS NULL` 永选不出该任务）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');const m=c.match(/LANGGRAPH_TYPES\.has\(task\.task_type\)[\s\S]{0,600}?resume_from_checkpoint: true/);if(!m||!/claimed_by = NULL/.test(m[0])||!/claimed_at = NULL/.test(m[0])||!/started_at = NULL/.test(m[0]))process.exit(1)"

## Bug B — report 用 slash command（容器内空 SKILL 静默降级）

- [x] [ARTIFACT] `_prepareHarnessReportPrompt` 的 harness_report 路径改用 `loadSkillContent('harness-report')` inline SKILL
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"loadSkillContent('harness-report')\"))process.exit(1)"
- [x] [BEHAVIOR] executor.js import harness-shared 且 harness_report 路径调用 loadSkillContent('harness-report')，prompt 不再以裸 slash 开头
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!/loadSkillContent\(['\"]harness-report['\"]\)/.test(c)||!/from '\.\/harness-shared\.js'/.test(c))process.exit(1)"

## 验收

- [x] failing test 先 commit（commit-1 RED），修复让 test 变绿（commit-2 GREEN）
- [x] 两个 regression test 永久留 CI：executor-startup-sync.test.js（Bug A）+ executor-report-prompt.test.js（Bug B）
- [x] Brain 版本四处同步 bump（1.230.15 → 1.230.16）
- [x] DevGate 通过（facts-check / version-sync）
- [x] 本地 brain-unit 相关测试全绿（CI 全绿由 engine-pr-watchdog 轮询确认）
