## Brain {VERSION} — legacy bridge任务一次性有头接管

- 增加严格认证、真实row_version CAS与原coding路由资格检查；持久owner与advisory屏障保护执行及结果证据，保留人赢元数据编辑、同session心跳/result回写及提交后owner授权交接。
- 接管POST与两类任务PATCH在认证和数据库访问前安装固定每IP每分钟300次限流；超额返回429，保留原会话、元数据、结果及交接合同。
- 保留精确接棒smoke及注册表锚点；真实普通与有头旧PATCH验证提交后保存交接，失败不保存交接，复活单测保留原业务断言。
- 退役smoke改为守卫核DB后执行私有真实HTTP/PG派发入口验收，覆盖退役终态与资源拒绝；保留生产dispatcher字节，验收范围不包括共享全局tick整轮。
