## Brain {VERSION} — coding harness：QA 碰生产判定只认真正的访问，执行记录落盘、升级带证据

- 金丝雀 3e8414f6（PR #6160）的真人 QA 被判 evaluate_touched_production 致命并升级，但会话执行记录没存、升级只有原因码，无从判断真越界还是误判；而规格 Q-n 本就写着 localhost:5221。
- 判定收紧为「真正发出访问」：命令按 ; && || | 切段，同段既有访问动作（curl/wget/nc/psql/ssh/fetch…）又指向生产（:5221、localhost 5221、100.79.41.61、us-vps）才算；变量赋值指向生产且有访问动作也算。grep/cat/sed 读到这些字样不算。
- evaluate 收 transcript_path 时把会话执行记录落盘；QA 门把它放在 runner 日志目录 `qa-<pr>-r<round>.jsonl`，评估出错的日志与升级记录带上 evidence 和执行记录路径。
- spec 提示词：QA 场景不写死地址，一律写 `<预览环境>/api/brain/...`。
