import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// ILM-005: التسجيل المجاني وسعة المقاعد (ذري، بدون تجاوز).
test('course registration: capacity, duplicates, cancellation and privacy', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const teacher = '11111111-1111-4111-8111-111111111111';
  const admin = '33333333-3333-4333-8333-333333333333';
  const studentA = '44444444-4444-4444-8444-444444444444';
  const studentB = '55555555-5555-4555-8555-555555555555';
  const studentC = '66666666-6666-4666-8666-666666666666';
  async function asUser(id, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { await fn(); } finally { await db.exec('reset role'); }
  }
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth, public to anon, authenticated;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key, bucket_id text, name text);
      alter table storage.objects enable row level security; create extension if not exists pgcrypto;`);
    await db.exec(`insert into auth.users(id) values ('${teacher}'),('${admin}'),('${studentA}'),('${studentB}'),('${studentC}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)', [admin]);
    await asUser(teacher, async () => {
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)', ['شيخ مختبر', 'نبذة', 'فقه', 'مؤهلات', 'تزكية']);
    });
    await asUser(admin, async () => {
      await db.query('select public.review_teacher_application($1,$2,$3,$4,$5)', [teacher, 'approved', 'approved', 'approved', 'تم التحقق']);
    });

    // 1) إعداد مجلس منشور سعته 2 (علني، تسجيل مفتوح).
    let courseId = '';
    await asUser(teacher, async () => {
      courseId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'درس سعة 2', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 2, 'public', 'open', 'https://www.youtube.com/watch?v=test'])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
    });
    await db.exec('set role anon');
    assert.equal((await db.query('select remaining_count from public.list_public_course_seats($1)',[[courseId]])).rows[0].remaining_count,2);
    await assert.rejects(db.query('select user_id from public.course_registrations'), e => e.code === '42501');
    await db.exec('reset role');

    // 2) طالبان يسجلان؛ ثالث يُرفض لبلوغ السعة.
    await asUser(studentA, async () => {
      assert.equal((await db.query('select public.register_for_course($1)', [courseId])).rows[0].register_for_course, 'registered');
      assert.equal((await db.query('select public.register_for_course($1)', [courseId])).rows[0].register_for_course, 'already_registered');
    });
    await asUser(studentB, async () => {
      assert.equal((await db.query('select public.register_for_course($1)', [courseId])).rows[0].register_for_course, 'registered');
    });
    await db.exec('set role anon');
    const fullSeats=(await db.query('select * from public.list_public_course_seats($1)',[[courseId]])).rows[0];
    assert.equal(fullSeats.registered_count,2);
    assert.equal(fullSeats.remaining_count,0);
    await db.exec('reset role');
    await asUser(studentC, async () => {
      await assert.rejects(db.query('select public.register_for_course($1)', [courseId]), e => e.code === 'P0001');
    });
    // 3) إلغاء studentA (أو studentB) يحرر مقعدًا، فيسجل studentC.
    await asUser(studentA, async () => {
      await db.query('select public.cancel_course_registration($1)', [courseId]);
    });
    await db.exec('set role anon');
    assert.equal((await db.query('select remaining_count from public.list_public_course_seats($1)',[[courseId]])).rows[0].remaining_count,1);
    await db.exec('reset role');
    await asUser(studentC, async () => {
      assert.equal((await db.query('select public.register_for_course($1)', [courseId])).rows[0].register_for_course, 'registered');
    });
    // 4) إلغاء بلا تسجيل → P0001.
    await asUser(studentA, async () => {
      await assert.rejects(db.query('select public.cancel_course_registration($1)', [courseId]), e => e.code === 'P0001');
    });
    // 5) الخصوصية: studentA لا يرى تسجيل studentB.
    await asUser(studentA, async () => {
      const own = (await db.query('select count(*)::int as n from public.course_registrations where course_id=$1', [courseId])).rows[0].n;
      assert.equal(own, 1); // only own row (studentA's cancelled? actually after cancel status cancelled, still visible to self)
    });
    // 6) المعلم يرى القائمة (2 registered: B,C).
    await asUser(teacher, async () => {
      const list = (await db.query('select * from public.list_course_registrations($1)', [courseId])).rows;
      assert.equal(list.length, 2);
    });
    // 7) غير المعلم/غير المشرف لا يرى قائمة.
    await asUser(studentB, async () => {
      const list = (await db.query('select * from public.list_course_registrations($1)', [courseId])).rows;
      assert.equal(list.length, 0);
    });
    // 8) مجلس خاص/مسودة/مغلق: التسجيل غير متاح.
    let privateId = '';
    await asUser(teacher, async () => {
      privateId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'درس خاص', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 5, 'private', 'approval', ''])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [privateId, 'published']);
    });
    await db.exec('set role anon');
    assert.equal((await db.query('select * from public.list_public_course_seats($1)',[[privateId]])).rows.length,0);
    await db.exec('reset role');
    await asUser(studentA, async () => {
      await assert.rejects(db.query('select public.register_for_course($1)', [privateId]), e => e.code === '42501');
    });
    // 9) كتابة مباشرة ممنوعة.
    await asUser(studentA, async () => {
      await assert.rejects(db.query("insert into public.course_registrations(course_id,user_id) values($1,$2)", [courseId, studentA]), e => e.code === '42501');
      await assert.rejects(db.query("update public.course_registrations set status='registered' where course_id=$1", [courseId]), e => e.code === '42501');
    });
    // 10) معلم معلّق: مجلسه (إن وُجد منشور) غير قابل للتسجيل (is_teacher_approved false).
    // (لا إنشاء مجلس معلّق في هذا الاختبار؛ التحقق من is_teacher_approved مغطى في courses-lifecycle).
  } finally { await db.close(); }
});
