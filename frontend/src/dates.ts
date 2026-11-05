const dateFormatter=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const timeFormatter=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',second:'2-digit'});
function parsed(value:unknown):Date|null{
  if(typeof value!=='string'||!value.trim())return null;
  const date=new Date(value);return Number.isFinite(date.getTime())?date:null;
}
export function formatDate(value:unknown){const date=parsed(value);return date?dateFormatter.format(date):value?'Date indisponible':'À définir au lancement';}
export function formatTime(value:unknown){const date=parsed(value);return date?timeFormatter.format(date):'Heure indisponible';}
export function meetingTime(meeting:{started_at?:unknown;slot?:unknown;created_at?:unknown}):string|null{
  for(const value of [meeting.started_at,meeting.slot,meeting.created_at])if(parsed(value))return value as string;
  return null;
}
