# 独立流程契约身份

任务：4c30410c-ddd6-47d3-ac9e-25ba09010704
父任务：dffd5885-46f7-4cf1-b55b-8729497b9928

## 问题与变化
获客四流程共享现有业务能力，现有 loader 强制契约文件名等于 capability，无法给每个流程独立冻结版本。本刀允许显式 contract_key 区分执行契约身份，capability 保持业务归属；无该字段的旧契约保持现有加载行为。

## 安全边界
独立契约必须拥有唯一 canonical owner 登记，且 owner 的 capability_id 和 source_repo 均匹配当前流程。缺 owner、跨能力、跨仓库或歧义 owner 均拒绝。digest、workflow、来源路径与显式 Brain 身份继续核验。退役 owner 可保留归属事实，不重新激活它。

## 测试策略
先在未修复 HEAD 真实跑 loader 回归红测，提交红测后提交实现。永久单元回归覆盖独立身份成功、缺 owner、歧义 owner、异仓库和异 capability_id 拒绝；正式 smoke 直接执行 loader/store/sync 的 fixture 集成，无生产写入。

## 本刀交付
契约 loader 兼容与归属护栏，永久 CI 测试、smoke、版本同步。四流程登记/激活、Commander 和调度切换由父任务完成，本刀不更改生产流程状态。
