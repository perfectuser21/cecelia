## 换思路

采纳传输路径优先的方向。评审文件没有单列 `## 换思路`，但 R-2 指出的阻断成立：QA 场景先前按直连预览端口写，受控 Codex 会话实际只能使用控制器授予的 Unix 桥。现将 S-3 的手册要求和 Q-5 的真人操作都改为本轮 `PREVIEW_URL` 配合继承的 `CURL_HOME` 发起 health 请求，并明确桥不可用时的停止结论；不新增预览能力或改变验收边界。

### R-2
处理: 采纳
说明: `lib/codex-session.mjs` 只放行预览能力绑定的 Unix socket 并注入 `CURL_HOME`；`lib/preview-bridge.mjs` 在该目录写入 `.curlrc`，`activities/evaluate.mjs` 将本轮预览 URL 交给 QA。S-3 和 Q-5 已改为在受控会话内使用原有 `CURL_HOME`，把提示词中的 `PREVIEW_URL` 赋给 shell 变量后运行 `curl -fsS "$PREVIEW_URL/api/brain/health"`，比对返回的 `git_sha` 与 PR head。用户可看到同 head 才允许继续的操作说明；验证时读取最终 README 并对照上述源码，在有能力的 QA 会话中检查真实 curl 输出。预览未就绪、未获能力或 SHA 漂移时不得判 PASS，按控制器的可重试结果或场景报告的 `CANNOT_VERIFY` 记录原因。
