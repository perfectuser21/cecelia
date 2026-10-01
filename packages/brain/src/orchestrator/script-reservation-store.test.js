import {describe,expect,it} from 'vitest';
import {createScriptReservationStore} from './script-reservation-store.js';
const pool={connect(){throw new Error('unexpected_database_access');},query(){throw new Error('unexpected_database_access');}};
describe('脚本预约入口拒绝无效身份',()=>{
  it('无效owner在接触数据库前拒绝',async()=>{
    await expect(createScriptReservationStore(pool).reserve({ownerKey:'../../escape',configDigest:'a'.repeat(64)})).rejects.toThrow('invalid_reservation_identity');
  });
  it('未认证回执在接触数据库前拒绝',async()=>{
    await expect(createScriptReservationStore(pool).confirmCleanup({}, {authenticated:false})).rejects.toThrow('cleanup_receipt_unverified');
  });
  it('缺少精确容器ID不得写running',async()=>{
    await expect(createScriptReservationStore(pool).markRunning('id',{container_id:'short-name'})).rejects.toThrow('exact_container_id_required');
  });
});
