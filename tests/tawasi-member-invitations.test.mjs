import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('direct Tawasi circle invitations enforce privacy, roles, expiry and acceptance', async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const users={
    founder:'11111111-1111-4111-8111-111111111111',
    manager:'22222222-2222-4222-8222-222222222222',
    recipient:'33333333-3333-4333-8333-333333333333',
    second:'44444444-4444-4444-8444-444444444444',
    hidden:'55555555-5555-4555-8555-555555555555',
    blocked:'66666666-6666-4666-8666-666666666666',
    outsider:'77777777-7777-4777-8777-777777777777',
    expiry:'88888888-8888-4888-8888-888888888888'
  };
  const asUser=async(id,fn)=>{
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    try{return await fn()}finally{await db.exec('reset role')}
  };
  const query=(sql,params)=>db.query(sql,params);
  const fails=async(promise,code)=>assert.rejects(promise,error=>error.code===code);
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth,public to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text);
      alter table storage.objects enable row level security;
      create extension if not exists pgcrypto;`);
    for(const id of Object.values(users))await query('insert into auth.users(id) values($1)',[id]);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    for(const [key,username,discoverable] of [
      ['founder','owner_one',true],['manager','manager_one',true],['recipient','member_one',true],
      ['second','member_two',true],['hidden','hidden_one',false],['blocked','blocked_one',true],
      ['expiry','expiry_one',true]
    ]){
      await asUser(users[key],()=>query('select public.save_my_share_profile($1,$2,$3)',[username,username,discoverable]));
    }
    await query('insert into public.member_blocks(blocker_id,blocked_id) values($1,$2),($1,$3)',[users.blocked,users.founder,users.manager]);

    const group=await asUser(users.founder,async()=>
      (await query('select public.create_group($1,$2,$3,$4,$5,$6) as id',['حلقة التواصي','friends','','','',8])).rows[0].id);
    const managerCode=await asUser(users.founder,async()=>
      (await query('select public.create_group_invite($1) as code',[group])).rows[0].code);
    const managerRequest=await asUser(users.manager,async()=>
      (await query('select public.request_group_join($1) as id',[managerCode])).rows[0].id);
    await asUser(users.founder,async()=>{
      await query('select public.decide_group_join_request($1,true)',[managerRequest]);
      await query('select public.set_group_member_role($1,$2,$3)',[group,users.manager,'manager']);
    });
    await asUser(users.outsider,async()=>{
      await fails(query('select public.invite_group_member($1,$2)',[group,'member_one']),'42501');
      await fails(query('select * from public.list_group_member_invites($1)',[group]),'42501');
    });
    await asUser(users.manager,async()=>{
      await fails(query('select public.invite_group_member($1,$2)',[group,'hidden_one']),'P0001');
      await fails(query('select public.invite_group_member($1,$2)',[group,'blocked_one']),'P0001');
      await fails(query('select public.invite_group_member($1,$2)',[group,'unknown_one']),'P0001');
    });
    const invitation=await asUser(users.manager,async()=>
      (await query('select public.invite_group_member($1,$2) as id',[group,'member_one'])).rows[0].id);
    await asUser(users.manager,async()=>{
      await fails(query('select public.invite_group_member($1,$2)',[group,'member_one']),'P0001');
      const rows=(await query('select * from public.list_group_member_invites($1)',[group])).rows;
      assert.equal(rows.length,1);
      assert.equal(rows[0].invitee_username,'member_one');
      assert.equal(rows[0].status,'pending');
    });
    await asUser(users.recipient,async()=>{
      const rows=(await query('select * from public.list_my_group_member_invites()')).rows;
      assert.equal(rows.length,1);
      assert.equal(rows[0].group_name,'حلقة التواصي');
    });
    await asUser(users.manager,async()=>{
      await fails(query('select public.respond_group_member_invite($1,true)',[invitation]),'42501');
    });
    await asUser(users.outsider,async()=>{
      await fails(query('select public.respond_group_member_invite($1,true)',[invitation]),'42501');
    });
    assert.equal((await query('select count(*)::int as n from public.group_members where group_id=$1 and user_id=$2',[group,users.recipient])).rows[0].n,0);
    await asUser(users.recipient,async()=>{
      assert.equal((await query('select public.respond_group_member_invite($1,true) as status',[invitation])).rows[0].status,'accepted');
    });
    assert.equal((await query('select role from public.group_members where group_id=$1 and user_id=$2',[group,users.recipient])).rows[0].role,'member');
    assert.equal((await query('select status from public.group_member_invitations where id=$1',[invitation])).rows[0].status,'accepted');

    const decline=await asUser(users.founder,async()=>
      (await query('select public.invite_group_member($1,$2) as id',[group,'member_two'])).rows[0].id);
    await asUser(users.second,async()=>{
      assert.equal((await query('select public.respond_group_member_invite($1,false) as status',[decline])).rows[0].status,'declined');
    });
    const expired=await asUser(users.founder,async()=>
      (await query('select public.invite_group_member($1,$2) as id',[group,'expiry_one'])).rows[0].id);
    await query("update public.group_member_invitations set expires_at=now()-interval '1 minute' where id=$1",[expired]);
    await asUser(users.expiry,async()=>{
      assert.equal((await query('select public.respond_group_member_invite($1,true) as status',[expired])).rows[0].status,'expired');
    });
    const cancelled=await asUser(users.founder,async()=>
      (await query('select public.invite_group_member($1,$2) as id',[group,'member_two'])).rows[0].id);
    await asUser(users.manager,async()=>query('select public.cancel_group_member_invite($1)',[cancelled]));
    await asUser(users.second,async()=>{
      await fails(query('select public.respond_group_member_invite($1,true)',[cancelled]),'P0001');
    });
    const full=await asUser(users.founder,async()=>
      (await query('select public.invite_group_member($1,$2) as id',[group,'member_two'])).rows[0].id);
    await query('update public.study_groups set member_limit=3 where id=$1',[group]);
    await asUser(users.second,async()=>{
      assert.equal((await query('select public.respond_group_member_invite($1,true) as status',[full])).rows[0].status,'full');
    });
    assert.equal((await query('select status from public.group_member_invitations where id=$1',[full])).rows[0].status,'expired');
    assert.equal((await query('select count(*)::int as n from public.group_members where group_id=$1 and user_id=$2',[group,users.second])).rows[0].n,0);
    assert.equal((await query("select count(*)::int as n from public.notifications where kind='invitation' and recipient_id=$1",[users.recipient])).rows[0].n,1);
    assert.equal((await query("select count(*)::int as n from public.notifications where kind='invitation' and recipient_id=$1 and title like 'قبل دعوتك%' ",[users.manager])).rows[0].n,1);
  }finally{await db.close()}
});
