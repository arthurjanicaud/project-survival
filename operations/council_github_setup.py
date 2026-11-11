"""Configure the existing repository's phase 3 secret without printing it."""
import base64
import json
import subprocess
from dotenv import dotenv_values
import httpx
from nacl.public import PublicKey,SealedBox
from nacl.encoding import Base64Encoder

def main():
    c=dotenv_values('.env')
    credential=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
    values=dict(line.split('=',1) for line in credential.stdout.splitlines() if '=' in line)
    root='https://api.github.com/repos/arthurjanicaud/project-survival'
    with httpx.Client(headers={'Authorization':'Bearer '+values['password'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},timeout=30,follow_redirects=True) as client:
        r=client.get(root+'/actions/secrets/public-key');r.raise_for_status();key=r.json()
        for name in ['COUNCIL_ADMIN_TOKEN','COUNCIL_NTFY_TOPIC']:
            encrypted=SealedBox(PublicKey(key['key'],Base64Encoder)).encrypt(c[name].encode())
            out=client.put(root+'/actions/secrets/'+name,json={'encrypted_value':base64.b64encode(encrypted).decode(),'key_id':key['key_id']});out.raise_for_status()
        old=client.get(root+'/actions/variables/COUNCIL_API_URL')
        value={'name':'COUNCIL_API_URL','value':c['COUNCIL_API_URL']}
        out=client.patch(root+'/actions/variables/COUNCIL_API_URL',json=value) if old.status_code==200 else client.post(root+'/actions/variables',json=value)
        out.raise_for_status()
        print(json.dumps({'github_configuration':'updated','secret_names':['COUNCIL_ADMIN_TOKEN','COUNCIL_NTFY_TOPIC'],'variables':['COUNCIL_API_URL']}))
if __name__=='__main__':main()
