# DoD: 内容选题调度器补偿窗口

## [ARTIFACT] topic-selection-scheduler.js 含补偿窗口截止常量
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/topic-selection-scheduler.js','utf8');if(!c.includes('DAILY_TOPIC_CATCHUP_CUTOFF_UTC'))process.exit(1);console.log('PASS')"`
- [x] DAILY_TOPIC_CATCHUP_CUTOFF_UTC 常量存在

## [BEHAVIOR] 补偿窗口内（UTC 10:00）触发选题生成
- Test: `tests/packages/brain/src/__tests__/topic-selection-scheduler.test.js`
- [x] makeCatchupWindowTime() 测试：UTC 10:00 时 skipped_window=false，正常触发

## [BEHAVIOR] 补偿窗口外（UTC 13:00）不触发
- Test: `tests/packages/brain/src/__tests__/topic-selection-scheduler.test.js`
- [x] makeOutsideWindowTime() 测试：UTC 13:00 时 skipped_window=true

## [BEHAVIOR] 幂等保护：当天已有任务不重复生成
- Test: `tests/packages/brain/src/__tests__/topic-selection-scheduler.test.js`
- [x] hasTodayTopics=true 时 skipped=true，generateTopics 不被调用
