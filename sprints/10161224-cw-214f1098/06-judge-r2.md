# 独立裁判（第 2 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r2.md
- 总评：README 产品内容及本轮 CLI 原生证据满足 I-1 至 I-3，前轮输出保留问题已解决。历史报告工作区删除的合法来源仍未证实，I-4 暂不能通过。

## 需求覆盖

### I-1
- 满足
- 依据：README 新增小节列明参数、默认目录、mtime 倒序及空结果不代表健康；S-1/Q-1 覆盖。T-1 完整保留 CLI 输出、stderr 和退出码：空目录及不存在目录输出 []，排序结果 newer 在 older 前；T-4 读取最终 README 断言通过。

### I-2
- 满足
- 依据：README 状态表及后续段落覆盖各状态、ci_fix 和非回执 JSON 的保护边界；S-2/Q-2 覆盖。T-2 原生输出包含 running、partial、failed、unreadable，以及 ci_fix.attempts=2、last_result=pushed，9 个文件仍在；X-1 两次读取待办的输出一致、前后哈希相同。

### I-3
- 满足
- 依据：README 最后一段明确 completed 不代表合并，要求核对 PR 最终 head、Brain runner.phase=merged、merge.merged=true 和 QA 终态，禁止手改批准或 FAIL；S-3/Q-3 覆盖。T-3 完整输出证明缺 URL 时仍为 completed、reason_code=pr_url_missing、pr_url=null，普通行不打印原因。产品差异仅 README。

### I-4
- 未满足
- 依据：T-5 使用固定基线检查 HEAD、暂存区、工作区及全仓未跟踪文件；README 为 22 行纯新增，manifest 的 9 条新增与受信登记事实对应。但两份历史报告的工作区删除仍缺少来源及授权隔离证明，前轮 r1:J-2 尚未完全解决。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：T-5：working、working-numstat 输出及隔离来源说明
- 说明：T-5 已将历史报告的差异核实为整文件删除，但“新增 0 行、不是改写”不能证明删除符合范围合同。报告明确承认受信来源不证明删除操作者，只称现象与隔离相符。需求明确允许的是 verify 期间临时隐藏 03-build，并未据此授权本轮 evaluate 删除 03-build 和 04-evidence；提供的控制器事实也仅证明已提交版本的身份。因此仍无法区分受控临时隔离与误删历史证据。应补充这两处删除对应的可信隔离事实及恢复边界，再判范围通过；无需读取被隔离报告正文。这延续前轮 r1:J-2，不要求改变产品文档。
