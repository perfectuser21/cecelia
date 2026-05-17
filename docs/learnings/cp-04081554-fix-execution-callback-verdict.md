# Learning: extractVerdictFromResult 无法解析 claude JSON output 格式

### 根本原因
`execution-callback` 的 `extractVerdictFromResult` 函数在处理对象类型时，只检查 `res.verdict` 和 `res?.result?.verdict`。但 `claude -p --output-format json` 的输出结构为 `{type:"result", result:"最后一条消息文字", ...}`，其中 `result` 字段是**字符串**（不是对象），因此 `res.result?.verdict` 永远是 `undefined`。函数未进一步搜索 `res.result` 字符串内容，导致所有 harness 任务的 verdict 始终为 null，GAN 链路无法自动推进。

### 下次预防
- [ ] 新增处理 claude JSON output 的分支：对象类型时，若 `res.result` 是字符串，额外执行 JSON.parse + regex 搜索
- [ ] harness_contract_propose/review 等任务完成后，验证 Brain 日志出现 `verdict=PROPOSED/APPROVED/REVISION` 而非 `verdict=null`
