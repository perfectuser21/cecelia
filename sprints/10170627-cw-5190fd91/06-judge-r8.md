# 独立裁判（第 8 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r8.md
- 总评：不通过：README 内容和主要 CLI 行为有本轮实测支持，未发现明确产品缺陷；I-4 的逐次内容与范围核验仍未完成。第 8 轮指定报告的临时隐藏及完整恢复已有可信凭证支持。

## 需求覆盖

### I-1
- 满足
- 依据：README.md:51 起新增小节说明参数、默认目录、mtime 倒序及无记录不证明健康；T-1 实际输出空目录和不存在目录均为 []、退出码 0，普通输出包含实际目录，排序为 newer、older，文档断言通过。S-1/Q-1 覆盖。

### I-2
- 满足
- 依据：README.md 新增小节解释五种状态、原因回退及本地 ci_fix 摘要，明确不得据 unreadable 删除 pr-sync-pending.json；T-2 输出 running、partial/collect_timeout、failed/run_failed，两种域名均显示 attempts=2、last_result=passed，合法非回执 JSON 与损坏 JSON 均显示 unreadable。S-2/Q-2 覆盖。

### I-3
- 满足
- 依据：README.md 新增小节要求另核对应 PR/head、实际合并及 Brain/QA 终态，禁止手工更改批准和历史 FAIL；T-3 实测缺 URL 时仍为 completed，JSON 返回 pr_url_missing、pr_url=null，普通行不显示原因，诊断文字断言通过。S-3/Q-3 覆盖；完整范围证明另受 I-4 缺口限制。

### I-4
- 未满足
- 依据：T-4 提供固定 HEAD、固定 initial base 的完整 DAG、全仓差异及逐父边 raw 列表，但明确未完成 S-6/S-7 的对象完整性、逐次内容和同步归属核验，也未提供本轮 README 基线原文保留断言。本轮可信 isolation 已证明指定 03/04 报告按原字节及模式恢复，不构成失败原因。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：05-qa-report-r8.md：T-4；02-spec.md：S-4、S-6、S-7、Q-4
- 说明：T-4 自判 CANNOT_VERIFY，实际证据止于提交、路径和 raw 模式及缩写对象 ID 枚举，未完成每个旧/新非零 blob 的完整读取与哈希、大小核验，也未对每条可见变更执行内容规则断言。缺少逐次 manifest 历史原文保留与合法新增行检查、两次规格纯追加检查、README 基线原字节及顺序保留检查，以及同步完整 tree 的内容归属核验。因此仍不能排除中途越界、历史改写或错误同步归属。可信登记、同步及恢复投影不能替代 S-6/S-7/Q-4 要求的独立检查；本轮 sealed_not_registered 亦不是已登记。应保留历史失败，在后续合法新轮针对当前精确 HEAD 完整取证，不能用旧轮检查或最终相对 main 的差异代替。
