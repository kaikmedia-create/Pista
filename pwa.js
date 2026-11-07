// Install/update lifecycle. This module never reads or changes training storage.
import './version.js';
const RELEASE=globalThis.PISTA_RELEASE;
export const APP_VERSION=RELEASE.version;
export const APP_RELEASE_ID=RELEASE.id;
const BASE=new URL('./',import.meta.url).href;
const MESSAGES={
  idle:'Updates werden automatisch geprüft.',
  checking:'Suche nach Updates …',
  current:'Die Web-App ist aktuell.',
  available:'Ein Update ist bereit. Haken und Notizen bleiben erhalten.',
  offline:'Du bist offline. Verbinde dich mit dem Internet, um nach Updates zu suchen.',
  error:'Das Update konnte nicht geladen werden. Bitte später erneut versuchen.',
  updating:'Update wird übernommen …',
  unsupported:'Dieser Browser unterstützt keine App-Updates. Öffne die Webseite erneut, um den neuesten Stand zu laden.',
};

export function createPwaManager({onChange=()=>{},environment=globalThis,baseURL=BASE,checkInterval=5*60*1000,timeout=20000}={}){
  const win=environment,doc=win.document,nav=win.navigator||{},sw=nav.serviceWorker;
  const supported=Boolean(sw&&win.isSecureContext!==false);
  const display=win.matchMedia?.('(display-mode: standalone)');
  const later=win.setTimeout?.bind(win)||setTimeout,cancel=win.clearTimeout?.bind(win)||clearTimeout;
  let installed=Boolean(nav.standalone||display?.matches),promptEvent=null;
  let registration=null,registering=null,checking=null,applying=null,started=false,lastCheck=0;
  let lastRelease=null,activeRelease=null,reloadRequested=false,reloadTarget=null,activationResult=null;
  const watched=new WeakSet(),listeners=[];
  let state={status:supported?'idle':'unsupported',message:MESSAGES[supported?'idle':'unsupported'],version:APP_VERSION,updateVersion:'',installed,canInstall:false,reloadReady:false};
  const getState=()=>({...state});
  function emit(patch={}){
    state={...state,...patch,installed,canInstall:!installed&&Boolean(promptEvent)};
    onChange(getState());
    return getState();
  }
  function status(value,patch={}){return emit({status:value,message:MESSAGES[value],...patch});}
  function listen(target,name,callback){
    target?.addEventListener?.(name,callback);
    listeners.push(()=>target?.removeEventListener?.(name,callback));
  }
  function timed(promise,ms=timeout){
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{timer=later(()=>reject(new Error('timeout')),ms);})]).finally(()=>cancel(timer));
  }
  function validVersion(value){return value&&/^[a-f0-9]{64}$/.test(value.id)&&typeof value.version==='string'&&value.version.length<=80;}
  function workerVersion(worker){
    if(!worker||!win.MessageChannel)return Promise.resolve(null);
    return new Promise(resolve=>{
      const channel=new win.MessageChannel();
      let timer,finished=false;
      const finish=value=>{if(finished)return;finished=true;cancel(timer);channel.port1.close();channel.port2.close();resolve(value);};
      timer=later(()=>finish(null),2500);
      channel.port1.onmessage=event=>finish(event.data?.type==='PISTA_VERSION'&&validVersion(event.data)?event.data:null);
      try{worker.postMessage({type:'GET_VERSION'},[channel.port2]);}catch{finish(null);}
    });
  }
  async function announceWaiting(worker){
    const version=await workerVersion(worker);
    if(!registration?.active||registration.waiting!==worker||!version||state.status==='updating')return;
    if(lastRelease&&version.id!==lastRelease.id)return;
    status('available',{updateVersion:version.version,reloadReady:false});
  }
  function watch(worker){
    if(!worker||watched.has(worker))return;
    watched.add(worker);
    worker.addEventListener('statechange',()=>{
      if(worker.state==='installed'&&registration?.waiting===worker)void announceWaiting(worker);
    });
    if(worker.state==='installed'&&registration?.waiting===worker)void announceWaiting(worker);
  }
  async function ensureRegistration(){
    if(registration)return registration;
    if(registering)return registering;
    registering=timed(sw.register(new URL('sw.js',baseURL).href,{scope:baseURL,updateViaCache:'none'})).then(reg=>{
      registration=reg;
      listen(reg,'updatefound',()=>watch(reg.installing));
      watch(reg.installing);watch(reg.waiting);
      return reg;
    }).finally(()=>{registering=null;});
    return registering;
  }
  function finishInstalling(worker){
    if(!worker||['installed','activated'].includes(worker.state))return Promise.resolve();
    if(worker.state==='redundant')return Promise.reject(new Error('install-failed'));
    return timed(new Promise((resolve,reject)=>{
      const changed=()=>{
        if(['installed','activated','redundant'].includes(worker.state)){
          worker.removeEventListener('statechange',changed);
          if(worker.state==='redundant')reject(new Error('install-failed'));else resolve();
        }
      };
      worker.addEventListener('statechange',changed);changed();
    }));
  }
  function finishActivation(worker){
    if(!worker||worker.state==='activated')return Promise.resolve();
    return timed(new Promise((resolve,reject)=>{
      const changed=()=>{
        if(['activated','redundant'].includes(worker.state)){
          worker.removeEventListener('statechange',changed);
          if(worker.state==='redundant')reject(new Error('install-failed'));else resolve();
        }
      };
      worker.addEventListener('statechange',changed);changed();
    }));
  }
  async function latestRelease(){
    const url=new URL('version.json',baseURL);url.searchParams.set('check',String(Date.now()));
    const controller=win.AbortController?new win.AbortController():null;
    const timer=controller?later(()=>controller.abort(),timeout):null;
    try{
      const response=await timed(win.fetch(url.href,{cache:'no-store',credentials:'same-origin',...(controller?{signal:controller.signal}:{})}));
      if(!response.ok)throw new Error('version-unavailable');
      const value=await timed(response.json());
      if(!validVersion(value))throw new Error('invalid-version');
      return value;
    }finally{if(timer!==null)cancel(timer);}
  }
  function failed(error){
    if(nav.onLine===false)return status('offline');
    return status('error',{message:error?.message==='release-mismatch'?'Das Update wird noch bereitgestellt. Bitte gleich noch einmal prüfen.':MESSAGES.error});
  }
  async function performCheck(){
    if(!supported)return status('unsupported');
    if(nav.onLine===false)return status('offline');
    status('checking');lastCheck=Date.now();
    try{
      lastRelease=await latestRelease();
      const reg=await ensureRegistration();
      await timed(reg.update());
      await finishInstalling(reg.installing);
      if(!reg.active)await finishActivation(reg.waiting||reg.installing);
      else if(reg.active.state==='activating')await finishActivation(reg.active);
      if(reg.waiting){
        const waiting=await workerVersion(reg.waiting);
        if(!waiting||waiting.id!==lastRelease.id)throw new Error('release-mismatch');
        return status('available',{updateVersion:waiting.version,reloadReady:false});
      }
      const current=await workerVersion(reg.active||sw.controller);
      if(!current||current.id!==lastRelease.id)throw new Error('release-mismatch');
      activeRelease=current;
      if(current.id!==APP_RELEASE_ID)return status('available',{updateVersion:current.version,reloadReady:true});
      return status('current',{updateVersion:'',reloadReady:false});
    }catch(error){return failed(error);}
  }
  function checkForUpdates({manual=false,force=false}={}){
    if(applying)return applying.then(()=>getState());
    if(checking)return checking;
    if(!manual&&!force&&lastCheck&&Date.now()-lastCheck<checkInterval&&!['offline','error'].includes(state.status))return Promise.resolve(getState());
    checking=performCheck().finally(()=>{checking=null;});
    return checking;
  }
  function reload(){
    reloadRequested=false;reloadTarget=null;
    activationResult?.resolve(true);activationResult=null;
    win.location.reload();
  }
  async function changedController(){
    const current=await workerVersion(sw.controller);
    if(!current)return;
    activeRelease=current;
    if(reloadRequested&&current.id===reloadTarget){reload();return;}
    // Another tab may have applied an update. Never reload an open workout or
    // note editor without an explicit click in this tab.
    if(current.id!==APP_RELEASE_ID)status('available',{updateVersion:current.version,reloadReady:true});
    else if(!checking&&state.status!=='offline')status('current',{updateVersion:'',reloadReady:false});
  }
  async function performApply(){
    if(!supported){status('unsupported');return false;}
    try{
      const reg=await ensureRegistration();
      const waiting=reg.waiting;
      if(waiting){
        const ready=await workerVersion(waiting);
        if(!ready||(lastRelease&&ready.id!==lastRelease.id))throw new Error('release-mismatch');
        status('updating',{updateVersion:ready.version});
        reloadRequested=true;reloadTarget=ready.id;
        const activated=new Promise((resolve,reject)=>{activationResult={resolve,reject};});
        waiting.postMessage({type:'SKIP_WAITING'});
        return await timed(activated);
      }
      const active=await workerVersion(sw.controller||reg.active);
      if(!active)throw new Error('release-mismatch');
      if(active.id!==APP_RELEASE_ID&&state.reloadReady&&active.id===activeRelease?.id){status('updating',{updateVersion:active.version});reload();return true;}
      if(lastRelease&&active.id!==lastRelease.id)throw new Error('release-mismatch');
      if(active.id!==APP_RELEASE_ID){status('updating',{updateVersion:active.version});reload();return true;}
      status('current',{updateVersion:'',reloadReady:false});return false;
    }catch(error){reloadRequested=false;reloadTarget=null;activationResult=null;failed(error);return false;}
  }
  function applyUpdate(){
    if(applying)return applying;
    applying=(checking?checking.then(performApply):performApply()).finally(()=>{applying=null;});
    return applying;
  }
  async function install(){
    if(installed)return 'accepted';
    if(!promptEvent)return 'unavailable';
    const event=promptEvent;promptEvent=null;emit();
    try{
      const result=await event.prompt(),choice=event.userChoice?await event.userChoice:result;
      return choice?.outcome==='accepted'?'accepted':'dismissed';
    }catch{return 'unavailable';}
  }
  function start(){
    if(started)return checking||Promise.resolve(getState());
    started=true;
    listen(win,'beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;emit();});
    listen(win,'appinstalled',()=>{installed=true;promptEvent=null;emit();});
    const displayChanged=()=>{installed=Boolean(nav.standalone||display?.matches);emit();};
    if(display?.addEventListener)listen(display,'change',displayChanged);
    else if(display?.addListener){display.addListener(displayChanged);listeners.push(()=>display.removeListener(displayChanged));}
    listen(win,'online',()=>{void checkForUpdates({force:true});});
    listen(win,'offline',()=>{if(state.status!=='updating')status('offline');});
    listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='visible')void checkForUpdates();});
    listen(win,'pageshow',event=>{if(event.persisted)void checkForUpdates();});
    if(supported)listen(sw,'controllerchange',()=>{void changedController();});
    emit();
    return checkForUpdates();
  }
  function destroy(){for(const remove of listeners)remove();}
  return {getState,start,checkForUpdates,applyUpdate,install,destroy};
}
