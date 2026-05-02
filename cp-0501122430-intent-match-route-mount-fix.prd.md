# PRD: intent-parse smoke_cmd 修正

## 背景

Migration 250（PR #2701）将 `intent-parse` feature 的 `smoke_cmd` 定为文件存在检查，
同时 `cecelia-smoke-audit.sh` 中的 intent-parse section 测试了错误的 URL
`/api/brain/intent-match/match`（实际挂载在 `/api/brain/intent`），
并标注了虚假的 P1 bug（路由早已正确挂载）。

## 成功标准

- [ ] `cecelia-smoke-audit.sh` intent-parse section 改为真实端点测试（`POST /api/brain/intent/match`）
- [ ] migration 251 将 DB 中 `intent-parse.smoke_cmd` 更新为真实 HTTP 断言
- [ ] smoke 脚本不再出现虚假 P1 bug 警告

## DoD

- [x] [ARTIFACT] `packages/brain/migrations/251_fix_intent_parse_smoke_cmd.sql` 存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/migrations/251_fix_intent_parse_smoke_cmd.sql')"`

- [x] [BEHAVIOR] `cecelia-smoke-audit.sh` intent-parse section 使用正确 URL `/api/brain/intent/match` 且无 P1 bug 警告
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/cecelia-smoke-audit.sh','utf8');if(c.includes('intent-match/match'))process.exit(1);if(c.includes('P1 bug'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] migration 251 smoke_cmd 包含正确端点
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/251_fix_intent_parse_smoke_cmd.sql','utf8');if(!c.includes('/api/brain/intent/match'))process.exit(1);if(!c.includes('total'))process.exit(1);console.log('ok')"`
