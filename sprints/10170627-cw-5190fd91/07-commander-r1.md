# coding commander 裁决（第 1 次）

- 升级：qa_cannot_verify
- 处理：解除升级，继续自动流程
- 总结：已裁定 T-7 为 Q-4 取证方式与隔离边界冲突，纯追加规格 S-6 并提交 200baf82e；下一轮按新 HEAD 重做完整 QA 与裁判。
- 提交：200baf82e

## 逐条裁决

### T-7
- 裁决：采纳
- 理由：Q-4 原命令逐父边打印完整 --binary 补丁，与 S-5 规定的 QA 会话内 03-build.md/04-evidence.md 正文隔离冲突，且工具截断使本轮原生输出不完整。依据 01-intent.md 第 20、24、28、29 段及 I-4，已在 02-spec.md 末尾追加 S-6：固定 initial base 全 DAG、每条父边全路径及 blob/mode、完整对象字节校验与逐项完整原生记录继续必做；受隔离正文不展示，恢复和来源证据留给独立裁判/source gate。T-7 本轮 CANNOT_VERIFY 不追认。
