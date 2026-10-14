# 交互式 Commander 纠偏记录：文档事实与 QA 边界

- 任务：`3a27ca36-7be9-4efc-a27f-18361dae6557`，PR #6433。
- 纠偏所属根任务：`9c85169e-1023-4236-a411-23efa1b4f158`。
- actor：`codex-headed-cw-migration`，由根会话授权的交互式 Codex 处理；本文件不是无人值守 Commander 或独立裁判生成的裁决。
- 复核基准：QA 检出 `6746ab4cc458414a29e5e913cb00cb11d3e641f1`，QA/裁判记录提交 `53668390ae651fbedaaa991ae92bac9cac58c29f`。
- 结论：旧 QA/裁判 PASS 是真实流水线历史，但不足以接受交付。独立内容复核 FAIL；新产品提交必须重新经过 CI、正式 QA 和独立裁判，不能沿用旧批准。

## 已确认的两个问题

1. **DOC-1：README 错称预览地址自动继承。** `lib/codex-session.mjs` 注入 `CURL_HOME`，`activities/evaluate.mjs` 将 `PREVIEW_URL` 放入提示词。旧 README 将二者都写为继承，curl 示例没有给 `PREVIEW_URL` 赋值。QA 自己赋值后 health 请求成功，不能证明该操作说明正确。本次改为明确从本轮控制器提示词复制完整地址，在同一 shell 先赋值，并保留自动注入的 `CURL_HOME`；禁止自选上游或代入生产地址。
2. **QA-SCOPE-1：为截图门执行了合同之外的浏览器操作。** `02-spec.md` 的 Q-6 明确“不执行依赖安装、Chromium 启动或合并”。第三次评估为满足截图检查运行 `qa-playwright.cjs`，新建浏览器上下文访问预览根页，截图内容是 Brain 状态 JSON。真实原生事件 `item_15`、`item_29`、`item_30` 证明执行发生；截图只证明根页访问，不能替代文档与源码一致性，也不能取消原合同的禁止操作。

## 保留的历史与证据

- 合同评审曾因 R3 到轮次上限形成 `FORCED`，不改称自然批准。
- 第一次 QA 返回 `qa_evidence_unverified`（T-6）；原生命令有尾空格，独立只读回放确认匹配失败。
- 第二次 QA 返回 `qa_screenshot_missing`（T-5、T-6）；文档断言中的浏览器词被误当实际浏览器使用。
- 第三次 QA 和独立 Codex `gpt-6-astra` 裁判给出 PASS；其报告、截图、原生事件仍保留，原文件不改判、不删改。
- 根会话于 2026-10-14 12:14:57 UTC 在持锁状态下保留旧 rounds、撤销批准，登记 `independent_content_review_failed`，并同步独审 FAIL。PR 保持 draft 以防交付过门。
- 独立证据目录：`~/.codex-team1/artifacts/codex-primary-20261014/canary-qa-third-observed/`；结论文件 `independent-content-review.json`，含报告、原生事件、README 与截图摘要。

## 本次最小修正及重新验收要求

- 产品修改仅 README；保留 `01-intent.md`、`02-spec.md` 和全部旧验收记录，不缩减 I-1 至 I-3 或 Q-1 至 Q-6。
- DOC-1 在修订前用真实文件与 shell 复现：初始未设置 `PREVIEW_URL` 时旧片段退出 1；修订后把提示词占位符替换为隔离 fixture 地址，同一片段退出 0，并确认传给 curl 的完整地址正确、`CURL_HOME` 未改变。此检查用 curl 函数核参数，没有网络、模型或浏览器调用；证据为 `canary-doc-fix/before.json`、`after.json` 和 `check-doc-preview.py`。这不是正式预览 QA 的替代品。
- README 同步说明版本化 `runner/runtime-deps` 清单、Playwright 1.62.1 与 Acorn 8.16.0，以及 Acorn 缺失/版本不符的停止错误。该清单与健康门来自独立运行时修复，本 PR 原始基线尚不包含；正式新一轮验收前必须对齐已合入、已部署的实际实现，不能拿旧版健康结果证明新门通过。
- 下一轮按原合同只读核对文档/源码，并通过控制器授予的同源 Unix 桥检查当前 PR/head 的 health。显式核对 README 对提示词地址和环境变量的区别，不能只检关键词存在。
- 下一轮不得启动无关浏览器、制造截图或删除浏览器术语来满足关键词门。截图分类器若仍把只读文档断言误判为浏览器使用，应保留实际阻断并报告，先修验收器，不削弱真正浏览器场景必须有真实截图的规则。
- 依赖安装、维护用 Chromium 启动、账号调用、服务操作和生产访问仍不属于本次文档 QA；ZenithJoy PR #2132 保持待人工，未授权合并。
