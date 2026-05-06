# DoD — feat(brain): migration 265 + initiative_runs.journey_type

## 验收标准

- [x] [ARTIFACT] `packages/brain/migrations/265_initiative_journey_type.sql` 存在且含 journey_type CHECK constraint
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/migrations/265_initiative_journey_type.sql','utf8');if(!c.includes('CHECK (journey_type IN'))process.exit(1);console.log('OK')"`
  
- [x] [ARTIFACT] `packages/brain/src/selfcheck.js` EXPECTED_SCHEMA_VERSION 为 '265'
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!c.includes(\"'265'\"))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] harness-dag.test.js journey_type 透传测试通过
  Test: tests/packages/brain/src/__tests__/harness-dag.test.js

- [x] [BEHAVIOR] harness-initiative.graph.js 两处 INSERT 含 journey_type 参数
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/journey_type/g);if(!m||m.length<4)process.exit(1);console.log('journey_type occurrences:',m.length)"`

- [x] [BEHAVIOR] routes/initiatives.js GET /:id/dag SELECT 含 journey_type
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiatives.js','utf8');if(!c.includes('journey_type'))process.exit(1);console.log('OK')"`
