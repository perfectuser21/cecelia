# Learning: Harness Generator 静默失败（pr_url=null 死循环）

## 任务

修复 LangGraph Harness Generator 节点 exit=0 但 `state.pr_urls = ["null"]` 导致 Evaluator 永远 FAIL、Fix 循环死循环的问题。关联 Brain task `0154e285-0923-428a-af0e-d669d1dd0490`（已 cancelled）。

### 根本原因

**三条根因叠加**，任何一条都足以让 pipeline 失控，同时存在导致看似 exit 0 的深渊 bug：

1. **容器内 git 真的不可用**（路径 2，最底层）。`docker/cecelia-runner/entrypoint.sh:36` 执行 `git config --global --add safe.directory '*' 2>/dev/null || true`，但宿主 `~/.gitconfig` 通过 `-v ... :ro` 挂载到 `/home/cecelia/.gitconfig`，是只读文件；`git config --global` 默认写到同一路径，触发 `error: could not write config file ... Device or resource busy`，被 `|| true` 悄悄吞掉。结果：safe.directory 设置失败，所有后续 git 命令都撞 `fatal: detected dubious ownership in repository at '/workspace'`。Claude 在容器里根本 push 不出分支。

2. **extractField 正则太宽且不识别无效字面量**（路径 3）。`packages/brain/src/harness-graph.js:183` 的正则 `pr_url:\s*(.+?)(?:\s+\w+:|\n|$)` 对输入 `"pr_url: null\npr_branch: null"` 贪婪匹配 `\s+\w+:`（`\s+` 吃掉 `\n`，然后 `\w+:` 吃 `pr_branch:`），返回字符串 `"null"`。Brain 把这个字符串当合法 URL 塞进 `state.pr_urls[0]`，Evaluator 用这个"URL"去 `gh pr checks` 必然 FAIL，Fix 循环重入 Generator，直到撞 recursionLimit=100。

3. **SKILL.md 与 harness-graph.js prompt 格式冲突**（路径 1，次要但加剧）。`~/.claude-account1/skills/harness-generator/SKILL.md:160` 要求输出纯 JSON `{"verdict":"DONE","pr_url":"..."}`；`harness-graph.js:585` 的 prompt 要求 `pr_url: <URL>` 字面量。两套格式并存，Claude 容易输出既非 JSON、也无有效 URL、也不带明确"FAILED"语义的中间态（如 `pr_url: null`），让故障原因隐身。

### 修复

- **entrypoint.sh**：引入 `GIT_CONFIG_GLOBAL=/tmp/gitconfig-rw`（把宿主 gitconfig 复制一份到 /tmp 后导出变量），让 `git config --global` 真正写入可写文件。`safe.directory` 设置去掉 `|| true` 静默失败兜底，任何失败都会直接 kill 容器（cecelia/runner 用 `set -euo pipefail`），让故障暴露。
- **extractField**：引入 `INVALID_LITERALS` 集合（`null`/`FAILED`/`none`/`undefined`/`tbd`/`error`/`<url>` 等），字面量命中直接视为无提取；为 `pr_url` 加裸 GitHub PR URL fallback（兼容 SKILL.md 的 JSON 格式 + markdown 链接 + gh pr create 默认输出）；为 `pr_branch` 加 `cp-\d{8,10}-[\w-]+` fallback。正则改写：允许 key 被 `**` 或 `"` 包裹（JSON 兼容），值两端允许引号（自动剥掉），终结符改成前瞻 `[,}]` / `\n` / EOF（不再吞跨行）。
- **Generator prompt**：新增"输出格式"章节明确三种允许格式（字面量、JSON、失败用 FAILED），禁止 `null` 字面量、禁止仅用 markdown 链接、禁止隐藏失败。
- **单元测试**：21 个测试覆盖全部 GWT 场景（null/FAILED 拒绝 + pr_url URL fallback + pr_branch 分支 fallback + JSON 兼容 + 边界输入）。

### 下次预防

- [ ] 任何 `|| true` 兜底必须明确注释"此处失败可接受因为 X"，否则不允许使用（entrypoint 那行 `|| true` 隐藏了生产故障 3 天）。
- [ ] 对 LLM 输出的字段提取函数，必须有专门的无效字面量白名单（`null`/`FAILED`/`none`/空串），不能仅靠正则是否匹配来判断"有值"。
- [ ] 凡是需要 Claude 按特定格式输出的 prompt，必须在 prompt 末尾列"禁止事项"清单（含具体反例），并在 extractField 里加 fallback 解析器覆盖 SKILL.md 与 harness-graph.js prompt 两套格式。
- [ ] Docker 镜像内任何把宿主 `~/.gitconfig` 以 `:ro` 挂进去的场景，entrypoint 都必须通过 `GIT_CONFIG_GLOBAL` 指向可写副本，否则 `safe.directory`/`user.name`/`user.email` 设置全部会静默失败。
- [ ] LangGraph pipeline 撞 recursionLimit 时必须在 observability 记"最后几轮 node 的 state.pr_urls 值"以便事后排查；当前只记了 verdict，看不到"URL 字面值是什么字符串"。
