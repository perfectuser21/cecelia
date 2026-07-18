# 总交接单:信息逻辑重建周收官 → 新 session 从这里开始

> 2026-07-19 01:00 | 本单 = 新 session 唯一入口 | SSOT 链:memory 必读区 + 本单 + SYSTEM_MAP 1.3.0

## 一句话现状

**DevOps 七大机制全部闭合,机制层完工**(验收基准=docs/current/SYSTEM_MAP.md 七机制总账,含可验伪判据)。一昼夜七刀上主干:刀0 照相层(PR#4082)/刀A1 关系图(#4085)/刀A2 五查询(#4087)/事件扳机(#4092)/刀B①重跑闸(#4090)/刀B②认领三闸(#4089)/守卫补链(#4093)。生产全部验火:照相层 5 分钟影子、孤儿守卫 proven-to-fire 亲眼、B② 全自动零人工走通闭环。

## 新 session 第一个动作(按主理人指令顺序)

1. **主理人批锚点** → 读 `docs/proposals/anchor-proposal-20260719.md`(两 seed 域 51 features:24 可焊/15 存疑/12 缺失+3 拍板点,批阅方式在文档末尾)
2. 批完 → **刀C 全家**(1 天,/dev 路径B,有头):
   - apply 器:批过的清单→UPDATE journey_features 三锚字段(+审计记录);**拍板前绝不写库,journey_features 有 Notion 自动 push**
   - 锚点哨兵:nightly 验锚点路径存在+图内匹配,断锚计数棘轮(不做=锚点变第二本死账,最大缺口)
   - 出生即焊:add-feature.js 强制带锚
   - merge 自动焊:harness-report 收尾自动写本 sprint 文件进 feature 锚点(增量从此全自动)
3. **skill 件**(半天,挑 Brain 空窗——改 skill SSOT→dist 快照→重启刷 _skillCache,别在 harness 在膛时重启):proposer Step1.1/dev Phase2.5 开工问路换 /api/brain/graph 五查询(locate/related/island-check)
4. 加厚队列:二仓扫描(zenithjoy,锚点大头在那边,scan-graph repo 字段已留位)→ 语义 locate(复用 memory/search 向量基建)

## 待主理人两个小拍板
- CodeQL js/missing-rate-limiting 内网噪音 9 个:批量 dismiss(建议) vs 全局 limiter —— P3 issue 在案
- codegraph 符号级适配:缓(建议,排锚点哨兵后) vs 现在排 —— 评估三轮在 `docs/evals/codegraph-eval-20260718.md`(结论:colbymchenry 真身可行,需 calls 边字面二次校验护栏+edge_type 扩枚举 vs 独立表的架构拍板;codegraph-ai 假身不用)

## 关键死规矩(本周新增,memory 已录)
- 照相层/账本层永久分离;derived 表必带账龄哨兵;无自然键 derived 全量替换禁 upsert
- 两套恢复系统必须明确收权分界:开 PR 前裸孤儿归 orphan-guard,generator_done 后归 relay-watchdog
- schema 锚五处同 commit;smoke 断言环境无关;源码等值锁改数值≥;数值参数默认禁 `||`
- 临时 Brain 实例必须 scratch 库;integration 必须 db-config SSOT;测试禁写 journey_features

## 基建速查
- 五查询:GET/POST /api/brain/graph/{locate,related,radius,island-check,claim-status}
- 扫描:scripts/scan/run-all-scans.sh(四扫描器);rescan-if-changed.sh(*/5 事件扳机);cron 已装(另有哨兵 */30、日扫 05:00 LA)
- 守卫:packages/brain/src/lib/harness-orphan-guard.js;scripts/patrol/main-repo-sentinel.sh
- handoff 链:202607181100(总方向)→181440(刀0)→181650(A1)→181805(A2)→190041(守卫刀)→本单

## 遗留小项(不急,择日随手)
守卫刀终审 Minor×4(server 日志归属/shortId 前缀/哨兵按分支名判合并/notify JSON 插值,存档终审报告);db-update skill"自动扫描表"措辞对齐;两个 arch_review 定时任务在队列积压。
