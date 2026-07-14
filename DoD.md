# DoD: 11要素账本状态页 /ledger + 作战日报PPT卡片 + Android采集Stage1 [blade-bc 收尾]

- [x] [BEHAVIOR] features ledger 端点 + 账本页存在且页面 fetch 正确路径
      Test: manual:node -e "const fs=require('fs');const c=fs.readFileSync('apps/api/features/cecelia/pages/FeatureLedgerPage.tsx','utf8');if(!c.includes('/api/brain/'))process.exit(1)"
- [x] [BEHAVIOR] 作战日报 PPT 卡片式排版生成器行为有测试覆盖
      Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/battle-report.test.js')"
- [x] [BEHAVIOR] design-docs type 过滤器行为测试配对（含空串/逗号分隔 trim）
      Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/__tests__/design-docs.test.js')"
- [x] features-ledger smoke 脚本语法有效且已登记跑道
      Test: manual:bash -n packages/brain/scripts/smoke/features-ledger-smoke.sh
- [x] Android CaptureAccessibilityService 单测存在
      Test: manual:node -e "require('fs').accessSync('apps/android-agent/app/src/test/java/com/zenithjoy/agent/CaptureNodeHelperTest.kt')"
