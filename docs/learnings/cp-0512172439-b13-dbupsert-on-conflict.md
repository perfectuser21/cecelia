# Learning — B13 graph restart 不幂等致 task failed

### 根本原因

harness-initiative.graph.js 两处 INSERT initiative_contracts (initiative_id, version=1, ...) 没 ON CONFLICT 子句。LangGraph 从 PG checkpoint resume 时该节点 retry 撞 unique (initiative_id, version) PK violation，graph throw → task failed。

第一次写时假设"每个 initiative 只 INSERT 一次"，没考虑 graph 节点 restart resume 路径必须幂等。

### 下次预防

- [ ] LangGraph 节点内的 SQL INSERT 必须幂等：用 ON CONFLICT DO UPDATE/NOTHING 或先 SELECT 判断
- [ ] 任何 checkpoint resume 路径上的 side effect 都要假设会重复执行
- [ ] 设计新 graph 节点时把 dbUpsert 当默认模式，不用裸 INSERT
- [ ] integration test 应该模拟"调用两次同 SQL"验证幂等
