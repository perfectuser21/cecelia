## Brain {VERSION} — 修复只读文档验收误判

- QA 证据门禁识别固定语法的完整只读 Markdown 断言，不再把数据中的 dry-run 字符串误当作空跑。
- 真实 dry-run、复合命令、未知 JavaScript 与吞错仍拒绝，保留原生完成事件和退出码核对。
