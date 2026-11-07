// Versioned app shell only. Haken, notes and imported plans stay in localStorage.
// A changed version.js is detected by the browser's service-worker update check.
importScripts('./version.js');
const RELEASE=globalThis.PISTA_RELEASE;
const CACHE='pista-shell-'+RELEASE.id;
const ROOT=self.registration.scope;
const assetURLs=new Set(Object.keys(RELEASE.assets).map(name=>new URL(name,ROOT).href));
const versionURL=new URL('version.js',ROOT).href;
const statusURL=new URL('version.json',ROOT).href;
const htmlURL=new URL('index.html',ROOT).href;
const checksum=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const versionResponse=()=>new Response('globalThis.PISTA_RELEASE = '+JSON.stringify(RELEASE,null,2)+';\n',{headers:{'Content-Type':'text/javascript; charset=utf-8'}});

async function verifiedFile(name,expected){
  const canonical=new URL(name,ROOT),requestURL=new URL(canonical);
  requestURL.searchParams.set('pista-release',RELEASE.id);
  const response=await fetch(requestURL,{cache:'no-store',credentials:'same-origin'});
  if(!response.ok||response.type==='opaque')throw new Error('App file unavailable: '+name);
  if(await checksum(await response.clone().arrayBuffer())!==expected)throw new Error('App file has not reached this release: '+name);
  return [canonical.href,response];
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    // Validate the entire release first. A partly deployed CDN cannot replace
    // a working offline copy with a mix of old and new modules.
    const verified=await Promise.all(Object.entries(RELEASE.assets).map(([name,expected])=>verifiedFile(name,expected)));
    const cache=await caches.open(CACHE);
    try{
      await Promise.all(verified.map(([url,response])=>cache.put(url,response)));
      // Reconstruct this worker's exact metadata, not a later network version.
      await cache.put(versionURL,versionResponse());
    }catch(error){await caches.delete(CACHE);throw error;}
    // Updates deliberately wait for the user's SKIP_WAITING message.
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await self.clients.claim();
    // Remove only superseded Pista shells; never touch other app caches or data.
    await Promise.all((await caches.keys()).filter(key=>key.startsWith('pista-shell-')&&key!==CACHE).map(key=>caches.delete(key)));
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='GET_VERSION')event.ports?.[0]?.postMessage({type:'PISTA_VERSION',id:RELEASE.id,version:RELEASE.version});
  if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
  // Status requests must reach the server, never a cached "current" response.
  if(url.pathname===new URL(statusURL).pathname)return;
  const canonical=url.origin+url.pathname;
  if(request.mode!=='navigate'&&!assetURLs.has(canonical)&&canonical!==versionURL)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),key=request.mode==='navigate'?htmlURL:canonical;
    const cached=await cache.match(key);
    if(cached)return cached;
    // Repair an evicted cache only with files from this exact release.
    try{
      const name=Object.keys(RELEASE.assets).find(name=>new URL(name,ROOT).href===key);
      const response=key===versionURL?versionResponse():name?(await verifiedFile(name,RELEASE.assets[name]))[1]:null;
      if(response){await cache.put(key,response.clone());return response;}
    }catch{/* Keep the error local; never serve unverified replacement code. */}
    return new Response('Die App-Datei ist nicht verfügbar. Bitte die App mit Internetverbindung erneut öffnen.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});
