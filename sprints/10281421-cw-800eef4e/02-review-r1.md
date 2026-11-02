---
task_id: 800eef4e-14b4-4532-a545-5c2d5cee53c6
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 6
回归风险: 7
可执行: 6

### R-1
针对: S-1, S-5, Q-1, I-1, I-2
严重度: 阻断
场景: 受管仓库的固定旧规则正文含有字面量 `{{SPEC_PATH}}`，spec 活动将其插入提示后再次替换成当前 02 文件路径，QA 对照固定 Git 原文时看到模型收到的旧承诺已被改写。
依据: `packages/brain/scripts/coding-workflow/lib/claude.mjs` 的 `renderPrompt` 对变量执行顺序 `reduce(...replaceAll...)`；先插入的旧规则正文若含后续变量占位符，就会在后续轮次被展开。S-1 明确要求原文字节固定且仅替换一次，但所列修改文件未包括该函数，Q-1 也只对照通常的四类 ref。
说明: 将模板替换改为仅扫描原模板中的占位符并按字面值插入，补含 `{{SPEC_PATH}}` 等占位符的固定原文回归与 Q-1 可观察对照；确认 spec、review、revise 三阶段读到的正文均与固定 Git 字节一致。
