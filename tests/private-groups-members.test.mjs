import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('group roles, removal and founder transfer enforce server permissions',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const founder='11111111-1111-4111-8111-111111111111';
  const manager='22222222-2222-4222-8222-222222222222';
  const assistant='33333333-3333-4333-8333-333333333333';
  const member='44444444-4444-4444-8444-444444444444';
  const outsider='55555555-5555-4555-8555-555555555555';
  async function asUser(id,fn){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await db.exec('reset role')}}
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text);
      alter table storage.objects enable row level security;create extension if not exists pgcrypto;`);
    await db.exec(`insert into auth.users(id) values ('${founder}'),('${manager}'),('${assistant}'),('${member}'),('${outsider}')`);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    let group;
    await asUser(founder,async()=>{group=(await db.query('select public.create_group($1,$2) as id',['حلقة','friends'])).rows[0].id});
    await db.query(`insert into public.group_members(group_id,user_id,role) values
      ('${group}','${manager}','member'),('${group}','${assistant}','member'),('${group}','${member}','member')`);
    await asUser(member,async()=>{
      await assert.rejects(db.query('select public.set_group_member_role($1,$2,$3)',[group,member,'manager']),e=>e.code==='42501');
      await assert.rejects(db.query('select public.remove_group_member($1,$2)',[group,manager]),e=>e.code==='42501');
      await assert.rejects(db.query('select public.transfer_group_foundership($1,$2)',[group,member]),e=>e.code==='42501');
      await assert.rejects(db.query(`update public.group_members set role='founder' where group_id='${group}' and user_id='${member}'`),e=>e.code==='42501');
    });
    await asUser(founder,async()=>{
      await db.query('select public.set_group_member_role($1,$2,$3)',[group,manager,'manager']);
      await db.query('select public.set_group_member_role($1,$2,$3)',[group,assistant,'assistant']);
      await assert.rejects(db.query('select public.set_group_member_role($1,$2,$3)',[group,founder,'member']),e=>e.code==='P0001');
      await assert.rejects(db.query('select public.leave_group($1)',[group]),e=>e.code==='P0001');
    });
    await asUser(manager,async()=>{
      await assert.rejects(db.query('select public.set_group_member_role($1,$2,$3)',[group,member,'manager']),e=>e.code==='42501');
      await assert.rejects(db.query('select public.remove_group_member($1,$2)',[group,founder]),e=>e.code==='42501');
      await db.query('select public.remove_group_member($1,$2)',[group,assistant]);
    });
    await asUser(assistant,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int as n from public.group_members')).rows[0].n,0);
    });
    let code,request;
    await asUser(founder,async()=>{code=(await db.query('select public.create_group_invite($1) as code',[group])).rows[0].code});
    await asUser(outsider,async()=>{request=(await db.query('select public.request_group_join($1) as id',[code])).rows[0].id});
    await asUser(manager,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.group_join_requests where id=$1',[request])).rows[0].n,1);
      await db.query('select public.decide_group_join_request($1,true)',[request]);
    });
    await asUser(outsider,async()=>{assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n,1)});
    await asUser(founder,async()=>{
      await db.query('select public.transfer_group_foundership($1,$2)',[group,member]);
      assert.equal((await db.query('select role from public.group_members where user_id=$1',[founder])).rows[0].role,'manager');
    });
    await asUser(member,async()=>{
      assert.equal((await db.query('select role from public.group_members where user_id=$1',[member])).rows[0].role,'founder');
      await db.query('select public.remove_group_member($1,$2)',[group,manager]);
    });
    await asUser(manager,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n,0);
      await assert.rejects(db.query('select public.remove_group_member($1,$2)',[group,member]),e=>e.code==='42501');
    });
    await asUser(outsider,async()=>{
      await db.query('select public.leave_group($1)',[group]);
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n,0);
    });
  }finally{await db.close()}
});
