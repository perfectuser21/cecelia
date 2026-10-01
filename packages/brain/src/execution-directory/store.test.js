import {it,expect,vi} from 'vitest';
import {authorize,transaction} from './store.js';
it('无repo不能发起授权数据库操作',async()=>{
 const query=vi.fn();await expect(authorize({query},{surface:'harness'})).rejects.toThrow('execution_repo_required');expect(query).not.toHaveBeenCalled();
});
it('启动回调失败回滚同机授权事务并释放连接',async()=>{
 const commands=[];const release=vi.fn();const client={query:async sql=>commands.push(sql),release};
 await expect(transaction({connect:async()=>client},async()=>{throw Error('launch failed');})).rejects.toThrow('launch failed');
 expect(commands).toEqual(['BEGIN','ROLLBACK']);expect(release).toHaveBeenCalledOnce();
});
