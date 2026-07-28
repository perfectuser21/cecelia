#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { digestTree } from './release-run-tree-digest.mjs';

const [root] = process.argv.slice(2);
if (!isAbsolute(root ?? '')) process.exit(78);
process.stdout.write(digestTree(root));
