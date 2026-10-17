# 独立裁判（第 5 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r5.md
- 总评：不通过：README 内容和主要 CLI 行为已有实测支持，未发现明确产品缺陷；本轮 I-4 的范围核验与原生证据完整性仍不足。指定报告的临时隐藏及恢复已有本轮可信凭证支持，不构成失败原因。

## 需求覆盖

### I-1
- 满足
- 依据：README 新增小节列明参数、默认目录、mtime 倒序及无记录不证明健康；T-1 实测空目录和不存在目录均返回 []，普通模式显示没有运行记录，排序为 newer、older；T-4 文档断言通过。S-1/Q-1 覆盖。

### I-2
- 满足
- 依据：README 解释五种状态、原因回退及本地 ci_fix 摘要；T-2 实测 running、partial/collect_timeout、failed/run_failed，两种域名均显示 attempts=2、last_result=passed，合法状态文件、pr-sync-pending 和损坏 JSON 均显示 unreadable。文档明确不得据此删除待办。S-2/Q-2 覆盖。

### I-3
- 满足
- 依据：README 明确 completed 不代表实际合并，要求核对对应 head、GitHub 合并及 Brain/QA 终态，禁止手工修改批准和历史 FAIL；T-3 实测缺 URL 时仍为 completed，同时返回 pr_url_missing、pr_url=null，普通行不显示原因；T-4 核对诊断文字。S-3/Q-3 覆盖。

### I-4
- 未满足
- 依据：T-5 证明 README 原文保留，T-6 至 T-10 提供固定基线 DAG 和全仓范围枚举，但明确未完成逐父边内容归属核验，本轮失败尝试也未完整记录。本轮可信隔离凭证已证明指定两份报告按原字节和模式恢复，不能补足上述验收缺口。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：05-qa-report-r5.md：T-6 至 T-10；02-spec.md：S-4、S-6、S-7、Q-4
- 说明：本轮 T-6 至 T-10 自判 CANNOT_VERIFY，仅枚举提交和路径，未提供 S-6 要求的逐父边 raw/blob/mode 完整核验及 S-7 要求的可见内容逐次断言；逐次 manifest 历史保留、规格纯追加和同步内容归属也没有本轮证据。报告声称的读取限制不能替代这些合同要求，应先解决执行输入与合同的冲突，再在合法新轮完成核验。可信登记及同步投影不能代替 QA 独立范围检查，旧轮结果也不能移用于当前 HEAD。

### J-2
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：05-qa-report-r5.md：T-1、TESTED_HEAD、裁判缺口与探索记录；02-spec.md：S-5、S-6、Q-4
- 说明：探索记录承认本轮首次 Q-1 因误用 file 字段而以退出码 1 失败，但没有引用该次完整命令和原生输出，仅提供原因摘要及修正后的 T-1。这仍违反 S-5/S-6/Q-4 对本轮失败、修正和重测全部原生证据的要求。另未提供 git rev-parse HEAD 的实际命令输出，TESTED_HEAD 标注不能替代该项操作。可信封存只证明报告身份，sealed_not_registered 不是已登记，也不能补足缺失的执行证据；不能据此推断原生记录不存在或改写历史追认通过。
