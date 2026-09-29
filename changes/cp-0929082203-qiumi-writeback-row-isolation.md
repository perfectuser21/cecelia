## Brain {VERSION} — 秋米回写行隔离：删除页跳过、单行失败不再挡住整步

- notion-gtd-sync pushQiumiStatus：每行独立 try/catch；中文/英文页 404 或已归档 = 永久失败 → 记指纹跳过（返回值 skippedArchived 改名 skippedGone）；其余错误不记指纹、下轮重试，本轮其余行照常处理，末尾汇总报错。修 09-29 上一版只处理「已归档」后又被彻底删除页（GET 404）卡住整步、十余条已完成任务在中文表停在「排队」（任务 1613c0b5）。
