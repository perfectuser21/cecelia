# 独立裁判（第 6 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r6.md
- 总评：不通过：README 产品内容及主要 CLI 行为已有实测支持，未发现明确产品缺陷；本轮 I-4 的原生证据和逐次内容核验仍不完整。指定报告的临时隔离与恢复已有本轮可信凭证支持，不构成失败原因。

## 需求覆盖

### I-1
- 满足
- 依据：README 新增“运行回执如何判读”小节说明参数、默认目录、mtime 倒序及无记录不证明健康；T-1 实测空目录和不存在目录返回 []，普通输出显示实际目录，排序为 newer、older，退出码 0。S-1/Q-1 覆盖。

### I-2
- 满足
- 依据：README 解释五种状态、原因回退及本地 ci_fix 摘要，明确不得据 unreadable 删除 pr-sync-pending.json；T-2 输出 running、partial/collect_timeout、failed/run_failed，两种域名均显示 attempts=2、last_result=passed，合法非回执文件与损坏 JSON 均显示 unreadable；X-1 验证损坏 JSON 不导致 CLI 崩溃。S-2/Q-2 覆盖。

### I-3
- 满足
- 依据：README 明确另核对应 PR/head、GitHub 实际合并及 Brain/QA 终态，禁止手工更改批准或历史 FAIL；T-3 实测缺 URL 时仍为 completed，同时返回 pr_url_missing、pr_url=null，普通行不显示原因，并读取断言诊断文字。S-3/Q-3 覆盖，本次无需访问生产。

### I-4
- 未满足
- 依据：T-4 提供固定 HEAD、固定基线完整 DAG、全仓差异及未跟踪列表，但明确承认大型 manifest 输出截断、后续对象校验及其它调查命令未全部逐字记录，内容核验仅有摘要，故自判 CANNOT_VERIFY。本轮可信隔离凭证已证明指定两份报告按原字节和模式恢复，但不能补足范围验收证据。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：05-qa-report-r6.md：T-4；02-spec.md：S-5、S-6、S-7、Q-4
- 说明：T-4 明确记载两次大型 manifest 读取输出截断，仅展示其中一次的截断片段；修正后的 14 条父边、62 条路径校验及其它调查命令也未完整纳入报告。README 原文保留、逐次 manifest 历史保留、规格纯追加和同步内容归属仅有执行摘要，缺少相应完整命令、逐项断言输出及退出码，无法独立核实 S-6/S-7 要求的逐边对象与可见内容检查。已记录的两次失败及后续成功声明不能填补这些缺口。可信登记、同步及恢复投影不替代命令语义与独立范围检查，sealed_not_registered 也不是已登记。应保留本轮不能验收及历史失败结论，在后续合法新轮完整记录实际取证；不能据此断言受保护原生记录不存在。
