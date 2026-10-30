import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('circle programs keep immutable revisions and respect membership roles',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const founder='11111111-1111-4111-8111-111111111111';
  const member='22222222-2222-4222-8222-222222222222';
  const outsider='33333333-3333-4333-8333-333333333333';
  async function asUser(id,fn){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await db.exec('reset role')}}
  const task=(title)=>JSON.stringify([{category:'prayer',title,cadence:'daily'}]);
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text);
      alter table storage.objects enable row level security;create extension if not exists pgcrypto;`);
    await db.exec(`insert into auth.users(id) values ('${founder}'),('${member}'),('${outsider}')`);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    let group;
    await asUser(founder,async()=>{group=(await db.query('select public.create_group($1,$2) as id',['حلقة برنامج','program'])).rows[0].id});
    await db.query('insert into public.group_members(group_id,user_id,role) values($1,$2,$3)',[group,member,'member']);
    await asUser(outsider,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.group_programs')).rows[0].n,0);
      await assert.rejects(db.query('select public.save_group_program($1,$2,$3,$4)',[group,'prayer','برنامج',task('صلاة')]),e=>e.code==='42501');
    });
    await asUser(member,async()=>{
      await assert.rejects(db.query('select public.save_group_program($1,$2,$3,$4)',[group,'prayer','برنامج',task('صلاة')]),e=>e.code==='42501');
    });
    await asUser(founder,async()=>{
      assert.equal((await db.query('select public.save_group_program($1,$2,$3,$4) as revision',[group,'prayer','الصلاة',task('المحافظة على الصلاة')])).rows[0].revision,1);
    });
    await asUser(member,async()=>{
      await db.query('select public.complete_group_task($1,$2)',[group,1]);
      await db.query('select public.complete_group_task($1,$2)',[group,1]);
      assert.equal((await db.query('select count(*)::int as n from public.group_task_completions')).rows[0].n,1);
      await assert.rejects(db.query('insert into public.group_task_completions(group_id,revision,position,user_id,completed_on) values($1,1,1,$2,current_date)',[group,outsider]),e=>e.code==='42501');
    });
    await asUser(founder,async()=>{
      assert.equal((await db.query('select public.save_group_program($1,$2,$3,$4) as revision',[group,'prayer','الصلاة',task('الصلاة في وقتها')])).rows[0].revision,2);
      await assert.rejects(db.query('select public.save_group_program($1,$2,$3,$4)',[group,'prayer','',task('صلاة')]),e=>e.code==='22023');
      await assert.rejects(db.query('select public.save_group_program($1,$2,$3,$4)',[group,'custom','برنامج',JSON.stringify([{category:'invalid',title:'x',cadence:'daily'}])]),e=>e.code==='22023');
      await assert.rejects(db.query("update public.group_program_tasks set title='تغيير' where group_id=$1",[group]),e=>e.code==='42501');
    });
    await asUser(member,async()=>{
      const revisions=(await db.query('select revision,title from public.group_program_tasks where group_id=$1 order by revision',[group])).rows;
      assert.deepEqual(revisions.map(row=>row.title),['المحافظة على الصلاة','الصلاة في وقتها']);
      assert.equal((await db.query('select current_revision from public.group_programs where group_id=$1',[group])).rows[0].current_revision,2);
      const completed=(await db.query('select revision,position from public.group_task_completions where group_id=$1',[group])).rows;
      assert.deepEqual(completed.map(row=>[row.revision,row.position]),[[1,1]]);
    });
    await asUser(outsider,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.group_program_tasks')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int as n from public.group_task_completions')).rows[0].n,0);
      await assert.rejects(db.query('select public.complete_group_task($1,$2)',[group,1]),e=>e.code==='42501');
    });
    await asUser(founder,async()=>{await db.query('select public.close_group($1)',[group]);await assert.rejects(db.query('select public.save_group_program($1,$2,$3,$4)',[group,'prayer','الصلاة',task('صلاة')]),e=>e.code==='P0001')});
  }finally{await db.close()}
});
