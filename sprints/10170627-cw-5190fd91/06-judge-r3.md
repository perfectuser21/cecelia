# 独立裁判（第 3 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r3.md
- 总评：README 产品内容与主要 CLI 行为已有实测支持，未发现明确产品缺陷。本轮范围验收仍缺少可见历史变更的内容核验，不能整体通过；指定报告的临时隐藏与恢复不构成问题。

## 需求覆盖

### I-1
- 满足
- 依据：README 新增“运行回执如何判读”小节列明参数、默认目录、mtime 倒序及空结果不证明健康。T-1 实际调用 CLI，输出 empty_json=[]、missing_json=[]、order=newer,older；T-4 读取最终 README 并断言相关文字。S-1/Q-1 覆盖。

### I-2
- 满足
- 依据：README 解释五种状态、原因回退、本地 ci_fix 摘要及不可删除待办。T-2 验证各状态、collect_timeout/run_failed、两个域名均匹配 2/passed，以及合法状态 JSON 和 pr-sync-pending 显示 unreadable；X-1 验证损坏 JSON。S-2/Q-2 覆盖。

### I-3
- 满足
- 依据：README 明确 completed 不代表合并，要求核对 PR/head、GitHub 合并与 Brain/QA 终态，禁止手工改批准或历史 FAIL。T-3 输出缺 URL 时 completed、pr_url_missing、pr_url=null，普通行不显示原因；T-4 核对诊断文字。S-3/Q-3 覆盖，无需本次访问生产。

### I-4
- 未满足
- 依据：T-5/T-6 已完整枚举固定基线 DAG、全仓差异和九条父边，T-7 验证 README 原文保留及最终 manifest 来源行；本轮可信隔离投影证明指定两份报告已恢复。但 T-6 仅校验对象完整性，未完成 S-6 要求的其它可见变更内容核验，尤其缺少逐次 manifest 历史保留及规格追加变更的内容证据。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：05-qa-report-r3.md：T-6、T-7；02-spec.md：S-4、S-6、Q-4
- 说明：S-6 明确要求对其它可见路径按实际内容、模式及归属核验，不能用路径或哈希推断内容正确。T-6 对所有 blob 仅重算哈希和大小，没有检查可见内容；T-7 只比较最终 manifest 与 main 的解析后关系数组。因而没有证据证明每次自产 manifest 修改都仅追加许可来源且历史字节不动，也没有检查 200baf82 对既有 02-spec.md 的修改确为保留原文的 Commander 追加。这些中间修改不能靠最终状态正确排除，合同明确禁止先改后恢复。可信阶段登记和同步投影不能替代这部分独立内容检查。需在后续合法新轮报告中补足逐次可见内容核验，保留旧轮结论和报告。
