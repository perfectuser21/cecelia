# 独立裁判（第 1 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r1.md
- 总评：README 改动覆盖主要判读需求，未发现明确产品实现错误。当前 QA 未满足原生输出保留要求，且两份历史报告的工作区修改尚未核清，本轮不能通过。

## 需求覆盖

### I-1
- 未满足
- 依据：README 新小节及 S-1/Q-1 覆盖参数、mtime 倒序和空结果边界；T-2 真实调用 CLI 并断言排序及空数组，但没有逐字保存 CLI 原生输出，见 J-1。

### I-2
- 未满足
- 依据：README 状态表及 S-2/Q-2 覆盖分类、ci_fix 和待办保护；T-3 验到 running、partial、failed、unreadable、attempts=2、last_result=pushed，并列出保留文件，但原生输出被裁剪重组，见 J-1。

### I-3
- 未满足
- 依据：README 明确 completed 不等于合并，要求核对 PR/head、Brain 和 QA 终态；T-5、X-1 验到 completed、pr_url_missing、pr_url=null 及重复读取不改文件，但缺少逐字原生输出，见 J-1。

### I-4
- 未满足
- 依据：T-7 使用固定基线，枚举提交、暂存、工作区及全仓未跟踪文件；受信来源支持已提交的七条 manifest 增量。然而工作区已有两份已登记报告发生修改，检查仅按 sprint 前缀放行，未证明符合禁止重写历史报告的边界，见 J-2。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-1、I-2、I-3
- 位置：QA 报告 T-2、T-3、T-5、X-1
- 说明：需求明确要求 QA 原生命令输出逐字引用，禁止省略或修改。T-2、T-3、T-5 的 run 函数对 stdout 执行 trim，随后解析 JSON 并通过 rows.map 删除字段、重新序列化；X-1 同样只输出解析后的包装对象。现有断言可以支持部分行为判断，但这些输出不是所调用 CLI 的完整原生输出，也未逐次展示退出码和 stderr，无法满足本次明确保留的证据要求。应保留每次 CLI 调用的完整 stdout、stderr 和退出码，断言摘要另列。

### J-2
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：QA 报告 T-7：working 清单及 startsWith(sprint) 放行逻辑
- 说明：T-7 原生结果显示工作区修改了已提交并登记的 03-build.md 和 04-evidence.md，但检查只要求路径 startsWith(sprint)，没有检查修改内容或来源。需求允许真实流水线记录，并明确禁止新记录重写历史报告；同一 sprint 前缀不能自动授权修改既有证据。受信 committed 事实只证明已提交版本的来源，current_qa 也仅封存本轮 QA 报告，均不能证明这两处工作区修改合法。需要核实并留存两份差异及其来源，再判断是否越界；不能据当前检查宣称范围验收通过。
