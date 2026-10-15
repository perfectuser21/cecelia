import { it, expect } from 'vitest';
import { applyTreeLegacyLayout } from '../tree-legacy-layout.js';

it('决策失效时拒绝写入，即使请求键曾用过', async () => {
  const sql=[];
  const connection={
    async query(statement){
      sql.push(statement);
      if(statement.startsWith('SELECT id,result FROM tasks')) return {rows:[{id:'task',result:{tree_legacy_layout_receipts:[{client_request_id:'same'}]}}]};
      if(statement.startsWith('SELECT id,made_by,status FROM decisions')) return {rows:[{id:'decision',made_by:'user',status:'expired'}]};
      return {rows:[]};
    },
    release(){},
  };
  await expect(applyTreeLegacyLayout({connect:async()=>connection},{
    task_id:'a2b3101f-f76b-4d13-816e-7c42926c2875',
    decision_id:'5155c28c-ce2a-4452-87d4-cefb0362bf34',
    client_request_id:'same',
  })).rejects.toMatchObject({status:409,code:'DECISION_INACTIVE'});
  expect(sql).toContain('ROLLBACK');
  expect(sql.some(statement=>statement.startsWith('UPDATE '))).toBe(false);
});
