## Brain {VERSION} — 秋米回写跳过已归档中文行

- notion-gtd-sync pushQiumiStatus：中文行已被主理人归档/删除（GET 见 archived/in_trash）→ 记指纹跳过，不再 PATCH；返回值新增 skippedArchived。修 09-28 起对同一归档页每 30s 重试（48h 586 次）且单行抛错中止整步、挡住同轮其余行的回写（任务 1613c0b5）。
