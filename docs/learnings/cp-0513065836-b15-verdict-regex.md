# Learning — B15 evaluator verdict regex bug 是 P1 真过不去的最深根因

### 根本原因

`harness-task.graph.js` evaluator callback resume 用 regex `/verdict:\s*(PASS|FAIL)/i` 解析 verdict，但 evaluator (cecelia/runner + claude code) 真输出是 JSON `{"verdict": "FAIL"}` 嵌套在 claude code result 字段里 escaped (`\"verdict\": \"FAIL\"`) → regex 永远 NO MATCH → fallback 'FAIL' → W19-W37 evaluator 看起来"业务判错"实际是 brain 解析 bug。

诊断陷阱：evaluator verdict='FAIL' + generator self-verify 11/11 PASS + CI 40/40 PASS 看起来是"evaluator 跟 generator 工艺不对齐"，实际是 brain 端 1 行 regex 解析失败。

### 下次预防

- [ ] 任何从 LLM stdout 提取字段优先用 extractField（已处理 markdown bold / JSON quote / nested escape），不要新写裸 regex
- [ ] 任何"verdict / status / result"类关键字段解析 bug 让整个 pipeline 永远走 fallback 路径，必须 unit test 覆盖至少 2 个 case（PASS + FAIL）含真实 LLM 输出 fixture
- [ ] 排查"sub-system 总判 FAIL"类 issue 第一步：检查 brain 端解析逻辑，不要先去怀疑下游 LLM 工艺
- [ ] graph state channel 数量审查：evaluate 类 callback 收到的 raw stdout 应该存到 channel（如 evaluator_output）便于事后 root cause 追溯，不应该只保留解析后的短串
