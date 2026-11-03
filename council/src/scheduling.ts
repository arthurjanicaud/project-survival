// A cron heartbeat must repair an overdue alarm left after exhausted retries.
export function nextAlarm(current:number|null,jobAt:number,at:number,processing=false):number|null{
  if(processing||!Number.isFinite(jobAt))return null;
  const due=Math.max(at+100,jobAt);
  return current===null||current>due||current<at-5000?due:null;
}
