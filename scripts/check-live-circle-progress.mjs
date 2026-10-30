import assert from 'node:assert/strict';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';

const {SUPABASE_PROJECT_REF:ref,SUPABASE_POOLER_HOST:host,SUPABASE_DB_PASSWORD:password}=process.env;
if(!ref||!host||!password)throw new Error('Missing database connection settings.');
const caPath=process.env.SUPABASE_DB_CA_FILE?.replace(/^\/mnt\/([a-z])\//,(_,drive)=>`${drive.toUpperCase()}:/`);
const ca=caPath?await readFile(caPath,'utf8'):undefined;
const client=new Client({host,port:5432,user:`postgres.${ref}`,database:'postgres',password,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},connectionTimeoutMillis:12000});
try{
  await client.connect();
  await client.query('begin');
  const account=await client.query('select id from auth.users where email_confirmed_at is not null order by created_at limit 1');
  assert.equal(account.rows.length,1,'Expected a confirmed test account');
  const userId=account.rows[0].id;
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
  const groupId=(await client.query("select public.create_group($1,$2) as id",['اختبار متابعة مؤقت','program'])).rows[0].id;
  await client.query('select public.save_group_program($1,$2,$3,$4)',[groupId,'prayer','برنامج اختبار',JSON.stringify([{category:'prayer',title:'مهمة اختبار',cadence:'daily'}])]);
  await client.query('select public.complete_group_task($1,$2)',[groupId,1]);
  assert.equal((await client.query('select count(*)::int as n from public.group_task_completions where group_id=$1',[groupId])).rows[0].n,1);
  assert.equal((await client.query('select visible from public.group_progress_summary($1)',[groupId])).rows[0].visible,false);
  await client.query('select public.set_group_progress_sharing($1,$2)',[groupId,true]);
  const summary=(await client.query('select * from public.group_progress_summary($1)',[groupId])).rows[0];
  assert.equal(Number(summary.sharing_members),1);
  assert.equal(summary.visible,false);
  await client.query('select public.uncomplete_group_task($1,$2)',[groupId,1]);
  assert.equal((await client.query('select count(*)::int as n from public.group_task_completions where group_id=$1',[groupId])).rows[0].n,0);
  await client.query('rollback');
  console.log('Live circle progress, opt-in threshold, and undo passed; transaction rolled back.');
}catch(error){await client.query('rollback').catch(()=>{});throw error}
finally{await client.end().catch(()=>{})}
