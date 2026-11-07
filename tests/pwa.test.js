import test from 'node:test';
import assert from 'node:assert/strict';
import {createPwaManager,APP_VERSION,APP_RELEASE_ID} from '../pwa.js';

const CURRENT={version:APP_VERSION,id:APP_RELEASE_ID};
const NEXT={version:'9.9.9',id:'a'.repeat(64)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Channel{
  constructor(){
    this.port1={onmessage:null,close(){}};
    this.port2={close(){},postMessage:data=>queueMicrotask(()=>this.port1.onmessage?.({data}))};
  }
}
class Worker extends EventTarget{
  constructor(version,state='activated'){super();this.version=version;this.state=state;this.activate=()=>{};}
  postMessage(message,ports){
    if(message.type==='GET_VERSION')ports[0].postMessage({type:'PISTA_VERSION',...this.version});
    else if(message.type==='SKIP_WAITING')this.activate();
  }
}
function fixture(shared){
  const window=new EventTarget(),document=new EventTarget(),display=new EventTarget();
  display.matches=false;document.visibilityState='visible';
  const serviceWorker=shared?.serviceWorker||new EventTarget(),registration=shared?.registration||new EventTarget();
  if(!shared){registration.active=new Worker(CURRENT);registration.waiting=null;registration.installing=null;serviceWorker.controller=registration.active;}
  let fetches=0,reloads=0,updates=0,registerOptions;
  const remote={value:CURRENT,error:null};
  registration.update=async()=>{updates++;return registration;};
  serviceWorker.register=async(url,options)=>{registerOptions={url,...options};return registration;};
  Object.assign(window,{
    document,navigator:{serviceWorker,onLine:true},isSecureContext:true,
    matchMedia:()=>display,MessageChannel:Channel,AbortController,setTimeout,clearTimeout,
    location:{reload(){reloads++;}},
    fetch:async(url,options)=>{
      fetches++;assert.equal(options.cache,'no-store');assert.match(url,/version\.json\?check=/);
      if(remote.error)throw remote.error;
      return {ok:true,json:async()=>remote.value};
    },
  });
  Object.defineProperty(window,'localStorage',{get(){throw new Error('The updater must not access training storage.');}});
  const snapshots=[];
  const manager=createPwaManager({environment:window,baseURL:'https://example.test/Pista/',onChange:s=>snapshots.push(s),timeout:100});
  function waiting(version=NEXT){
    const worker=new Worker(version,'installed');registration.waiting=worker;
    worker.activate=()=>{
      registration.waiting=null;registration.active=worker;worker.state='activated';serviceWorker.controller=worker;
      serviceWorker.dispatchEvent(new Event('controllerchange'));
    };
    return worker;
  }
  return {window,document,display,serviceWorker,registration,remote,manager,snapshots,waiting,get fetches(){return fetches;},get reloads(){return reloads;},get updates(){return updates;},get registerOptions(){return registerOptions;}};
}

test('update check reaches the server and registers with cache bypass without accessing training storage',async()=>{
  const f=fixture();assert.equal(f.manager.getState().status,'idle');
  await f.manager.start();
  assert.equal(f.manager.getState().status,'current');
  assert.equal(f.registerOptions.updateViaCache,'none');
  assert.equal(f.registerOptions.scope,'https://example.test/Pista/');
  assert.equal(f.fetches,1);assert.equal(f.reloads,0);
  f.manager.destroy();
});

test('offline, network failure and incomplete deployments never claim the app is current',async()=>{
  const f=fixture();f.window.navigator.onLine=false;
  await f.manager.start();assert.equal(f.manager.getState().status,'offline');assert.equal(f.fetches,0);
  f.window.navigator.onLine=true;f.remote.error=new Error('network unavailable');
  await f.manager.checkForUpdates({manual:true});assert.equal(f.manager.getState().status,'error');
  f.remote.error=null;f.remote.value=NEXT;
  await f.manager.checkForUpdates({manual:true});assert.equal(f.manager.getState().status,'error');
  assert.match(f.manager.getState().message,/bereitgestellt/);assert.equal(f.reloads,0);
  f.remote.value={version:'invalid',id:'not-a-release'};
  await f.manager.checkForUpdates({manual:true});assert.equal(f.manager.getState().status,'error');
  f.manager.destroy();
});

test('a waiting update reloads only after a click, while another open tab keeps its page',async()=>{
  const a=fixture(),b=fixture(a);
  await a.manager.start();await b.manager.start();
  a.remote.value=NEXT;b.remote.value=NEXT;a.waiting();
  await a.manager.checkForUpdates({manual:true});
  assert.equal(a.manager.getState().status,'available');assert.equal(a.manager.getState().reloadReady,false);
  assert.equal(a.reloads,0);assert.equal(b.reloads,0);
  assert.equal(await a.manager.applyUpdate(),true);await tick();
  assert.equal(a.reloads,1);assert.equal(b.reloads,0);
  assert.equal(b.manager.getState().status,'available');assert.equal(b.manager.getState().reloadReady,true);
  // The second tab has not checked the server yet; the active worker is still
  // sufficient evidence for an explicit refresh into that installed release.
  assert.equal(await b.manager.applyUpdate(),true);assert.equal(b.reloads,1);
  a.manager.destroy();b.manager.destroy();
});

test('background checks are throttled, manual checks and restored connectivity are not',async()=>{
  const f=fixture();await f.manager.start();
  f.document.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(f.fetches,1);
  await f.manager.checkForUpdates({manual:true});assert.equal(f.fetches,2);
  f.window.navigator.onLine=false;f.window.dispatchEvent(new Event('offline'));
  assert.equal(f.manager.getState().status,'offline');
  f.window.navigator.onLine=true;f.window.dispatchEvent(new Event('online'));await tick();
  assert.equal(f.fetches,3);assert.equal(f.manager.getState().status,'current');
  f.manager.destroy();
});

test('native installation prompt is used once and unsupported browsers get a safe fallback',async()=>{
  const f=fixture();await f.manager.start();
  assert.equal(await f.manager.install(),'unavailable');
  const event=new Event('beforeinstallprompt',{cancelable:true});let prompted=0;
  event.prompt=async()=>{prompted++;return {outcome:'accepted'};};
  event.userChoice=Promise.resolve({outcome:'accepted'});
  f.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);assert.equal(f.manager.getState().canInstall,true);
  assert.equal(await f.manager.install(),'accepted');assert.equal(prompted,1);
  assert.equal(await f.manager.install(),'unavailable');
  f.window.dispatchEvent(new Event('appinstalled'));
  assert.equal(f.manager.getState().installed,true);assert.equal(f.manager.getState().canInstall,false);
  f.manager.destroy();
  const unsupported=createPwaManager({environment:{navigator:{},isSecureContext:false}});
  assert.equal((await unsupported.start()).status,'unsupported');assert.equal(await unsupported.install(),'unavailable');
  unsupported.destroy();
});
