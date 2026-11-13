import type {ReformRepository} from './store';
// Delivery failures belong in the journal, never in a recursive delivery queue.
export function recordJobIncident(repo:ReformRepository,job:any,error:string,url:string){
  repo.event((job?.id||'r4:runtime')+':error:'+(job?.attempt||0),'INCIDENT','Incident technique : '+error,'SECRETARY',job?.kind==='R4_MEETING'?job.payload.id:null);
  if(job&&!String(job.kind).startsWith('NOTIFY'))repo.notify('r4:incident:'+job.id,'Incident au conseil',error,url,4);
}
export async function deliverNotificationJob(delivery:string|undefined,job:any,send:(id?:string)=>Promise<void>){
  // In relay mode the scheduled consumer owns delivery; this job merely records
  // that the outbox entry exists. No per-notification workflow dispatch.
  if(delivery!=='github-relay')await send(job.payload.id);
}
