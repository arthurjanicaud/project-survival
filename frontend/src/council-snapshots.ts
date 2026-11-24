const BASE=import.meta.env.VITE_COUNCIL_SNAPSHOTS||'https://raw.githubusercontent.com/arthurjanicaud/project-survival/survival-state/data';
export async function snapshotUrl(path:string,stage:string){
 const request=new URL(path,'https://snapshot.local'),kind=request.pathname;
 let name:string;
 if(kind==='/api/state')name='state';else if(kind==='/api/events')name='events';else if(kind==='/api/meetings')name='meetings';
 else if(kind==='/api/meeting'||kind==='/api/document'){const id=request.searchParams.get('id');if(!id)throw Error('Référence manquante');const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));name=(kind==='/api/meeting'?'meeting-':'document-')+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
 else throw Error('Lecture de données non prise en charge');
 if(!['full','shadow','pilot'].includes(stage))throw Error('Phase inconnue');const u=new URL(BASE+'/'+stage+'/'+name+'.json');u.searchParams.set('v',String(Math.floor(Date.now()/15000)));return u;
}
