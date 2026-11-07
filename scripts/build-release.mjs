// Regenerate after editing app files; --check is the publication gate.
// Node built-ins only. Generated metadata never contains local user data.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=[
  'index.html','styles.css','refinements.css','tracker.css',
  'app.js','core.js','tracker-view.js','training-plan.js','pdf.js','pwa.js','github-backup.js',
  'logo.svg','manifest.webmanifest',
  'icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png',
];
const digest=content=>createHash('sha256').update(content).digest('hex');
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))throw new Error('package.json needs a valid release version.');
const assets=Object.fromEntries(await Promise.all(files.map(async name=>[name,digest(await readFile(path.join(root,name)))])));
// Include the worker itself so a worker-only change also gets a new cache.
// version.js and version.json are generated from these inputs, never self-hashed.
const worker=digest(await readFile(path.join(root,'sw.js')));
const id=digest(JSON.stringify({version,worker,assets}));
const release={version,id,assets};
const outputs={
  'version.json':JSON.stringify(release,null,2)+'\n',
  'version.js':'globalThis.PISTA_RELEASE = '+JSON.stringify(release,null,2)+';\n',
};
if(process.argv.includes('--check')){
  for(const [name,expected] of Object.entries(outputs)){
    const actual=await readFile(path.join(root,name),'utf8').catch(()=>null);
    if(actual!==expected)throw new Error(`${name} is out of date. Run npm run release:build before committing this release.`);
  }
  console.log(`Release ${version} (${id.slice(0,12)}): all ${files.length} app files verified.`);
}else{
  for(const [name,content] of Object.entries(outputs))await writeFile(path.join(root,name),content);
  console.log(`Built release ${version} (${id.slice(0,12)}) from ${files.length} app files.`);
}
