# Bug PrepPRD：Dashboard 部署静默跳过（判变失效三连洞）

## 症状
指挥舱 PR #4022/#4038 合并三天，本机 5211 与 HK 两个生产实例都没上线新版，无任何告警。用户刷不出来。

## 根因
1. `scripts/deploy-local.sh` 判变用 `git diff origin/main...HEAD`，专用部署根（cecelia-deploy-main）每次先 `reset --hard origin/main` → diff 恒空 → dashboard 改动永远检测不到（07-17 两次部署日志实证判"无改动"跳过）。Brain 有生产 git_sha 对账兜底，dashboard 没有。
2. Brain SHA 对账（79行）跑在守卫 fetch（117行）之前，用的是上一轮旧 origin/main 引用——现存时序 bug。
3. `promote-dashboard.sh` 现有 HK rsync + 指纹终验失败全降级 warning 不退非零 → 静默；终验用 index hash 非 sha。
4. （刀2 范围，本 PR 不修）生产 cecelia-frontend 容器挂开发仓 dist，部署管线在 deploy-main → 产物落不到挂载点；promote mv 换目录 inode，bind-mount 可能持旧 inode。

## 修法（单 PR，scripts/ 为主）
1. vite 构建产物内嵌 `build-info.json`（GIT_SHA + 构建时间）：vite.config.ts 内联插件 generateBundle + emitFile（自动跟随 --outDir）；sha 取 `process.env.GIT_SHA || execSync 兜底`；deploy-local.sh 的 docker 构建路径加 `-e GIT_SHA=$(git -C $MAIN_ROOT rev-parse HEAD)`（node:20-alpine 无 git）。不放 public/。
2. `deploy-local.sh` dashboard 判变改"生产自报 SHA 对账"：
   - 位置：部署根守卫块之后、NEED 判断之前
   - `curl -sf --max-time 5 localhost:5211/build-info.json` → node -e 解析（禁 jq）拿 deployed sha → `git -C "$MAIN_ROOT" diff <sha>..origin/main -- apps/dashboard apps/api` 非空 → NEED_DASHBOARD=true
   - 注意：build-info 404 时 SPA fallback 返 200+HTML（frontend-proxy.js 实证），-f 抓不住，靠 JSON 解析失败兜底
   - 保守触发条件（仅真实模式）：curl 失败 / 解析失败 / sha 不在 git 历史（cat-file -e 校验，短 sha 先展开）
   - 测试钩子：`CECELIA_PROD_DASHBOARD_SHA` 注入；CECELIA_DEPLOY_ROOT 已设且钩子未设 → 跳过对账（对齐 Brain PROD_SHA 空时行为）；禁复用 CECELIA_PROD_GIT_SHA（会连带 NEED_BRAIN 在 fixture 根炸 brain-deploy.sh）
   - changed_paths 降级为并集提示；168 行提前 exit 0 条件叠加新 MISMATCH 变量
   - 守卫 fetch 提前 / Brain SHA 对账挪到守卫后（修时序 bug，统一一套时序）
   - 去重闸防风暴：.staging-pending 已存在且 commit == origin/main HEAD → 跳过重建不重发 Bark
3. `promote-dashboard.sh`：现有 HK 同步（206-214行）/ 指纹终验（217-222行）warning → fatal：显式 FAIL 变量（脚本是 set -uo 无 -e）+ Bark + 尾部统一 exit 非零；HK 失败不回滚本机；rsync 补 ssh ConnectTimeout；check-deploy-fingerprint.sh 扩展为优先比 build-info.json git_sha（本机 vs HK vs 期望产物），拿不到退回 index hash；红报文区分"取不到"/"sha 不等"/"分家 vs inode 陈旧"；清理 pending/slot 移到 HK 同步之前；修 13 行过时头注释
4. 同 PR 测试接缝：release-deploy-stage.test.sh run() 补 CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1；dashboard-staging-gate-smoke.sh [B] 补 CECELIA_SKIP_FINGERPRINT=1；fixture 补假 build-info.json

## 关联上下文
- Issue：89079934-50d2-42c2-b54b-8ca754e9b12b（Notion P1）
- Brain task：1e5bc3e4-48e9-4806-b571-87415958b3f2
- 相关铁律：部署配置漂移铁律（改部署配置必须验证持久化一致性）、无闸不成文
- 判定点：（本任务无接缝判定点需用户拍板；"生产在服 sha 判定"所选方法=curl 生产实体自报 build-info.json，候选=.production-release 账本文件（实测不存在不可靠），误判后果=多构建一次+Bark，可接受）

## Regression Test 计划
`scripts/smoke/dashboard-sha-reconcile-smoke.sh`（*-smoke.sh 命名自动进 ci.yml glob job，勿动 ci.yml）：
- 正向：隔离 fixture 仓 2 commit（第 2 个只改 apps/dashboard/x），CECELIA_PROD_DASHBOARD_SHA=<commit1> + --dry-run + 无 --changed → 断言输出含 Dashboard 构建行。**修复前必红**（现输出"跳过：没有…改动"）
- 反向：sha 相等 → 断言跳过构建

## 哨兵（proven-to-fire）
- 逻辑接缝：上述 smoke 永久留 CI
- 环境接缝（部署路径）：promote 终验本身就是运行时守卫；合并后真实部署根演坏场景——注入旧 sha 看判变触发、伪造 hash 不一致看终验报红+Bark，亲眼见红
- 刻意设计：刀2 完成前 promote 终验必红（分家暴露面），红=响亮失败替代静默失败

## 验收标准
- [ ] failing smoke 先 commit（commit-1），修复代码让其变绿（commit-2）
- [ ] 已演 proven-to-fire（判变触发 + 终验报红各一次）
- [ ] 存量测试（release-deploy-stage / gate-smoke）不被打红
- [ ] CI 全绿

## 后续（不在本 PR）
- 刀2（用户已拍板 A：刀1 合并后立刻做）：cecelia-frontend 从 deploy-main 重建（COMPOSE_PROJECT_NAME=cecelia）+ 解决 mount inode（restart 容器或 rsync 原地覆盖）
- 刀3：正规 release→promote 收账 + 清 5223 旧 staging
