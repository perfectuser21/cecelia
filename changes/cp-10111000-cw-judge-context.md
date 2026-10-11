## Brain {VERSION} — coding workflow：裁判看到规格约束力与前轮裁决，翻转交 commander；生成 smoke 设保护路径

- 独立裁判提示词声明规格（02）条款有约束力（认为规格错 → contract_gap），并附前几轮裁决原文（最近优先，单份 1.2 万字、总量 3 万字封顶）
- 裁判问题新增 `reverses`（如 `r8:J-2`）：阻断/重要问题推翻前轮裁决 → failure_class `ruling_conflict`，QA 门升级 `judge_ruling_conflict`，不让开发来回改（金丝雀 4 #6232 第 8/9 轮翻转跑了 10 轮）
- qa-fix 会话拿到 PRIOR_RULINGS 与规格约束说明；判定要修的与规格/前轮矛盾时不提交、输出 `RULING_CONFLICT:` → 升级 `qa_fix_failed`（reason `ruling_conflict`，带说明）
- runner 生成的 `packages/brain/scripts/smoke/cw-<8位>-qa-smoke.sh` 列入修复会话保护路径（CI 修复 / QA 修复 / 冲突修复改了即 protected_path，不推送）
