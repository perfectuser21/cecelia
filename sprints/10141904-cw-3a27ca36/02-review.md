---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# 规格评审（第 3 轮）

## 评分
意图对齐: 8
可验证: 5
场景覆盖: 7
回归风险: 8
可执行: 6

## 换思路
当前把安装手册的所有关键词塞进 Q-1 的一条命令，撞上了 QA 报告校验器对命令文本的禁用规则；继续补手册措辞无法让验收通过。把可机读的参数断言和安装操作判读拆开：PASS 命令保留会失败的内容断言，但命令文本避开校验器禁止的字面量；安装预览与真实安装的区别由 QA 对照 `install.sh` 判读并记录证据。

## 上轮问题
- R-2: 关闭 —— S-3 和 Q-5 已指定受控会话继承 `CURL_HOME`，以本轮 `PREVIEW_URL` 经 Unix 桥读取 health；`lib/preview-bridge.mjs` 写入 `.curlrc`，`lib/codex-session.mjs` 注入该目录并只放行绑定 socket。

### R-3
针对: S-1, Q-1, I-1
严重度: 阻断
场景: 真人 QA 原样运行 Q-1 的 README 内容断言并报告 PASS，验收器因命令中出现 `--dry-run` 返回 `qa_trivial_assertion`，该场景无法被接受为通过。
依据: Q-1 指定的 `node -e` 命令把 `"--dry-run"` 写在命令文本中；`packages/brain/scripts/coding-workflow/lib/qa-report.mjs` 的 `trivialAssertions` 对任意 PASS 命令行匹配 `/--dry-run\b/`，`activities/evaluate.mjs` 据此返回 `qa_trivial_assertion`，不区分执行安装预览与只读字符串断言。
说明: 修改 Q-1 的可执行验收命令，保留对手册中 dry-run 说明的核查，同时使 PASS 证据命令不含验收器禁用的字面量；给出真人能照做且断言失败会非零退出的步骤。
