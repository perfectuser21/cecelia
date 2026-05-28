contract_branch: cp-harness-propose-r3-99e1f58e
workstream_index: 4
sprint_dir: sprints/cecelia-sprint-visibility-0528

---
skeleton: false
journey_type: backend
---
# Contract DoD — Workstream 4 (Brain task): tick-runner.js 死任务自动重置

**范围**: packages/brain/src/tick-runner.js 新增死任务扫描逻辑：查询 execution_attempts=0 AND status IN ('in_progress','queued') AND updated_at < NOW()-INTERVAL '10 minutes'，批量 UPDATE status='queued', claimed_by=NULL, claimed_at=NULL, started_at=NULL；打印日志 "[tick] Reset N dead task(s)"；任务 79710a5d 因此逻辑自动被重置
**大小**: S（~20 行，1 文件）

## ARTIFACT 条目

- [x] [ARTIFACT] packages/brain/src/tick-runner.js 含 execution_attempts 扫描条件（line 1298）
- [x] [ARTIFACT] tick-runner.js 死任务 UPDATE 含 status='queued' 重置（line 1297）
- [x] [ARTIFACT] tick-runner.js 含死任务日志打印（line 1304: "Reset N dead task(s)"）
- [x] [ARTIFACT] tick-runner.js UPDATE 同时清空 claimed_by/claimed_at/started_at（防残锁）

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] tick-runner.js 代码层包含 execution_attempts=0 的 WHERE 条件
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/tick-runner.js\",\"utf8\");if(!c.includes(\"execution_attempts\")){process.exit(1)}if(!c.includes(\"10 minute\")&&!c.includes(\"10min\")&&!/INTERVAL.*10/i.test(c)){process.exit(1)}console.log(\"OK\")"'

- [x] [BEHAVIOR] 死任务 UPDATE 同时清空 claimed_by/claimed_at/started_at（防残锁）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/tick-runner.js\",\"utf8\");const idx=c.indexOf(\"execution_attempts\");const seg=c.slice(Math.max(0,idx-200),idx+3000);const ok=seg.includes(\"claimed_by\")&&seg.includes(\"claimed_at\")&&seg.includes(\"started_at\");if(!ok){process.exit(1)}console.log(\"OK\")"'

## 备注

tick-runner.js 死任务重置逻辑已在主线代码中预先实现（section 6.6，lines 1293-1308）。
本 WS 验证该实现满足所有合同 ARTIFACT 和 BEHAVIOR 条目。
