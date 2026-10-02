import { expect,it } from 'vitest';
import { reverseImplementationPaths,validateImplementationImpact } from '../implementation-impact.js';
it('逆向图精确路径、环与节点上限可审计',()=>{
  const edges=[{src_path:'a',dst_path:'b'},{src_path:'b',dst_path:'c'},{src_path:'c',dst_path:'b'},{src_path:'other/b',dst_path:'elsewhere'}];
  expect(reverseImplementationPaths(edges,['c'],{max_depth:10,max_nodes:10})).toMatchObject({paths:['a','b','c'],truncated:false});
  expect(reverseImplementationPaths(edges,['c'],{max_depth:10,max_nodes:2})).toMatchObject({paths:['b','c'],truncated:true});
});
it('空图保留起点；输入不能伪造版本或digest类型',()=>{
  expect(reverseImplementationPaths([],['src/x.js']).paths).toEqual(['src/x.js']);
  const input={scope:'map',repo:'owner/repo',base_revision:'a'.repeat(40),head_revision:'b'.repeat(40),changed_files:['x.js']};
  expect(validateImplementationImpact(input).changed_files).toEqual([{path:'x.js'}]);
  expect(()=>validateImplementationImpact({...input,head_projection_digest:['a'.repeat(64)]})).toThrow();
});
