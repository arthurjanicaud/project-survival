"""Explicit administration of the isolated research protocol; no implicit START."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,gzip,os
import httpx
from dotenv import dotenv_values

ROOT=Path(__file__).resolve().parents[1]
TABLES=['meta','documents','markets','ledger','positions','fills','proposals','votes','calls','events','notifications','jobs','r4_packets','r4_evidence','r4_forecasts','r4_outcomes','r4_cycles','r4_assessments','r4_agendas','r4_models','r4_usage']
def configuration():return {**dotenv_values(ROOT/'.env'),**os.environ}
def request(command,stage='full',data=None):
    cfg=configuration();paths={'state':'/api/state','health':'/api/health','start':'/admin/start','archive-observation':'/admin/archive-observation','preflight':'/admin/preflight','tick':'/admin/tick','qualification':'/admin/qualification','seed-history':'/admin/seed-history','probe-azure':'/admin/probe-azure'}
    method='GET' if command in ['state','health','qualification'] else 'POST'
    r=httpx.request(method,cfg['COUNCIL_API_URL']+paths[command],params={'phase':'4','stage':stage},headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']},json=data if method=='POST' else None,timeout=120)
    r.raise_for_status();return r.json()
def export(stage,path):
    import time
    cfg=configuration();target=Path(path);target.mkdir(parents=True,exist_ok=True)
    params={'phase':'4','stage':stage}
    with httpx.Client(headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']},timeout=90) as client:
        for attempt in range(30):
            response=client.post(cfg['COUNCIL_API_URL']+'/admin/export-begin',params=params,json={})
            if response.status_code!=409:break
            time.sleep(1)
        response.raise_for_status();checkpoint=response.json()
        manifest={'exported_at':datetime.now(timezone.utc).isoformat(),'stage':stage,'tables':{},'state':checkpoint['state'],'checkpoint':checkpoint['lock']}
        try:
            for table in TABLES:
                after=0;count=0;file=target/(table+'.ndjson.gz')
                with gzip.open(file,'wt',encoding='utf-8',newline='\n') as out:
                    while True:
                        if datetime.now(timezone.utc)>=datetime.fromisoformat(checkpoint['lock']['until'].replace('Z','+00:00')):raise RuntimeError('Backup lock expired; do not use this incomplete snapshot')
                        response=client.get(cfg['COUNCIL_API_URL']+'/admin/export-page',params={**params,'table':table,'after':after,'limit':50});response.raise_for_status();page=response.json()
                        for row in page['rows']:
                            row.pop('export_cursor',None);out.write(json.dumps(row,ensure_ascii=False)+'\n');count+=1
                        after=page['next']
                        if page['done']:break
                if count!=checkpoint['counts'][table]:raise RuntimeError('Inconsistent backup row count: '+table)
                manifest['tables'][table]={'rows':count,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'file':file.name}
            (target/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        finally:
            response=client.post(cfg['COUNCIL_API_URL']+'/admin/export-end',params=params,json={'id':checkpoint['lock']['id']});response.raise_for_status()
    return {'saved':str(target),'tables':len(TABLES),'experiment':manifest['state']['run']['id'],'consistent_checkpoint':True}

def legacy_lessons(input_path):
    raw=json.loads(Path(input_path).read_text(encoding='utf-8'));positions=[{**x,'payload':json.loads(x['payload'])} for x in raw['positions']];closed=[x for x in positions if x['status']=='SETTLED'];fx=float(next(json.loads(x['value'])['fx']['usd_per_eur'] for x in raw['meta'] if x['key']=='state'))
    cheap=[x for x in closed if (float(x['cost'])-float(x['payload']['fees']))/float(x['quantity'])<.01]
    return {'origin_experiment':'survival-003','source_sha256':hashlib.sha256(Path(input_path).read_bytes()).hexdigest(),'observed_at':raw['exported_at'],
        'facts':{'bets':len(positions),'settled':len(closed),'profitable':sum(float(x['payload']['profit'])>0 for x in closed),'net_eur':sum(float(x['payload']['profit']) for x in closed)/fx,'under_one_percent_bets':len(cheap),'under_one_percent_wins':sum(float(x['payload']['profit'])>0 for x in cheap)},
        'lessons':['Les estimations de la phase 3 étaient souvent excessivement optimistes.','Une observation de station déjà réalisée peut exclure une tranche malgré une prévision favorable.','Les marchés du même événement et les prévisions du même modèle sont corrélés.','Les prix extrêmement faibles exigent un diagnostic des règles et des observations avant toute interprétation.'],
        'limitation':'Older protocol, selected sample, prices already visible to agents. Reference lessons only; not training or held-out validation credit for the new protocol.'}

def restore(path,instance,confirm):
    if not instance or not instance.startswith('recovery-r4-'):raise RuntimeError('Recovery requires a separate recovery-r4- namespace')
    target=Path(path);manifest=json.loads((target/'manifest.json').read_text(encoding='utf-8'))
    if manifest['state']['run']['id']!=confirm:raise RuntimeError('Explicit original experiment ID does not match the backup')
    for table,info in manifest['tables'].items():
        if table not in TABLES or Path(info['file']).name!=info['file']:raise RuntimeError('Invalid backup table/path')
        if hashlib.sha256((target/info['file']).read_bytes()).hexdigest()!=info['sha256']:raise RuntimeError('Backup SHA256 mismatch: '+table)
    cfg=configuration();params={'phase':'4','stage':manifest['stage'],'instance':instance}
    with httpx.Client(headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']},timeout=90) as client:
        def post(path,body):
            r=client.post(cfg['COUNCIL_API_URL']+path,params=params,json=body);r.raise_for_status();return r.json()
        post('/admin/restore-begin',{'manifest':manifest,'confirm':confirm})
        for table,info in manifest['tables'].items():
            batch=[];index=0
            with gzip.open(target/info['file'],'rt',encoding='utf-8') as f:
                for line in f:
                    batch.append(json.loads(line))
                    if len(batch)==50:post('/admin/restore-chunk',{'table':table,'index':index,'rows':batch});index+=1;batch=[]
            if batch:post('/admin/restore-chunk',{'table':table,'index':index,'rows':batch})
        return post('/admin/restore-finish',{})

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['state','health','start','preflight','tick','qualification','export','seed-history','probe-azure','restore','archive-observation']);p.add_argument('--stage',choices=['shadow','pilot','full'],default='full');p.add_argument('--confirm');p.add_argument('--output');p.add_argument('--input');p.add_argument('--instance');a=p.parse_args()
    if a.command in ['start','archive-observation'] and not a.confirm:raise RuntimeError('Explicit --confirm experiment-id is required')
    if a.command=='restore':
        if not a.input or not a.confirm:raise RuntimeError('--input backup directory and --confirm original ID are required')
        result=restore(a.input,a.instance,a.confirm)
    elif a.command=='export':
        if not a.output:raise RuntimeError('--output directory is required')
        result=export(a.stage,a.output)
    else:
        if a.command=='seed-history' and not a.input:raise RuntimeError('--input official phase3 export required')
        result=request(a.command,a.stage,legacy_lessons(a.input) if a.command=='seed-history' else {'confirm':a.confirm} if a.command in ['start','archive-observation'] else {})
        if a.output:Path(a.output).parent.mkdir(parents=True,exist_ok=True);Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');result={'saved':a.output}
    print(json.dumps(result,ensure_ascii=True,indent=2))
if __name__=='__main__':main()
