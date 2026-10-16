---
task_id: 889f9288-5169-4341-acb8-f5cacc330bff
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 7
场景覆盖: 6
回归风险: 8
可执行: 7

### R-1
针对: S-1, Q-2, I-1
严重度: 重要
场景: 运维员漏填目录，执行 `status.mjs --log-dir --json`，看到的却是文本“没有运行记录（--json）”，按手册所说的默认目录回落与 JSON 输出判读时得出错误结论。
依据: `packages/brain/scripts/coding-workflow/runner/status.mjs` 的 `parseArgs` 在遇到 `--log-dir` 时无条件取下一个参数作为目录，因此会吞掉 `--json`；`opts.json` 仍为 false，`collectStatus('--json')` 返回空数组。S-1 写“`--log-dir` 后没有值时回落默认目录”，Q-2 只测目录不存在，没有覆盖选项紧随其后的漏值形状。
说明: 按现有 CLI 如实限定“漏值回落”仅发生在 `--log-dir` 位于参数末尾时，并在手册及 QA 场景中覆盖 `--log-dir --json` 的实际输出，避免将其当作默认目录的 JSON 检查结果。

### R-2
针对: S-1, Q-2, I-1
严重度: 重要
场景: 运维员误把一个普通文件作为 `--log-dir` 路径运行 `status.mjs --log-dir <文件> --json`，得到 `[]` 和退出码 0，手册只按“目录不存在或没有回执”解释空结果，漏掉路径类型错误这一排查方向。
依据: `packages/brain/scripts/coding-workflow/runner/status.mjs` 的 `collectStatus` 把 `fs.readdirSync(logDir)` 的所有异常统一捕获并返回 `[]`；S-1 与 Q-2 只列不存在目录及空目录，未覆盖权限不足等读取失败。
说明: 手册应说明 `[]` 也可能表示路径不是目录或目录无法读取，给出只读核对路径类型与访问权限的步骤；Q-2 增加普通文件路径这一可稳定复现的场景。
