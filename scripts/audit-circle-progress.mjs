import {Client} from 'pg';
import {readFile} from 'node:fs/promises';

const {SUPABASE_PROJECT_REF:ref,SUPABASE_POOLER_HOST:host,SUPABASE_DB_PASSWORD:password}=process.env;
if(!ref||!host||!password)throw new Error('Missing database connection settings.');
const caPath=process.env.SUPABASE_DB_CA_FILE?.replace(/^\/mnt\/([a-z])\//,(_,drive)=>`${drive.toUpperCase()}:/`);
const ca=caPath?await readFile(caPath,'utf8'):undefined;
const client=new Client({host,port:5432,user:`postgres.${ref}`,database:'postgres',password,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},connectionTimeoutMillis:12000});
try{
  await client.connect();
  await client.query('begin read only');
  const table=await client.query(`select c.relrowsecurity as rls,
    has_table_privilege('authenticated','public.group_progress_sharing','SELECT') as member_read,
    has_table_privilege('authenticated','public.group_progress_sharing','INSERT,UPDATE,DELETE') as member_write,
    has_table_privilege('anon','public.group_progress_sharing','SELECT') as anonymous_read
    from pg_class c where c.oid='public.group_progress_sharing'::regclass`);
  const functions=await client.query(`select
    has_function_privilege('authenticated','public.set_group_progress_sharing(uuid,boolean)','EXECUTE') as set_member,
    has_function_privilege('anon','public.set_group_progress_sharing(uuid,boolean)','EXECUTE') as set_anon,
    has_function_privilege('authenticated','public.group_progress_summary(uuid)','EXECUTE') as summary_member,
    has_function_privilege('anon','public.group_progress_summary(uuid)','EXECUTE') as summary_anon`);
  const policy=await client.query(`select policyname,qual from pg_policies
    where schemaname='public' and tablename='group_progress_sharing'`);
  const result={...table.rows[0],...functions.rows[0],own_read_policy:policy.rows.some(row=>row.policyname==='own_group_sharing_read'&&row.qual.includes('auth.uid()'))};
  if(!result.rls||!result.member_read||result.member_write||result.anonymous_read||
    !result.set_member||result.set_anon||!result.summary_member||result.summary_anon||!result.own_read_policy){
    throw new Error(`Circle progress access check failed: ${JSON.stringify(result)}`);
  }
  console.log('Circle progress RLS, owner read policy, and RPC privileges verified.');
  await client.query('rollback');
}catch(error){await client.query('rollback').catch(()=>{});throw error}
finally{await client.end().catch(()=>{})}
