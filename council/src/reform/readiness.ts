import {CATEGORIES,type Category} from '../domain';
export function launchReadiness(checks:Partial<Record<Category,any>>,at=Date.now()){
  const domains=CATEGORIES.map(category=>{const check=checks[category],age=at-Date.parse(check?.at||'');const ready=!!check?.pipeline_ready&&Number.isFinite(age)&&age>=-5000&&age<900000;
    return {category,ready,checked_at:check?.at||null,reason:ready?'Règles, carnet et données extérieures utilisables vérifiés.':!check?'Précontrôle non exécuté.':!check.pipeline_ready?'Aucun dossier complet exploitable ; connecteur ou calendrier à vérifier.':'Précontrôle périmé, à relancer.'};});
  return {ready:domains.every(d=>d.ready),domains,as_of:new Date(at).toISOString(),limitation:'Readiness proves connectivity and a complete dossier, never profitability or a future provider SLA.'};
}
