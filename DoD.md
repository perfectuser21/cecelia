# DoD — [SelfDrive] 24h任务成功率39%根因分析

## 任务目标
分析 229 条失败任务的根因，按 module/stage 分类，输出修复建议。

## 交付物

- [x] [ARTIFACT] 分析报告文件 `docs/learnings/cp-04072300-task-success-rate-analysis.md` 存在
  Test: `manual:node -e "require('fs').accessSync('docs/learnings/cp-04072300-task-success-rate-analysis.md')"`

- [x] [BEHAVIOR] 报告包含根因分类（pipeline_rescue storm + auth 失败）
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04072300-task-success-rate-analysis.md','utf8');if(!c.includes('pipeline_rescue'))process.exit(1)"`

- [x] [BEHAVIOR] 报告包含7天趋势数据
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04072300-task-success-rate-analysis.md','utf8');if(!c.includes('2026-04-05'))process.exit(1)"`

- [x] [BEHAVIOR] 报告包含修复建议
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04072300-task-success-rate-analysis.md','utf8');if(!c.includes('account3'))process.exit(1)"`

## 成功标准
分析报告输出，识别系统性故障根因，提报 P1 bug。
