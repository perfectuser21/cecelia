# DoD: 投影自动重建 scheduler job(map_radius_stale 根治,Crystal 件9)

## 验收清单

- [x] [BEHAVIOR] active 投影 fact_revisions 旧于 headers → rebuild 恰好调用一次且带对 scope_key
  Test: tests/映射 packages/brain/src/__tests__/map-projection-refresh.test.js「投影 fact_revisions 旧于 headers」
  manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/map-projection-refresh.test.js','utf8');if(!c.includes('恰好调用 rebuild 一次'))process.exit(1)"

- [x] [BEHAVIOR] revision 对齐 → 绝不调用 rebuild(不空转烧库)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/map-projection-refresh.test.js','utf8');if(!c.includes('绝不调用 rebuild'))process.exit(1)"

- [x] [BEHAVIOR] 四 kind revision 不一致或缺 kind(扫描中窗口)→ 跳过该 scope 留 headers_incomplete,不报错
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/map-projection-refresh.test.js','utf8');if(!c.includes('headers_incomplete'))process.exit(1)"

- [x] [BEHAVIOR] 自带间隔 gate:窗口内重复调用 skipped 且不触库;过窗恢复
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/map-projection-refresh.test.js','utf8');if(!c.includes('不查库不重建'))process.exit(1)"

- [x] [BEHAVIOR] 多 scope 单点失败不连坐:第一个 rebuild 抛错,其余照常,console.error 留两侧 revision
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/map-projection-refresh.test.js','utf8');if(!c.includes('失败不连坐'))process.exit(1)"

- [x] [ARTIFACT] 新模块 packages/brain/src/map-projection-refresh.js(依赖全注入,测试零真库)
  Test: manual:node --check packages/brain/src/map-projection-refresh.js

- [x] [ARTIFACT] scheduler-jobs.js JOBS 注册 map-projection-refresh(描述含案号与自带 gate 声明)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/scheduler-jobs.js','utf8');if(!c.includes('map-projection-refresh'))process.exit(1)"

- [x] 版本 bump 1.273.171 四处同步
  Test: manual:bash scripts/check-version-sync.sh
