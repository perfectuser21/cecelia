import {test,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// 现有Brain CI自动发现本入口；子套件实际启动Worker、MCP和受控子孙进程。
test('冻结宿主工具的权限、幂等、断连收尾和Worker接线回归',()=>{
 const file=fileURLToPath(new URL('../../../scripts/commander-workflow/__tests__/skill-tools-mcp.node.mjs',import.meta.url));
 expect(()=>execFileSync(process.execPath,['--test',file],{timeout:20000,stdio:'pipe'})).not.toThrow();
},25000);
