# PRD: 修复 LangGraph Harness Generator 静默失败（pr_url=null 死循环）

## 背景

LangGraph harness pipeline 在任务 `0154e285-0923-428a-af0e-d669d1dd0490`（已 cancelled）运行时暴露重大 bug：Generator 节点在 Docker 容器里 exit=0，但 state.pr_urls 里被填成字符串 `"null"`，Evaluator 拿到假 URL 无法验收，Fix 循环重复进入 Generator，最终撞 LangGraph recursionLimit=100 死循环。

证据已从 `logs/brain.log` + `cecelia_events` 表收集，三条根因叠加：

### 根因 A：容器内 git 不可用
- `docker/cecelia-runner/entrypoint.sh:36` 执行 `git config --global --add safe.directory '*'`，但宿主 `.gitconfig` 以 `:ro` 挂载到 `/home/cecelia/.gitconfig`，写入失败被 `|| true` 吞掉
- 结果：Claude 在容器里所有 git 操作都报 `fatal: detected dubious ownership in repository at '/workspace'`
- 实证：针对该 task 的 `cp-*ws1*` 分支在 GitHub 远端根本不存在

### 根因 B：extractField 正则太宽
- `packages/brain/src/harness-graph.js:183` 的正则 `pr_url:\s*(.+?)(?:\s+\w+:|\n|$)` 对输入 `pr_url: null\npr_branch: null` 贪婪匹配 `\s+\w+:`（会吃 `\n` 再吃 `pr_branch:`），提取出字符串 `"null"`
- 对明显无效值（`null`、`FAILED`、`none`、`undefined`、空字符串）无过滤
- 实证：cecelia_events 里 `"pr_url": "null"`, `"pr_urls": ["null"]`, `"pr_branches": ["null"]`

### 根因 C：SKILL 与 prompt 格式冲突（次要）
- `~/.claude-account1/skills/harness-generator/SKILL.md:160` 要求输出纯 JSON：`{"verdict":"DONE","pr_url":"..."}`
- `packages/brain/src/harness-graph.js:585` prompt 要求字面量：`pr_url: <URL>`
- 两种格式冲突，Claude 容易 fallback 到既非 JSON 也无 URL 的中间态

## 目标

1. **让容器里的 git 真的能用**：entrypoint 改为使用可写 `GIT_CONFIG_GLOBAL`，`safe.directory '*'` 真正生效
2. **让 extractField 拒绝无效值 + 支持多格式**：null/FAILED/none/空串 视为无提取；pr_url 对裸 URL / JSON 格式 / markdown 链接 fallback；pr_branch 对 cp- 分支名 fallback
3. **让 prompt 与 SKILL 对齐**：明确成功输出 `pr_url: <URL>`，失败输出 `pr_url: FAILED`，禁止 `null`；JSON 格式也被 fallback 正则覆盖

## 非目标

- 不改 `Dockerfile`（entrypoint.sh 是 COPY 进镜像的，需要 `docker build` 重建）
- 不改 `docker-executor.js` 的凭据注入逻辑（#2391/#2404 已修好）
- 不改 LangGraph 图结构、节点、条件边
- 不引入 output parser 库
- 不加 push 重试（第一次 push 失败说明真问题，应明确暴露）

## User Stories

- **作为** Brain harness 调度器，**我要** 在 Generator 容器内 git 操作能真正 push 分支，**以便** pipeline 不空转
- **作为** LangGraph extractField，**我要** 把 `null`/`FAILED` 等无效字符串视为无提取结果，**以便** 下游 Evaluator 不会拿到假 URL
- **作为** pipeline 运维，**我要** 在 Generator 输出里一眼看到 `pr_url: <URL>` 或 `pr_url: FAILED`，**以便** 故障时定位是 git push 失败还是 Claude 没听指令

## Given-When-Then

### GWT-1：entrypoint 可写 gitconfig
- Given 容器启动，宿主 `.gitconfig` 通过 `:ro` 挂载到 `/home/cecelia/.gitconfig`
- When entrypoint.sh 跑 `git config --global --add safe.directory '*'`
- Then 该命令 exit 0（不是被 `|| true` 吞的 device busy），且后续 `git remote -v` 能正常执行

