import {it,expect,vi} from 'vitest';
import {prepareSharedFreeze} from './shared-freeze.js';
it('共享版本缺失或跨Activity时在读取来源前拒绝',async()=>{
 const read=vi.fn();
 await expect(prepareSharedFreeze({reuse_activity_id:'a',reuse_activity_definition_version_id:'v'},[],read)).rejects.toThrow(/共享/);
 await expect(prepareSharedFreeze({reuse_activity_id:'a',reuse_activity_definition_version_id:'v'},[{id:'v',activity_id:'other'}],read)).rejects.toThrow(/共享/);
 expect(read).not.toHaveBeenCalled();
});
