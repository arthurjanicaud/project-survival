"""Independent, quiet-until-state-changes watchdog. No LLM, orders or START."""
from datetime import datetime,timezone
from pathlib import Path
import json,os
import httpx
from dotenv import dotenv_values
ROOT=Path(__file__).resolve().parents[1]
def inspect(health,at):
    if not isinstance(health,dict):return 'Réponse de santé illisible'
    run=health.get('run',{});state=health.get('state',{})
    if run.get('status') not in ['RUNNING','CLOSING']:return None
    deadline=state.get('betting_deadline')
    research_closed=deadline and at>=datetime.fromisoformat(deadline.replace('Z','+00:00'))
    last=state.get('last_cycle') if run.get('status')=='CLOSING' or research_closed else run.get('last_scan')
    last=last or run.get('started_at')
    if not last:return 'Aucune progression enregistrée depuis le lancement'
    mode=(health.get('health') or {}).get('research_mode')
    if mode=='RESERVED':return 'Recherche suspendue pour préserver le budget de stockage ; comptes et règlements prioritaires'
    age=(at-datetime.fromisoformat(last.replace('Z','+00:00'))).total_seconds()/60
    if mode=='PACED':return 'Recherche espacée pour préserver le budget de stockage' if age<=45 else 'Aucune progression depuis plus de 45 minutes malgré le rythme réduit'
    return 'Progression interrompue depuis plus de 20 minutes' if age>20 else None
def main():
    cfg={**dotenv_values(ROOT/'.env'),**os.environ};file=ROOT/'data/reform-watchdog.json';file.parent.mkdir(parents=True,exist_ok=True)
    old=json.loads(file.read_text()) if file.exists() else {};new={};at=datetime.now(timezone.utc)
    with httpx.Client(timeout=30) as client:
        for stage in ['full','shadow','pilot']:
            try:
                r=client.get(cfg['COUNCIL_API_URL']+'/api/health',params={'phase':'4','stage':stage})
                body=r.json()
                if body.get('error')=='STORAGE_DAILY_QUOTA_EXCEEDED':
                    new={'storage':'Quota quotidien Cloudflare atteint. Données conservées ; reprise automatiquement retentée après la remise à zéro à 01 h, heure de Paris (heure d’hiver).'};break
                r.raise_for_status();reason=inspect(body,at)
                if reason:client.post(cfg['COUNCIL_API_URL']+'/admin/tick',params={'phase':'4','stage':stage},headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']}).raise_for_status()
            except (httpx.HTTPError,ValueError,TypeError,AttributeError):reason='Le moteur de cette étape est inaccessible depuis le contrôle externe'
            new[stage]=reason
        changes=[key for key in set(old)|set(new) if old.get(key)!=new.get(key) and (old.get(key) or new.get(key))]
        if changes:
            topic=cfg.get('COUNCIL_NTFY_TOPIC')
            if not topic:raise RuntimeError('Independent notification topic is not configured')
            incidents={key:value for key,value in new.items() if value}
            message=' '.join(dict.fromkeys(incidents.values())) if incidents else 'Le contrôle externe constate à nouveau une progression récente de la recherche.'
            client.post('https://ntfy.sh',json={'topic':topic,'title':'Survival : incident technique' if incidents else 'Survival : recherche rétablie','message':message,'priority':4 if incidents else 3,'click':cfg.get('PUBLIC_ORIGIN','https://project-survival.pages.dev')+'/?phase=4'}).raise_for_status()
        file.write_text(json.dumps(new),encoding='utf-8')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as output:output.write('storage_blocked='+str('storage' in new).lower()+'\n')
    print(json.dumps({'watchdog':'checked','active_incidents':sum(x is not None for x in new.values())}))
if __name__=='__main__':main()
