import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('circle progress is private and aggregate sharing is opt-in with a minimum group size',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const users=[1,2,3,4].map(n=>`${n}`.repeat(8)+'-1111-4111-8111-111111111111');
  async function asUser(id,fn){
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    try{return await fn()}finally{await db.exec('reset role')}
  }
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text);
      alter table storage.objects enable row level security;create extension if not exists pgcrypto;`);
    for(const id of users)await db.query('insert into auth.users(id) values($1)',[id]);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    let group;
    await asUser(users[0],async()=>{group=(await db.query('select public.create_group($1,$2) as id',['متابعة خاصة','program'])).rows[0].id});
    for(const id of users.slice(1,3))await db.query("insert into public.group_members(group_id,user_id,role) values($1,$2,'member')",[group,id]);
    await asUser(users[0],async()=>await db.query('select public.save_group_program($1,$2,$3,$4)',[group,'prayer','الصلاة',JSON.stringify([{category:'prayer',title:'مهمة',cadence:'daily'}])]));
    await asUser(users[0],async()=>{
      await db.query('select public.complete_group_task($1,$2)',[group,1]);
      assert.equal(Number((await db.query('select completion_count from public.group_progress_summary($1)',[group])).rows[0].completion_count),0);
      await db.query('select public.set_group_progress_sharing($1,$2)',[group,true]);
      await assert.rejects(db.query('update public.group_progress_sharing set share_aggregate=true where group_id=$1',[group]),e=>e.code==='42501');
    });
    await asUser(users[1],async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.group_task_completions where group_id=$1',[group])).rows[0].n,0);
      await db.query('select public.complete_group_task($1,$2)',[group,1]);
      await db.query('select public.set_group_progress_sharing($1,$2)',[group,true]);
      assert.equal((await db.query('select visible from public.group_progress_summary($1)',[group])).rows[0].visible,false);
    });
    await asUser(users[2],async()=>{
      await db.query('select public.set_group_progress_sharing($1,$2)',[group,true]);
      const summary=(await db.query('select * from public.group_progress_summary($1)',[group])).rows[0];
      assert.equal(summary.visible,true);
      assert.equal(Number(summary.sharing_members),3);
      assert.equal(Number(summary.completion_count),2);
      assert.equal((await db.query('select count(*)::int as n from public.group_task_completions where group_id=$1',[group])).rows[0].n,0);
    });
    await asUser(users[1],async()=>{
      await db.query('select public.uncomplete_group_task($1,$2)',[group,1]);
      assert.equal(Number((await db.query('select completion_count from public.group_progress_summary($1)',[group])).rows[0].completion_count),1);
      await db.query('select public.set_group_progress_sharing($1,$2)',[group,false]);
      assert.equal((await db.query('select visible from public.group_progress_summary($1)',[group])).rows[0].visible,false);
    });
    await asUser(users[0],async()=>await db.query('select public.remove_group_member($1,$2)',[group,users[2]]));
    await asUser(users[2],async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.group_task_completions where group_id=$1',[group])).rows[0].n,0);
      await assert.rejects(db.query('select * from public.group_progress_summary($1)',[group]),e=>e.code==='42501');
    });
    await asUser(users[0],async()=>{
      assert.equal(Number((await db.query('select sharing_members from public.group_progress_summary($1)',[group])).rows[0].sharing_members),1);
    });
    await asUser(users[3],async()=>{
      await assert.rejects(db.query('select * from public.group_progress_summary($1)',[group]),e=>e.code==='42501');
      await assert.rejects(db.query('select public.set_group_progress_sharing($1,$2)',[group,true]),e=>e.code==='42501');
      assert.equal((await db.query('select count(*)::int as n from public.group_task_completions')).rows[0].n,0);
    });
  }finally{await db.close()}
});
