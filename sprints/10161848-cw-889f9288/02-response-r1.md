---
task_id: 889f9288-5169-4341-acb8-f5cacc330bff
step: spec_response
upstream: ["02-review-r1.md#R-1", "02-review-r1.md#R-2"]
---

# 规格评审回应（第 1 轮）

### R-1
处理: 采纳
说明: `status.mjs` 的 `parseArgs` 用 `argv[++i]` 读取 `--log-dir` 后一项；`--log-dir --json` 会吞掉 `--json`，`opts.json` 保持 false。S-1 已把缺值回落限定为参数末尾，并写明紧随 `--json` 时的文本输出和误判风险；Q-2 增加真人运行该命令，核对“没有运行记录（--json）”而非 JSON。

### R-2
处理: 采纳
说明: `status.mjs` 的 `collectStatus` 捕获 `fs.readdirSync(logDir)` 的异常后返回 `[]`，普通文件路径和不可读目录也会造成空结果。S-1 已加入这两种原因及只读核对路径类型、访问权限的诊断方法；Q-2 增加普通文件路径的真实 CLI 操作，验证得到 `[]`、退出码 0，手册不能据此报告健康。
