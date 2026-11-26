import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// 冻结小型测试入口，保留真实子进程与生产逐次来源校验。
export function frozenNodeCommand(root,node=process.execPath){
 const command=path.join(root,'node-command');
 const quoted="'"+node.replaceAll("'", "'\"'\"'")+"'";
 const source=`#!/bin/sh\nexec ${quoted} "$@"\n`;
 fs.writeFileSync(command,source,{mode:0o755});
 return {command,command_sha256:createHash('sha256').update(source).digest('hex')};
}
