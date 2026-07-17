# Thin PRD 输入

## 任务标题
修撞车检查时间盲区：查open也查近期merged + 『复现或退场』铁律——bug fix 任务 failing test 不红即任务过时自动关闭

## 背景（description）
07-16 实证（zenithjoy #1335 vs 无头session重复修复）：/dev 撞车检查只 gh pr list --state open，任务排队50min期间修复已合并→无头session重做一遍+接死代码+软断言(任一参数即过)混过CI。两洞：去重只防空间撞车不防时间撞车；session未执行先红纪律（真复现会发现bug已修）。

## thin_prd
两处：
① 找到 /dev 撞车检查实现（packages/engine 的 skills/dev steps 或 hooks，grep 'pr list' 'state open' 定位），查询升级为 open + 近7天 merged（--search 含任务短号/关键词，merged 命中→输出『疑似已被 PR#N 完成』并要求核对后关任务，不许静默继续）；
② 『复现或退场』铁律写进 /dev bug-fix 路径与 systematic-debugging 衔接段：修 bug 第一步的复现 failing test 若在最新 main 上不红 → 禁止继续开发，任务标 obsolete/completed(duplicate) 收工并留痕引用已存在的修复 PR。engine 改动三要素（[CONFIG] title+版本bump 5文件+feature-registry changelog）。必须先写 failing test：mock gh 返回『open无命中但近期merged有命中』→ 现版本放行（failing），修复后拦截提示；纯新功能任务（非bug fix）不受复现铁律影响（回归）。

## payload 字段
- target_environment: local_api
- base_repo: /Users/administrator/perfect21/cecelia
- review_required: false
- journey_id: null
