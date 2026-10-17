# 独立裁判（第 9 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r9.md
- 总评：不通过：README 内容和主要 CLI 行为有本轮实测支持，未发现明确产品缺陷；I-4 的完整原生证据与可见报告内容核验仍不足。指定报告的临时隐藏及恢复已有本轮可信凭证支持。

## 需求覆盖

### I-1
- 满足
- 依据：README.md:51 起新增小节说明参数、默认目录、mtime 倒序及无记录不证明健康；T-1 实测空目录与不存在目录均返回 []，普通输出包含实际目录，排序为 newer、older，退出码为 0。S-1/Q-1 覆盖。

### I-2
- 满足
- 依据：README 新增小节解释五种状态、本地 ci_fix 摘要及不得据 unreadable 删除待办；T-2 验证 running、partial/collect_timeout、failed/run_failed，两种域名均显示 attempts=2、last_result=passed，合法非回执 JSON 与损坏 JSON 均显示 unreadable。S-2/Q-2 覆盖；原生证据完整性问题另见 J-1。

### I-3
- 满足
- 依据：README 要求另核对应 PR/head、实际合并及 Brain/QA 终态，禁止手工修改批准或历史 FAIL；T-3 实测缺 URL 时仍为 completed，JSON 返回 pr_url_missing、pr_url=null，普通行不显示原因，并核对诊断文字。S-3/Q-3 覆盖，本次无需调用生产。

### I-4
- 未满足
- 依据：T-4 补充了固定基线完整 DAG、全仓范围、逐父边对象检查、README 原文保留、manifest 历史保留和规格纯追加证据。但当前材料截断，且可见报告的内容检查仍退化为非空判断。本轮可信 isolation 绑定第 9 轮、测试 HEAD 与原生会话，证明指定两份报告原字节及模式恢复，不构成失败原因。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：05-qa-report-r9.md：T-2、T-4 的 q4audit 截断处；02-spec.md：S-5、S-6、Q-4
- 说明：提交给裁判的本轮报告在 q4audit 命令中途截断，明确标注“已截断，原文 113675 字符”，无法复核全部失败、调查、修正及重测的完整命令、输出和退出码。此外，T-2 包装命令将实际 CLI 时间替换为 <mtime>，筛选 JSON 字段后重新输出，未保留完整 CLI 原始输出。这些证据支持部分行为断言，但不满足 S-5/S-6/Q-4 的完整原生记录要求。可信封存与恢复事实不能补足缺失输出，sealed_not_registered 也不是已登记；不能由此断言受保护原生记录不存在，或改写历史追认通过。

### J-2
- 类型：qa_gap
- 严重度：重要
- 对应：I-4
- 位置：05-qa-report-r9.md：T-4 最终审计的 path.startswith(S) 新增报告分支；02-spec.md：S-7
- 说明：T-4 最终审计对其它可见自产报告仅执行 assert len(new)>0，随后打印 content=new_task_report_content。这只能证明文件非空，不能证明内容属于对应任务、阶段和真实轮次，也没有完成 S-7 要求的逐条可见内容规则核验。末尾仅对六个文件比较来源 SHA256，不能替代其余可见报告的内容检查。因此 ALL_EDGES_BLOBS_CONTENT=PASS 超出了命令实际证明的范围；本轮虽补足对象完整性、manifest 历史及规格追加检查，仍不能据此判完整范围验收通过。
