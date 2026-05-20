# DoD: Content Clipper — Brain API + Dashboard /clips

- [x] [BEHAVIOR] POST /api/brain/clips 创建 pending 记录并返回 201
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [x] [BEHAVIOR] GET /api/brain/clips 返回列表，支持 platform/status 过滤
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [x] [BEHAVIOR] 重复 URL 提交返回 409 already_exists
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [x] [BEHAVIOR] POST /api/brain/clips/:id/callback 将状态更新为 done
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [x] [BEHAVIOR] extractClip 调用 content-service proxy 并传递 callback_url
  Test: packages/brain/src/__tests__/clips-extractor.test.js

- [x] [ARTIFACT] migration 010-content-clips.sql 存在
  Test: manual:node -e "require('fs').accessSync('database/migrations/010-content-clips.sql')"

- [x] [ARTIFACT] packages/brain/src/routes/clips.js 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/clips.js')"

- [x] [ARTIFACT] ContentClipsPage.tsx 存在
  Test: manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/clips/ContentClipsPage.tsx')"
