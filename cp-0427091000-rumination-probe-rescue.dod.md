# DoD: PROBE_FAIL_RUMINATION 根因可见化 + last_run 真实化

- [x] [BEHAVIOR] rumination.js digestLearnings 双路 LLM 全失败时写 cecelia_events('rumination_llm_failure')，payload 含 notebook_error + llm_error
  Test: tests/packages/brain/__tests__/capability-probe-rumination.test.js

- [x] [BEHAVIOR] capability-probe.js probeRumination last_run 用全局 max(created_at)，不带 INTERVAL 48h 过滤
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/capability-probe.js','utf8');const m=c.match(/SELECT\s+max\(created_at\)\s+AS\s+last_run\s+FROM\s+synthesis_archive(?!\s*\n?\s*WHERE)/);if(!m)process.exit(1)"

- [x] [BEHAVIOR] capability-probe.js probeRumination degraded_llm_failure 时查 rumination_llm_failure 事件并把 notebook= / llm= 摘要透出到 detail
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/capability-probe.js','utf8');if(!c.includes(\"event_type = 'rumination_llm_failure'\")||!c.includes('last_llm_failure')||!c.includes('notebook=')||!c.includes('llm='))process.exit(1)"

- [x] [BEHAVIOR] 新增 capability-probe-rumination.test.js 3 个 grep 测试全绿
  Test: packages/brain/src/__tests__/capability-probe-rumination.test.js

- [x] [ARTIFACT] Learning 文件 docs/learnings/cp-04270101-rumination-probe-fail-rca.md 存在并含「根本原因」+「下次预防」
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04270101-rumination-probe-fail-rca.md','utf8');if(!c.includes('根本原因')||!c.includes('下次预防'))process.exit(1)"
