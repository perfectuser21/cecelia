## Brain {VERSION} — 并发新增smoke入口生产隔离（原任务617259ae）

- preview真实PG入口按实际DB_*连接先拒写再冻结环境；默认socket保持拒绝，显式本地隔离测试连接保留原PG验收。
- Janitor只读请求禁读curl启动配置；新增私有本机回归证明请求方法和目标不被配置改写。
