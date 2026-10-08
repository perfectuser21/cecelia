#!/usr/bin/env node
// 假 gh：把 argv（JSON 一行）追加到 FAKE_GH_LOG，按 FAKE_GH_EXIT 退出（默认 0）。
import fs from 'node:fs';

if (process.env.FAKE_GH_LOG) {
  fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
}
process.exit(Number(process.env.FAKE_GH_EXIT || 0));
