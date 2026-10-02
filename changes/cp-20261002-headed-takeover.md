## Brain {VERSION} — legacy bridge任务一次性有头接管

- 增加严格认证、真实row_version CAS与原coding路由资格检查；持久owner与advisory屏障保护执行及结果证据，保留人赢元数据编辑、同session心跳/result回写及提交后owner授权交接。
- 接管POST与两类任务PATCH在认证和数据库访问前安装固定每IP每分钟300次限流；超额返回429，保留原会话、元数据、结果及交接合同。
