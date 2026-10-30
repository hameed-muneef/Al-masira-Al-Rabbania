const url=process.env.VITE_SUPABASE_URL;
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw new Error('Missing public Supabase settings.');
const endpoint=new URL('/rest/v1/group_members',url);
endpoint.searchParams.set('select','role,joined_at,study_group:study_groups(*)');
endpoint.searchParams.set('limit','0');
const response=await fetch(endpoint,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
const body=await response.text();
let code='';
try{code=JSON.parse(body).code??''}catch{}
const denied=response.status===401&&code==='42501';
console.log(`Anonymous group_members read: ${denied?'denied as intended':`HTTP ${response.status}${code?` (${code})`:''}`}`);
if(!denied)process.exitCode=1;
