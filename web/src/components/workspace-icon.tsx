export type WorkspaceIconName='overview'|'inventory'|'replenishment'|'suppliers'|'payments'|'activity'|'settings';
const paths:Record<WorkspaceIconName,string>={
 overview:'M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7',
 inventory:'m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10M7 5l9 4',
 replenishment:'M4 7h14l-3-3m3 3-3 3M20 17H6l3 3m-3-3 3-3',
 suppliers:'M3 21V7l8-4v18M11 9h10v12M6 8v2m0 3v2m0 3v2m9-8v2m3-2v2m-3 3v2m3-2v2M2 21h20',
 payments:'M3 6h18v14H3V6Zm0 4h18m-5 5h2M5 3h13',
 activity:'M3 12h4l3-8 4 16 3-8h4',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
};
export function WorkspaceIcon({name}:{name:WorkspaceIconName}){
 return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}
