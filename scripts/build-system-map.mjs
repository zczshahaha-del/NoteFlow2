import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const shell=await fs.readFile(path.join(repo,'design/noteflow-system-map.shell.html'),'utf8');
const fragment=await fs.readFile(path.join(repo,'design/noteflow-system-map.source.html'),'utf8');
const details=await fs.readFile(path.join(repo,'design/noteflow-system-map.details.js'),'utf8');
const flow=await fs.readFile(path.join(repo,'design/noteflow-system-map.flow.js'),'utf8');
const marker='<!-- SYSTEM_MAP_SOURCE -->';
if(shell.split(marker).length!==2)throw new Error('Expected one source marker');
const baseStyle=fragment.match(/<style>([\s\S]*?)<\/style>/);
if(!baseStyle)throw new Error('Missing map layout stylesheet');
const content=`<script>\n${details.replace(/<\/script/gi,'<\\/script')}\n${flow.replace(/<\/script/gi,'<\\/script')}\n</script>\n${fragment.replace(baseStyle[0],'')}`;
const output=path.join(repo,'design/noteflow-system-map.html');
await fs.writeFile(output,shell.replace('<style>',`<style>${baseStyle[1]}</style>\n  <style>`).replace(marker,content));
console.log(output);
