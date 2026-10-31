import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations,readMigrations} from '../scripts/database-migrations.mjs';

test('TAW-011: mentor approval, private booking, slot conflicts and lifecycle',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  const client={query:async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1)};
  const mentor='11111111-1111-4111-8111-111111111111';
  const requester='22222222-2222-4222-8222-222222222222';
  const outsider='33333333-3333-4333-8333-333333333333';
  const admin='44444444-4444-4444-8444-444444444444';
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
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now()),($5,$6,now()),($7,$8,now())',[mentor,'mentor@example.test',requester,'member@example.test',outsider,'outsider@example.test',admin,'admin@example.test']);
    await db.exec('begin');await applyMigrations(client,await readMigrations());await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)',[admin]);

    await asUser(mentor,async()=>{
      await db.query('select public.submit_tawasi_mentor_profile($1,$2,$3,$4,$5,$6,$7)',[
        'مرشد تجريبي','نبذة عامة','mentor','مؤهلات تمت مراجعتها', ['تزكية النفس'],['ar'],true
      ]);
      assert.equal((await db.query('select count(*)::int n from public.list_tawasi_mentors()')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int n from public.list_my_tawasi_mentor_slots()')).rows[0].n,0);
      await assert.rejects(db.query('select * from public.list_tawasi_mentor_applications()'),e=>e.code==='42501');
      await assert.rejects(db.query('select public.create_tawasi_mentor_slot(now()+interval \'1 day\',now()+interval \'1 day 1 hour\')'),e=>e.code==='42501');
      await assert.rejects(db.query("select * from public.tawasi_mentors"),e=>e.code==='42501');
    });
    await asUser(outsider,async()=>{
      await assert.rejects(db.query("select public.review_tawasi_mentor($1,'approved','اعتماد')",[mentor]),e=>e.code==='42501');
    });
    await asUser(admin,async()=>{
      assert.equal((await db.query('select count(*)::int n from public.list_tawasi_mentor_applications()')).rows[0].n,1);
      assert.equal((await db.query("select public.review_tawasi_mentor($1,'approved','تم التحقق من الملف') as result",[mentor])).rows[0].result,'approved');
    });

    let slot;
    await asUser(mentor,async()=>{
      const profile=(await db.query('select status,directory_visible from public.get_my_tawasi_mentor_profile()')).rows[0];
      assert.deepEqual(profile,{status:'approved',directory_visible:true});
      slot=(await db.query("select public.create_tawasi_mentor_slot(now()+interval '2 days',now()+interval '2 days 1 hour') id")).rows[0].id;
      assert.deepEqual((await db.query('select status from public.list_my_tawasi_mentor_slots()')).rows.map(row=>row.status),['available']);
      const removable=(await db.query("select public.create_tawasi_mentor_slot(now()+interval '4 days',now()+interval '4 days 1 hour') id")).rows[0].id;
      assert.equal((await db.query('select public.cancel_tawasi_mentor_slot($1) result',[removable])).rows[0].result,'cancelled');
      assert.equal((await db.query('select count(*)::int n from public.list_my_tawasi_mentor_slots()')).rows[0].n,1);
      await assert.rejects(db.query("select public.create_tawasi_mentor_slot(now()+interval '2 days 30 minutes',now()+interval '2 days 90 minutes')"),e=>e.code==='23P01');
      await assert.rejects(db.query("select public.create_tawasi_mentor_slot(now()-interval '1 hour',now()+interval '1 hour')"),e=>e.code==='22023');
      await assert.rejects(db.query('select public.request_tawasi_mentorship($1,$2,$3)',[slot,'طلب نفسي','لا يمكن حجز موعدي']),e=>e.code==='42501');
    });
    await asUser(requester,async()=>{
      assert.equal((await db.query('select count(*)::int n from public.list_tawasi_mentors()')).rows[0].n,1);
      assert.equal((await db.query("select count(*)::int n from public.list_tawasi_mentor_slots($1,now(),now()+interval '7 days')",[mentor])).rows[0].n,1);
    });

    let request;
    await asUser(requester,async()=>{
      request=(await db.query('select public.request_tawasi_mentorship($1,$2,$3) id',[slot,'المحافظة على الصلاة','تفاصيل خاصة لا تظهر للآخرين'])).rows[0].id;
      await assert.rejects(db.query('select public.request_tawasi_mentorship($1,$2,$3)',[slot,'طلب آخر','محاولة حجز مزدوج']),e=>e.code==='P0001');
      assert.equal((await db.query('select count(*)::int n from public.list_tawasi_mentor_slots($1,now(),now()+interval \'7 days\')',[mentor])).rows[0].n,0);
      const own=(await db.query('select private_details,status from public.list_my_tawasi_mentorship_requests()')).rows[0];
      assert.deepEqual(own,{private_details:'تفاصيل خاصة لا تظهر للآخرين',status:'pending'});
    });
    await asUser(outsider,async()=>{
      assert.equal((await db.query('select count(*)::int n from public.list_my_tawasi_mentorship_requests()')).rows[0].n,0);
      await assert.rejects(db.query('select public.cancel_tawasi_mentor_slot($1)',[slot]),e=>e.code==='42501');
      await assert.rejects(db.query("select public.review_tawasi_mentorship_request($1,'confirm','')",[request]),e=>e.code==='42501');
    });
    await asUser(mentor,async()=>{
      const own=(await db.query('select private_details,status from public.list_my_tawasi_mentorship_requests()')).rows[0];
      assert.deepEqual(own,{private_details:'تفاصيل خاصة لا تظهر للآخرين',status:'pending'});
      assert.equal((await db.query("select public.review_tawasi_mentorship_request($1,'confirm','تم تأكيد الجلسة') result",[request])).rows[0].result,'confirmed');
      await assert.rejects(db.query("select public.review_tawasi_mentorship_request($1,'reject','')",[request]),e=>e.code==='P0001');
    });
    await asUser(requester,async()=>{
      assert.equal((await db.query('select status from public.list_my_tawasi_mentorship_requests()')).rows[0].status,'confirmed');
      assert.equal((await db.query('select public.cancel_tawasi_mentorship_request($1) result',[request])).rows[0].result,'cancelled');
      assert.equal((await db.query('select status from public.list_my_tawasi_mentorship_requests()')).rows[0].status,'cancelled');
    });
    await asUser(requester,async()=>{
      const available=(await db.query("select slot_id from public.list_tawasi_mentor_slots($1,now(),now()+interval '7 days')",[mentor])).rows;
      assert.equal(available.length,1);
      await db.query('select public.request_tawasi_mentorship($1,$2,$3)',[available[0].slot_id,'فتور العبادة','تفاصيل قبل تعليق المرشد']);
    });
    await asUser(admin,async()=>{
      await db.query("select public.review_tawasi_mentor($1,'suspended','تعليق للمراجعة')",[mentor]);
    });
    await asUser(requester,async()=>{
      assert.equal((await db.query('select count(*)::int n from public.list_tawasi_mentors()')).rows[0].n,0);
      assert.equal((await db.query('select status from public.list_my_tawasi_mentorship_requests() order by created_at desc limit 1')).rows[0].status,'cancelled');
      assert.equal((await db.query("select count(*)::int n from public.list_tawasi_mentor_slots($1,now(),now()+interval '7 days')",[mentor])).rows[0].n,0);
    });
    await asUser(mentor,async()=>{
      await assert.rejects(db.query("select public.create_tawasi_mentor_slot(now()+interval '3 days',now()+interval '3 days 1 hour')"),e=>e.code==='42501');
    });
  }finally{await db.close()}
});
