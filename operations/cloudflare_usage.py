"""Read account-wide Durable Objects counters; no paid services or trading actions."""
from datetime import datetime,timezone
from pathlib import Path
import json,os
import httpx
from dotenv import dotenv_values
ROOT=Path(__file__).resolve().parents[1]

def collect(client,cfg,at=None):
    at=at or datetime.now(timezone.utc);day=at.date().isoformat()
    token=cfg.get('CLOUDFLARE_ANALYTICS_TOKEN')
    if not token:return {'configured':False,'reason':'Read-only Cloudflare analytics token missing'}
    account=cfg['CLOUDFLARE_ACCOUNT_ID']
    if len(account)!=32 or not all(c in '0123456789abcdef' for c in account.lower()):raise ValueError('Invalid account identifier')
    query='{viewer{accounts(filter:{accountTag:"'+account+'"}){durableObjectsPeriodicGroups(filter:{date:"'+day+'"},limit:1000){dimensions{namespaceId}sum{rowsRead rowsWritten}}}}}'
    response=client.post('https://api.cloudflare.com/client/v4/graphql',headers={'Authorization':'Bearer '+token},json={'query':query});response.raise_for_status();body=response.json()
    if body.get('errors'):raise RuntimeError('Cloudflare analytics denied or unavailable; no zero quota assumed')
    accounts=body.get('data',{}).get('viewer',{}).get('accounts',[])
    if len(accounts)!=1:raise RuntimeError('Cloudflare account not accessible')
    groups=accounts[0].get('durableObjectsPeriodicGroups')
    if groups is None or len(groups)>=1000:raise RuntimeError('Missing or truncated Cloudflare analytics')
    return {'configured':True,'source':'Cloudflare GraphQL','at':at.isoformat(),'day':day,'reads':sum(g['sum']['rowsRead'] for g in groups),'writes':sum(g['sum']['rowsWritten'] for g in groups),'namespace_count':len(groups),'scope':'whole-account','delayed_metrics':True}

def main():
    cfg={**dotenv_values(ROOT/'.env'),**os.environ}
    with httpx.Client(timeout=30) as client:
        usage=collect(client,cfg)
        if usage['configured']:
            r=client.post(cfg['COUNCIL_API_URL']+'/admin/account-usage',params={'phase':'4','stage':'full'},headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']},json=usage);r.raise_for_status()
        print(json.dumps(usage))
if __name__=='__main__':main()
