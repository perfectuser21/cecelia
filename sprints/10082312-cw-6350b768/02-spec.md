---
task_id: 6350b768-b097-4441-84bb-903a8762f430
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# coding workflow runner 状态查看脚本 status.mjs —— 实现规格

现状依据：runner 把每任务回执写在 `cfg.logDir/<task_id>.json`（`runner/run-once.mjs:134`），日志在 `<task_id>.log`；`logDir` 默认 `~/.cecelia/coding-workflow-runner`，可由 `CODING_WF_LOG_DIR` 覆盖（`runner/lib/config.mjs:20`）；回执提炼已有 `summarizeReceipt`（`runner/lib/receipt.mjs:38`）。

### S-1
对应：I-1、I-2

新增文件：`packages/brain/scripts/coding-workflow/runner/status.mjs`

- 导出纯函数 `collectStatus(logDir)`：
  - 只扫 `logDir` 下 `*.json`（忽略 `.log` 等其他文件），按文件 `mtimeMs` **倒序**返回数组。
  - 每项：`{ task_id（文件名去 .json）, mtime（ISO 字符串）, status, failed_activity, reason_code, pr_url }`。
  - 解析方式：JSON 可解析且 `status ∈ {completed, partial, failed}` 且不含 `last_event` → 复用 `summarizeReceipt(receipt)` 取四字段；含 `last_event` 的进度快照 → `status: 'running'`，其余字段 null；JSON 解析失败 → `status: 'unreadable'`，其余字段 null。单个坏文件不影响其他条目。
  - `logDir` 不存在或无 `*.json` → 返回 `[]`（不抛错）。
- 导出 `formatStatus(rows)`：返回多行文本，每行一条，依次含 `task_id`、`status`、`mtime`，completed 行附 `pr_url`，非 completed 行附 `failed_activity=<..>` 与 `reason_code=<..>`；`rows` 为空时返回固定提示 `没有运行记录`（含该中文串）。
- CLI 入口（仅当 `import.meta.url` 对应 `process.argv[1]` 时执行）：
  - 参数 `--log-dir <dir>` 优先；未给时用 `loadConfig().logDir`（即尊重 `CODING_WF_LOG_DIR`）。
  - 可选 `--json`：输出 `JSON.stringify(rows)`（便于机器读取）；否则输出 `formatStatus(rows)`。
  - 任何情况（含目录不存在）都 `process.exitCode = 0`；目录不存在时输出含 `没有运行记录` 的提示，可附带目录路径。
- 风格：ESM、无新依赖，头部一行中文注释，与 `runner/lib/*.mjs` 一致；文件 < 500 行。

验证：
```bash
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir /tmp/cw-status-not-exist-$$; echo "exit=$?"
# 断言：输出含「没有运行记录」，exit=0
```

### S-2
对应：I-1、I-2

新增测试：`packages/brain/scripts/coding-workflow/runner/__tests__/status.test.mjs`（vitest，`fs.mkdtempSync(os.tmpdir())` 建临时 logDir，afterEach 清理）

用例与断言：
1. **completed 含 pr_url**：写 `aaaaaaaa-....json` = `{status:'completed', outputs:{pr_url:'https://github.com/x/y/pull/1'}, activities:[...]}`；`collectStatus` 该项 `status==='completed'`、`pr_url` 等于该 URL；`formatStatus` 输出包含该 URL。
2. **partial 含 failed_activity 与 reason_code**：写 `bbbbbbbb-....json` = `{status:'partial', activities:[{key:'intent',status:'completed'},{key:'build',status:'failed',attempts:[{reason_code:'tests_failed'}]}]}`；断言 `failed_activity==='build'`、`reason_code==='tests_failed'`，且 `formatStatus` 输出同时包含 `build` 与 `tests_failed`。
3. **按修改时间倒序**：用 `fs.utimesSync` 把 completed 回执设为较旧、partial 回执设为较新；断言 `collectStatus` 返回顺序为 partial 在前、completed 在后；CLI 文本输出中 partial 的 task_id 出现位置早于 completed 的。
4. **忽略非 json**：同目录放一个 `.log` 文件，不出现在结果中。
5. **目录不存在（I-2）**：`spawnSync(process.execPath, [STATUS_PATH, '--log-dir', <不存在路径>])`，断言 `status===0` 且 stdout 含 `没有运行记录`；`collectStatus(<不存在路径>)` 返回 `[]`。

验证：
```bash
cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs
# 断言：全部用例通过
```

### S-3
对应：I-3

不改动 runner 现有文件（`run-once.mjs`、`lib/*.mjs` 只被 `status.mjs` import 复用，不修改），确保新增文件不破坏现有 runner 测试。

验证：
```bash
cd packages/brain && npx vitest run scripts/coding-workflow/runner
# 断言：runner 目录下全部测试（含新增 status.test.mjs 与既有 run-once*/install/plan/runner-sh/sandbox-env）通过
```
