export const legacyScopes=['full','shadow','pilot'] as const;
export const scopes=['full','shadow','pilot','active','smoke'] as const;
export type Scope=typeof scopes[number];
export const newScopes=['active','smoke'] as const;
export const ids={full:'survival-004-active',shadow:'survival-004-shadow',pilot:'survival-004-pilot',active:'survival-005-active',smoke:'survival-005-smoke'};
export const engineStage=(s:string)=>s==='active'||s==='smoke'?'FULL':s.toUpperCase() as 'FULL'|'SHADOW'|'PILOT';