### GWT-2：extractField 拒绝 null 字面量
- Given Claude 输出了 `pr_url: null\npr_branch: null`
- When 调用 `extractField(output, 'pr_url')`
- Then 返回 JavaScript `null`（不是字符串 `"null"`）

### GWT-3：extractField pr_url fallback 到裸 URL
- Given Claude 输出了 `PR created at https://github.com/foo/bar/pull/123` 或 `{"verdict":"DONE","pr_url":"https://github.com/foo/bar/pull/123"}`
- When 调用 `extractField(output, 'pr_url')`
- Then 返回 `https://github.com/foo/bar/pull/123`

### GWT-4：extractField pr_branch fallback 到 cp- 分支
- Given Claude 输出了 `Pushed branch cp-04191234-xxx-ws1` 但没有 `pr_branch:` 字面量
- When 调用 `extractField(output, 'pr_branch')`
- Then 返回 `cp-04191234-xxx-ws1`

### GWT-5：Generator prompt 强约束
- Given harness-graph 向 Generator 派 prompt
- When prompt 被生成
- Then 末尾包含明确输出约束：成功输出 `pr_url: <URL>`，失败输出 `pr_url: FAILED`，禁止 `null`

## FR-SC 编号

- **FR-1**: entrypoint.sh 用 `GIT_CONFIG_GLOBAL` 指向 `/tmp/gitconfig-rw` 可写副本
- **FR-2**: `extractField(text, name)` 对 `null`/`FAILED`/`none`/`undefined`/空串返回 null
- **FR-3**: `extractField` 对 pr_url 在字面量失败时 fallback 扫 `https://github.com/[\w-]+/[\w-]+/pull/\d+`
- **FR-4**: `extractField` 对 pr_branch 在字面量失败时 fallback 扫 `cp-\d{8,10}-[\w-]+`
- **FR-5**: harness-graph.js Generator prompt 明确成功/失败输出格式
- **SC-1**: 新增单元测试 `packages/brain/src/__tests__/extract-field-fallback.test.js` 覆盖 GWT-2/3/4 全部通过
- **SC-2**: 手动验证镜像 rebuild 后 `docker run ... --entrypoint bash cecelia/runner:latest -c "cd /workspace && git remote -v"` 成功

## OKR 对齐

- Cecelia Area / KR: Harness 自愈闭环可用（#2416 LangGraph 已上线，本 PR 修"看似 exit=0 实际静默失败"的盲区）

## 范围限定

- 只改 3 个文件：`docker/cecelia-runner/entrypoint.sh`、`packages/brain/src/harness-graph.js`、新增 `packages/brain/src/__tests__/extract-field-fallback.test.js`
- Docker 镜像 rebuild（不改 Dockerfile 本身）

## 假设与边界

- 假设宿主 `.gitconfig` 是 user.name/user.email 级配置，不含 credential helper（gh CLI 自己管）
- 假设 Claude 会遵守 prompt 里"失败输出 FAILED"约束——若不遵守，至少 extractField 也会把 `null` 挡住
- 边界：不处理容器被 OOM 杀掉的情况（那是 exit_code != 0，已被 runDockerNode 的 `success` 判断覆盖）

## 受影响文件

- `docker/cecelia-runner/entrypoint.sh`（改）
- `packages/brain/src/harness-graph.js`（改 `extractField` + Generator prompt）
- `packages/brain/src/__tests__/extract-field-fallback.test.js`（新）
- `docs/learnings/cp-0419190439-harness-generator-prurl-fix.md`（新，Learning 格式）

## 成功标准

- SC-1: `npm test -- extract-field-fallback` 在 `packages/brain` 全部通过
- SC-2: `docker build -t cecelia/runner:latest docker/cecelia-runner/` 成功且 `docker run --rm -v ~/.gitconfig:/home/cecelia/.gitconfig:ro -v ~/.config/gh:/home/cecelia/.config/gh:ro -v /Users/administrator/perfect21/cecelia:/workspace --entrypoint bash cecelia/runner:latest -c "cd /workspace && git remote -v && gh auth status"` 输出 remote + `Logged in to github.com account`
- SC-3: CI L1/L2/L3/L4 全绿
