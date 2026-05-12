# DoD — consciousness-loop guidance TTL (P1 B4)

**范围**: `packages/brain/src/guidance.js` 的 `getGuidance()` 加 DECISION_TTL_MIN 短路 TTL 检查，防止含 `decision_id` 的 stale guidance 误导调度器。

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/guidance.js` 含 DECISION_TTL_MIN 短路 TTL 逻辑
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/guidance.js','utf8');if(!c.includes('DECISION_TTL_MIN'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/guidance.js` 的 SELECT 语句含 `updated_at` 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/guidance.js','utf8');if(!c.includes('updated_at'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/__tests__/decision-ttl.test.js` 测试文件存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/decision-ttl.test.js')"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] C1a: decision created 5 min ago — getGuidance 返回正常 value（新鲜）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/decision-ttl.test.js','utf8');if(!c.includes('5 min ago'))process.exit(1)"`

- [x] [BEHAVIOR] C1b: decision created 30 min ago — getGuidance 返回 null（默认 TTL=15 超时）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/decision-ttl.test.js','utf8');if(!c.includes('30 min ago'))process.exit(1)"`

- [x] [BEHAVIOR] C1c: DECISION_TTL_MIN=60 env override — 30 min 的 decision 仍有效
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/decision-ttl.test.js','utf8');if(!c.includes('DECISION_TTL_MIN'))process.exit(1)"`

- [x] [BEHAVIOR] C1d: 非 decision value（无 decision_id 字段）不受 TTL 限制
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/decision-ttl.test.js','utf8');if(!c.includes('decision_id'))process.exit(1)"`
