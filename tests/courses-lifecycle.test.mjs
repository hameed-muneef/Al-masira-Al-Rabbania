import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('only approved teachers create and publish free lessons or courses',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const teacher='11111111-1111-4111-8111-111111111111';
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
    await db.exec(`insert into auth.users(id) values ('${teacher}'),('${other}'),('${admin}')`);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)',[admin]);
    await asUser(teacher,async()=>{
      await assert.rejects(db.query('select public.create_course($1,$2)',['lesson','درس']),e=>e.code==='42501');
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)',['شيخ مختبر','نبذة','فقه','مؤهلات','تزكية']);
      await assert.rejects(db.query('select public.create_course($1,$2)',['lesson','درس']),e=>e.code==='42501');
    });
    await asUser(admin,async()=>{await db.query('select public.review_teacher_application($1,$2,$3,$4,$5)',[teacher,'approved','approved','approved','تم التحقق'])});
    let id,seriesId;
    await asUser(teacher,async()=>{
      await assert.rejects(db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        ['lesson','درس عام','وصف','هدف','','all','فقه','موعد','2026-12-01T10:00:00Z','Africa/Cairo',30,'private','open','']),e=>e.code==='22023');
      id=(await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson','درس عام','وصف','هدف','','all','فقه','موعد','2026-12-01T10:00:00Z','Africa/Cairo',30,'public','open','https://www.youtube.com/watch?v=test'])).rows[0].id;
      seriesId=(await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['series','سلسلة دروس','وصف','هدف','','all','فقه','موعد','2026-12-01T10:00:00Z','Africa/Cairo',30,'public','open',''])).rows[0].id;
      assert.equal((await db.query('select status from public.courses where id=$1',[id])).rows[0].status,'draft');
      await assert.rejects(db.query("insert into public.courses(teacher_id,kind,title) values($1,'lesson','محاولة')",[teacher]),e=>e.code==='42501');
    });
    await asUser(other,async()=>{
      assert.equal((await db.query('select count(*)::int as n from public.courses')).rows[0].n,0);
      await assert.rejects(db.query('select public.set_course_status($1,$2)',[id,'published']),e=>e.code==='42501');
      await assert.rejects(db.query('select public.save_course_lesson($1,$2,$3,$4)',[seriesId,null,1,'درس أول']),e=>e.code==='42501');
    });
    await asUser(teacher,async()=>{
      await db.query('select public.set_course_status($1,$2)',[id,'published']);
      await assert.rejects(db.query('select public.set_course_status($1,$2)',[seriesId,'published']),e=>e.code==='P0001');
      await db.query('select public.save_course_lesson($1,$2,$3,$4)',[seriesId,null,1,'درس أول']);
      await assert.rejects(db.query('select public.set_course_status($1,$2)',[seriesId,'published']),e=>e.code==='P0001');
      await db.query('select public.save_course_lesson($1,$2,$3,$4)',[seriesId,null,2,'درس ثان']);
      await assert.rejects(db.query("insert into public.course_lessons(course_id,position,title) values($1,3,'درس ثالث')",[seriesId]),e=>e.code==='42501');
      await db.query('select public.set_course_status($1,$2)',[seriesId,'published']);
      await assert.rejects(db.query('select public.save_course_lesson($1,$2,$3,$4)',[seriesId,null,3,'درس ثالث']),e=>e.code==='P0001');
    });
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*)::int as n from public.courses where id=$1',[id])).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int as n from public.course_lessons where course_id=$1',[seriesId])).rows[0].n,2);
    const publicTeacher=(await db.query('select * from public.list_public_course_teachers($1)',[[id,seriesId]])).rows;
    assert.equal(publicTeacher.length,2);
    assert.deepEqual(Object.keys(publicTeacher[0]),['course_id','display_name','biography','specialties']);
    assert.equal(publicTeacher[0].display_name,'شيخ مختبر');
    assert.equal((await db.query('select * from public.list_public_course_teachers($1)',[[id,'99999999-9999-4999-8999-999999999999']])).rows.length,1);
    await assert.rejects(db.query('select qualifications from public.teacher_applications'),e=>e.code==='42501');
    await db.exec('reset role');
    await asUser(teacher,async()=>{
      await assert.rejects(db.query('select public.update_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [id,'lesson','عنوان جديد','وصف','هدف','','all','فقه','موعد','2026-12-01T10:00:00Z','Africa/Cairo',30,'public','open','']),e=>e.code==='P0001');
    });
    await asUser(admin,async()=>{await db.query('select public.review_teacher_application($1,$2,$3,$4,$5,true)',[teacher,'approved','approved','approved','تعليق'])});
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*)::int as n from public.courses where id=$1',[id])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int as n from public.course_lessons where course_id=$1',[seriesId])).rows[0].n,0);
    assert.equal((await db.query('select * from public.list_public_course_teachers($1)',[[id,seriesId]])).rows.length,0);
    await db.exec('reset role');
    await asUser(teacher,async()=>{await db.query('select public.set_course_status($1,$2)',[id,'cancelled'])});
  }finally{await db.close()}
});
