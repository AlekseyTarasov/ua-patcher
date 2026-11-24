// node tools/cli.mjs <game id> <your file> <out file> [--option ...]   (the same patcher as the web page)
//   e.g. node tools/cli.mjs liquidator liquidator_rus.jar liquidator_ua.jar --lilkaHelp
import { readFileSync, writeFileSync } from 'node:fs';
import { applyPatch } from '../core/patcher.js';
const [, , game, src, dst, ...flags] = process.argv;
const patch = JSON.parse(readFileSync(new URL(`../games/${game}/patch.json`, import.meta.url)));
const options = Object.fromEntries(flags.filter((f) => f.startsWith('--')).map((f) => [f.slice(2), true]));
const blob = await applyPatch(new Uint8Array(readFileSync(src)), patch, options, console.log);
writeFileSync(dst, new Uint8Array(await blob.arrayBuffer()));
console.log('ok:', dst);
