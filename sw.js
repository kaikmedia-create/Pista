// App shell only. Personal training data lives separately in localStorage.
const CACHE='pista-shell-v1.1';
const ASSETS=['./','./index.html','./styles.css','./refinements.css','./app.js','./core.js','./pdf.js','./logo.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pista-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  event.respondWith((async()=>{
    try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone()).catch(()=>{});}return response;}
    catch{const cached=await caches.match(event.request);if(cached)return cached;if(event.request.mode==='navigate'){const shell=await caches.match(new URL('./index.html',self.registration.scope).href);if(shell)return shell;}return new Response('Offline nicht verfügbar',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  })());
});
