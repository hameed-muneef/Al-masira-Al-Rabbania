import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('invite requests require founder decision and respect membership limits', async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const founder='11111111-1111-4111-8111-111111111111';
  const alice='22222222-2222-4222-8222-222222222222';
  const bob='33333333-3333-4333-8333-333333333333';
  const outsider='44444444-4444-4444-8444-444444444444';
  async function asUser(id,fn){
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    try{return await fn()}finally{await db.exec('reset role')}
  }
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth, public to anon, authenticated;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key, bucket_id text, name text);
      alter table storage.objects enable row level security;
      create extension if not exists pgcrypto;`);
    await db.exec(`insert into auth.users(id) values ('${founder}'),('${alice}'),('${bob}'),('${outsider}')`);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    let group,code,request;
    await asUser(founder,async()=>{
      group=(await db.query('select public.create_group($1,$2,$3,$4,$5,$6) as id',['حلقة','book','','','',2])).rows[0].id;
      code=(await db.query('select public.create_group_invite($1,$2,$3) as code',[group,24,2])).rows[0].code;
    });
    await asUser(alice,async()=>{
      request=(await db.query('select public.request_group_join($1) as id',[code])).rows[0].id;
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n,0);
      assert.equal((await db.query('select status from public.group_join_requests where id=$1',[request])).rows[0].status,'pending');
      await assert.rejects(db.query('select public.request_group_join($1)',[code]),e=>e.code==='23505');
      await assert.rejects(db.query('select public.decide_group_join_request($1,true)',[request]),e=>e.code==='42501');
      await assert.rejects(db.query(`update public.group_join_requests set status='accepted' where id='${request}'`),e=>e.code==='42501');
    });
    assert.equal((await db.query('select uses_count from public.group_invites')).rows[0].uses_count,1);
    await asUser(outsider,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.group_join_requests')).rows[0].n,0);
      await assert.rejects(db.query('select public.decide_group_join_request($1,true)',[request]),e=>e.code==='42501');
    });
    await asUser(founder,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.group_join_requests')).rows[0].n,1);
      await db.query('select public.decide_group_join_request($1,true)',[request]);
      await assert.rejects(db.query('select public.decide_group_join_request($1,true)',[request]),e=>e.code==='P0001');
    });
    await asUser(alice,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n,1);
      assert.equal((await db.query('select role from public.group_members where user_id=$1',[alice])).rows[0].role,'member');
    });
    await asUser(bob,async()=>{
      await assert.rejects(db.query('select public.request_group_join($1)',[code]),e=>e.code==='P0001');
    });
    assert.equal((await db.query('select uses_count from public.group_invites')).rows[0].uses_count,1);
    // Rejection leaves the applicant outside and cannot be retried through an old request.
    let otherGroup,otherCode,otherRequest;
    await asUser(founder,async()=>{
      otherGroup=(await db.query('select public.create_group($1,$2) as id',['أخرى','friends'])).rows[0].id;
      otherCode=(await db.query('select public.create_group_invite($1) as code',[otherGroup])).rows[0].code;
    });
    await asUser(bob,async()=>{otherRequest=(await db.query('select public.request_group_join($1) as id',[otherCode])).rows[0].id});
    await asUser(founder,async()=>{await db.query('select public.decide_group_join_request($1,false)',[otherRequest])});
    await asUser(bob,async()=>{
      assert.equal((await db.query('select status from public.group_join_requests where id=$1',[otherRequest])).rows[0].status,'rejected');
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n,0);
    });
  }finally{await db.close()}
});
