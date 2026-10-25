## 根NPM清单未进入实际CI来源（2026-10-25）

### 根本原因
正式来源gate在16c与73aed两次拒绝根package.json，其在三scope均无来源覆盖。锁文件、发布器、新测试各有匹配，不能借它们覆盖另一文件。CI实际root npm ci读取清单，collector却缺少静态输入证据；版本治理仅能证明版本变化，不能替代新增依赖来源。

### 下次预防
- [x] 先以固定Git真实缺关系和坏输入取得RED，再用固定完整CI、root install顺序和真实selected test到publisher静态import证明输入。publisher bare import逐root own声明验证，core-only合法，不把Brain的js-yaml借认root。
- [x] 所有条件完成后才提交读取及关系；无schema旧完整输出不变，未知入口、JSON、声明或读回差异闭口，不增aux角色或放宽joint。
- [x] 新runtime只接受完整新十成员组合，并保留旧九/十成员全组合及反作弊否证，不做逐文件OR，不改30 canonical。
- [ ] 本地回归不替代旧工具完整diff自举、正式CI、正常部署及来源和PR6640重新验收，历史失败原样保留。

任务427d7e49-27c5-4612-b115-9214f03d47f9，actor=codex-headed-cw-reliability。仅开发事件附件，不完成根任务、不替代冻结C01-C12。
