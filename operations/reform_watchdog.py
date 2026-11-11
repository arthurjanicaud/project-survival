"""Independent, quiet-until-state-changes watchdog. No LLM, orders or START."""
from datetime import datetime,timezone
from pathlib import Path
import json,os
import httpx
from dotenv import dotenv_values
ROOT=Path(__file__).resolve().parents[1]
def inspect(health,at):
    run=health.get('run',{});state=health.get('state',{})
    if run.get('status') not in ['RUNNING','CLOSING']:return None
    deadline=state.get('betting_deadline')
    research_closed=deadline and at>=datetime.fromisoformat(deadline.replace('Z','+00:00'))
    last=state.get('last_cycle') if run.get('status')=='CLOSING' or research_closed else run.get('last_scan')
    if not last:return 'Aucune progression enregistrée depuis le lancement'
    age=(at-datetime.fromisoformat(last.replace('Z','+00:00'))).total_seconds()/60
    return f'Progression interrompue depuis plus de 20 minutes' if age>20 else None
def main():
    cfg={**dotenv_values(ROOT/'.env'),**os.environ};file=ROOT/'data/reform-watchdog.json';file.parent.mkdir(parents=True,exist_ok=True)
    old=json.loads(file.read_text()) if file.exists() else {};new={};at=datetime.now(timezone.utc)
    with httpx.Client(timeout=30) as client:
        for stage in ['shadow','pilot','full']:
            try:
                r=client.get(cfg['COUNCIL_API_URL']+'/api/health',params={'phase':'4','stage':stage});r.raise_for_status();reason=inspect(r.json(),at)
                if reason:client.post(cfg['COUNCIL_API_URL']+'/admin/tick',params={'phase':'4','stage':stage},headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']}).raise_for_status()
            except httpx.HTTPError:reason='Le moteur de cette étape est inaccessible depuis le contrôle externe'
            new[stage]=reason
            if reason!=old.get(stage) and (reason or old.get(stage)):
                topic=cfg.get('COUNCIL_NTFY_TOPIC')
                if not topic:raise RuntimeError('Independent notification topic is not configured')
                client.post('https://ntfy.sh',json={'topic':topic,'title':'Survival : incident technique' if reason else 'Survival : reprise constatée','message':stage+' : '+(reason or 'Le contrôle externe constate à nouveau une progression récente.'),'priority':4 if reason else 3,'click':cfg.get('PUBLIC_ORIGIN','https://project-survival.pages.dev')+'/?phase=4&stage='+stage}).raise_for_status()
        file.write_text(json.dumps(new),encoding='utf-8')
    print(json.dumps({'watchdog':'checked','active_incidents':sum(x is not None for x in new.values())}))
if __name__=='__main__':main()
