import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('teacher application remains private and does not self-approve',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const applicant='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  const admin='33333333-3333-4333-8333-333333333333';
  async function asUser(id,fn){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await db.exec('reset role')}}
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text);
      alter table storage.objects enable row level security;create extension if not exists pgcrypto;`);
    await db.exec(`insert into auth.users(id) values ('${applicant}'),('${other}'),('${admin}')`);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)',[admin]);
    await asUser(applicant,async()=>{
      await assert.rejects(db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)',['أ','', '', '', '']),error=>error.code==='22023');
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)',['شيخ متقدم','نبذة','تفسير','شهادات وخبرة','تزكية موثقة']);
      const row=(await db.query('select status,identity_status,qualification_status,endorsement_status from public.teacher_applications')).rows[0];
      assert.deepEqual(Object.values(row),['submitted','pending','pending','pending']);
      assert.equal((await db.query('select public.is_approved_teacher() as approved')).rows[0].approved,false);
      await assert.rejects(db.query("update public.teacher_applications set status='approved' where user_id=$1",[applicant]),error=>error.code==='42501');
      await assert.rejects(db.query('select public.review_teacher_application($1,$2,$3,$4,$5)',[applicant,'approved','approved','approved','مراجعة']),error=>error.code==='42501');
    });
    await asUser(other,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.teacher_applications')).rows[0].n,0);
      assert.equal((await db.query('select public.is_approved_teacher() as approved')).rows[0].approved,false);
    });
    await asUser(admin,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.teacher_applications')).rows[0].n,1);
      await assert.rejects(db.query("update public.teacher_applications set status='approved' where user_id=$1",[applicant]),error=>error.code==='42501');
      await assert.rejects(db.query('select public.review_teacher_application($1,$2,$3,$4,$5)',[applicant,'approved','approved','approved','']),error=>error.code==='22023');
      assert.equal((await db.query('select public.review_teacher_application($1,$2,$3,$4,$5) as status',[applicant,'approved','approved','pending','بانتظار التزكية'])).rows[0].status,'submitted');
      assert.equal((await db.query('select public.review_teacher_application($1,$2,$3,$4,$5) as status',[applicant,'approved','approved','approved','اعتماد الجوانب الثلاثة'])).rows[0].status,'approved');
      assert.equal((await db.query('select count(*)::int as n from public.teacher_review_events')).rows[0].n,2);
    });
    await asUser(applicant,async()=>{
      assert.equal((await db.query('select public.is_approved_teacher() as approved')).rows[0].approved,true);
      assert.equal((await db.query('select count(*)::int as n from public.teacher_review_events')).rows[0].n,0);
      await assert.rejects(db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)',['شيخ متقدم','نبذة','تفسير','شهادات','تزكية']),error=>error.code==='P0001');
    });
    await asUser(admin,async()=>{
      assert.equal((await db.query('select public.review_teacher_application($1,$2,$3,$4,$5,true) as status',[applicant,'approved','approved','approved','تعليق مؤقت'])).rows[0].status,'suspended');
    });
    await asUser(applicant,async()=>{assert.equal((await db.query('select public.is_approved_teacher() as approved')).rows[0].approved,false)});
  }finally{await db.close()}
});
