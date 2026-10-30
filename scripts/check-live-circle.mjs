import assert from 'node:assert/strict';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const {SUPABASE_PROJECT_REF:ref,SUPABASE_POOLER_HOST:host,SUPABASE_DB_PASSWORD:password,TEST_ACCOUNT_EMAIL:email}=process.env;
if(!ref||!host||!password||!email)throw new Error('Missing connection or test account settings.');
const caPath=process.env.SUPABASE_DB_CA_FILE?.replace(/^\/mnt\/([a-z])\//,(_,drive)=>`${drive.toUpperCase()}:/`);
const ca=caPath?await readFile(caPath,'utf8'):undefined;
const client=new Client({host,port:5432,user:`postgres.${ref}`,database:'postgres',password,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},connectionTimeoutMillis:12000});
try{
  await client.connect();
  await client.query('begin');
  const account=await client.query('select id from auth.users where lower(email)=lower($1) and email_confirmed_at is not null',[email]);
  assert.equal(account.rows.length,1,'Expected one confirmed test account');
  const userId=account.rows[0].id;
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
  const groupId=(await client.query("select public.create_group($1,$2) as id",['اختبار مؤقت يُلغى بالمعاملة','friends'])).rows[0].id;
  const sessionId=(await client.query('select public.create_circle_session($1,$2,$3,$4,$5,$6) as id',
    [groupId,'لقاء اختباري','2026-12-02T10:00:00Z','2026-12-02T11:00:00Z','https://meet.google.com/abc-defg-hij',''])).rows[0].id;
  const rows=(await client.query('select * from public.list_circle_sessions($1)',[groupId])).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].has_meeting_link,true);
  assert.equal('meeting_url' in rows[0],false);
  await client.query('reset role');
  const premiumSchema=(await client.query("select to_regclass('public.paid_subscriptions') is not null as present")).rows[0].present;
  if(premiumSchema){
    await client.query('set local role authenticated');
    await client.query('savepoint no_access');
    await assert.rejects(client.query('select public.reveal_circle_meeting_url($1)',[sessionId]),error=>error.code==='42501');
    await client.query('rollback to savepoint no_access');
    await client.query('reset role');
    await client.query('set local role service_role');
    await client.query('select public.record_verified_subscription_event($1,$2,$3,$4,$5,$6,$7)',
      ['integration-test',randomUUID(),randomUUID(),userId,'active',new Date(Date.now()+3600000),new Date()]);
    await client.query('reset role');
  }
  await client.query('set local role authenticated');
  assert.equal((await client.query('select public.reveal_circle_meeting_url($1) as url',[sessionId])).rows[0].url,'https://meet.google.com/abc-defg-hij');
  if(premiumSchema){
    await client.query('reset role');
    const admin=(await client.query('select user_id from public.admin_accounts where user_id<>$1 limit 1',[userId])).rows[0];
    assert.ok(admin,'Expected a separate platform admin for access checks');
    const asAdmin=async(allowed)=>{
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.user_id]);
      await client.query('select public.set_member_feature($1,$2,$3)',[email,'circle_live',allowed]);
      await client.query('reset role');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
    };
    await asAdmin(false);
    await client.query('savepoint admin_denied');
    await assert.rejects(client.query('select public.reveal_circle_meeting_url($1)',[sessionId]),error=>error.code==='42501');
    await client.query('rollback to savepoint admin_denied');
    await asAdmin(true);
    assert.equal((await client.query('select public.reveal_circle_meeting_url($1) as url',[sessionId])).rows[0].url,'https://meet.google.com/abc-defg-hij');
    await asAdmin(null);
    assert.equal((await client.query('select public.reveal_circle_meeting_url($1) as url',[sessionId])).rows[0].url,'https://meet.google.com/abc-defg-hij');
    await client.query('reset role');
    assert.equal((await client.query('select count(*)::int as n from public.member_feature_events where user_id=$1',[userId])).rows[0].n,3);
    await client.query('set local role authenticated');
  }
  await client.query('savepoint membership_check');
  await client.query('reset role');
  await client.query('delete from public.group_members where group_id=$1 and user_id=$2',[groupId,userId]);
  await client.query('set local role authenticated');
  await client.query('savepoint denied_member');
  await assert.rejects(client.query('select public.reveal_circle_meeting_url($1)',[sessionId]),error=>error.code==='42501');
  await client.query('rollback to savepoint denied_member');
  await client.query('rollback to savepoint membership_check');
  await client.query('select public.cancel_circle_session($1)',[sessionId]);
  await client.query('savepoint denied_reveal');
  await assert.rejects(client.query('select public.reveal_circle_meeting_url($1)',[sessionId]),error=>error.code==='42501');
  await client.query('rollback to savepoint denied_reveal');
  await client.query('rollback');
  console.log('Live account circle/session/premium/admin/removal/cancel checks passed; transaction rolled back.');
}catch(error){await client.query('rollback').catch(()=>{});throw error}
finally{await client.end().catch(()=>{})}
