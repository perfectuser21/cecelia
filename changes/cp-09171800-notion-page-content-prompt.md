## Brain {VERSION} — Notion 排单正文作为任务 prompt

- pullNotionTasks 读取页面正文（blocks API，异常不阻塞排单）：普通排单入 description；ssh 派发以 base64 写达执行机 ~/brain-runs/<run_id>.prompt 并替换 command 的 {PROMPT_FILE} 占位；webhook 派发 payload 带 prompt 字段
