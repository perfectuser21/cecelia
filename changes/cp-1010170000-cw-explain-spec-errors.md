## Brain {VERSION} — coding harness：规格校验错误带上改法再交给重试

- 金丝雀 3（任务 1329bba0）在 spec 卡死：第 1 次 4 条铁律 `unaddressed`，第 2 次带着上次错误码重试降到 1 条，两次机会用完失败。现场看，模型其实写了实质的「不适用」理由，只是没以「不适用：」开头、也没引用 S-n/Q-n。重试只拿到 `INV-50954d28:unaddressed` 这种错误码，不知道该怎么改。
- 新增 `explainSpecErrors`：每个错误码附带具体改法（铁律对照两种正确写法、缺哪个小节、Q-n 缺哪个字段、upstream 漏了哪个 I-n 等），认不出的错误码原样保留，多条用分号连成一行。
- spec 重试的 `PREV_ERRORS`、合同对抗评审和改写的 `SPEC_ERRORS` 都改用带改法的说明。
