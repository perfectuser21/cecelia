## Brain {VERSION} — QA 门回归 smoke 固化说明进 Brain（决策 b8030661）

- QA 与裁判都通过时：固化成功记 qa 状态 smoke（轮次/文件/条目）；QA 报告无可固化 API 命令时保留分支上已有版本不动，result.qa.smoke_note 写明哪轮未固化、保留第几轮版本；从未固化过记「本任务无回归 smoke」；固化出错也记原因
