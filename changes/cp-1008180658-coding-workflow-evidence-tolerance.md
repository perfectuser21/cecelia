## Brain {VERSION} — coding workflow 04 证据解析对真实 claude 格式容错

- 真实端到端 2c34f677：04 最后一条 output 代码块没写闭合 ``` 就到文末，判 evidence_invalid。lib/evidence.mjs：文末仍开着的代码块按闭合到文末处理；文中未闭合的块吞掉后面的 E-n 时那些 I-n 照样判未覆盖，不放宽。
- verdict 不区分大小写；字段行（对应/verdict）去掉 markdown 加粗后再匹配。
