import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';
import ts from 'typescript';

const cloudStateSource=readFileSync(new URL('../src/cloud-state.ts',import.meta.url),'utf8')
  .replace("import {loadFromRaw} from './app-state';","const loadFromRaw=(raw)=>JSON.parse(raw);")
  .replace("import {authClient} from './auth';",'const authClient=null;');
const cloudStateCompiled=ts.transpileModule(cloudStateSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {toCloudPayload}=await import(`data:text/javascript;base64,${Buffer.from(cloudStateCompiled).toString('base64')}`);

test('cloud user payload stores personal curriculum progress, not the shared catalog',()=>{
  const legacy={tasks:[],curriculum:{units:[{id:'large-shared-catalog'}],progress:{beginning:4}}};
  const payload=toCloudPayload(legacy);
  assert.equal('curriculum' in payload,false);
  assert.deepEqual(payload.curriculumProgress,{beginning:4});
  const current={...legacy,curriculumProgress:{beginning:6}};
  assert.deepEqual(toCloudPayload(current).curriculumProgress,{beginning:6});
});

test('compact user-state RPC strips shared curriculum while preserving legacy progress and owner isolation',async()=>{
  const db=new PGlite();
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const owner='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  async function asUser(id,fn){
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    try{return await fn()}finally{await db.exec('reset role')}
  }
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth,public to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text);
      alter table storage.objects enable row level security;`);
    await db.exec(`insert into auth.users(id) values ('${owner}'),('${other}')`);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    await db.query('insert into public.user_data(user_id,payload) values($1,$2)',[owner,JSON.stringify({tasks:[],curriculum:{units:[{id:'shared'}],progress:{beginning:5}}})]);
    await asUser(owner,async()=>{
      const {load_my_user_state:payload}= (await db.query('select public.load_my_user_state() as load_my_user_state')).rows[0];
      assert.deepEqual(payload.curriculumProgress,{beginning:5});
      assert.equal('curriculum' in payload,false);
      assert.equal((await db.query('select payload from public.user_data')).rows[0].payload.curriculum.units[0].id,'shared');
    });
    await asUser(other,async()=>{
      assert.equal((await db.query('select public.load_my_user_state() as value')).rows[0].value,null);
    });
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.load_my_user_state()'),error=>error.code==='42501');
  }finally{await db.close()}
});