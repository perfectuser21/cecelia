# DoD: migration 312 orchestrator DB 结构

sprint_dir: sprints/07041024-orchestrator-db-migration

- [x] [ARTIFACT] packages/brain/migrations/312_orchestrator_runs_state.sql 存在且含 initiative_runs 增列 + phase 扩枚举 + orchestrator_decision_log 表
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/312_orchestrator_runs_state.sql','utf8');if(!/orchestrator_decision_log/.test(c)||!/orchestrator_version/.test(c))process.exit(1)"
- [x] [BEHAVIOR] phase CHECK 扩枚举包含存量值 A_planning 与新值 planning/gan/generate/evaluate（存量库不被打爆）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/312_orchestrator_runs_state.sql','utf8');for(const p of ['A_planning','planning','gan','generate','evaluate'])if(!c.includes(\"'\"+p+\"'\"))process.exit(1)"
- [x] [BEHAVIOR] orchestrator_decision_log 为 append-only（存在禁 UPDATE/DELETE 的 trigger 完整 SQL）且 UNIQUE(run_id,hop)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/312_orchestrator_runs_state.sql','utf8');if(!/BEFORE UPDATE OR DELETE ON orchestrator_decision_log/.test(c)||!/UNIQUE\s*\(run_id,\s*hop\)/.test(c))process.exit(1)"
- [x] [BEHAVIOR] selfcheck EXPECTED_SCHEMA_VERSION 已 bump 到 312
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!/EXPECTED_SCHEMA_VERSION = '312'/.test(c))process.exit(1)"
- [x] [ARTIFACT] CI 测试 packages/brain/src/__tests__/migration-312-orchestrator.test.js 存在
  Test: manual:node -e "if(!require('fs').existsSync('packages/brain/src/__tests__/migration-312-orchestrator.test.js'))process.exit(1)"
