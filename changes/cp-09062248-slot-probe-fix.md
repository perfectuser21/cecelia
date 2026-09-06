## Brain {VERSION} — worker 池槽位探针修复(并行血管 P1 补丁2)

- 探针 display-message→list-panes:真机实证 display-message -p -t 不存在的会话返回空串+rc=0,空串被判 busy → 全槽假忙永不派发(金丝雀案 busy=3 而宿主无 slot7-9);空串防御性归 missing
