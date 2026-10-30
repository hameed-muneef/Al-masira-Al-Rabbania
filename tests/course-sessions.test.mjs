import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('course sessions: teacher creates/cancels, attendance, visibility', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const teacher = '11111111-1111-4111-8111-111111111111';
  const admin = '33333333-3333-4333-8333-333333333333';
  const student = '44444444-4444-4444-8444-444444444444';
  const other = '55555555-5555-4555-8555-555555555555';
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
    await db.exec(`insert into auth.users(id) values ('${teacher}'),('${admin}'),('${student}'),('${other}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)', [admin]);
    await asUser(teacher, async () => {
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)', ['شيخ', 'نبذة', 'فقه', 'مؤهلات', 'تزكية']);
    });
    await asUser(admin, async () => {
      await db.query('select public.review_teacher_application($1,$2,$3,$4,$5)', [teacher, 'approved', 'approved', 'approved', 'تم']);
    });

    let courseId = '';
    await asUser(teacher, async () => {
      courseId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'دورة جلسات', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 5, 'public', 'open', ''])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
    });
    await asUser(student, async () => {
      await db.query('select public.register_for_course($1)', [courseId]);
    });

    // 1) غير معتمد لا يُنشئ جلسة.
    await asUser(other, async () => {
      await assert.rejects(db.query('select public.create_course_session($1,$2,$3,$4)', [courseId, 'جلسة', '2026-12-02T10:00:00Z', '2026-12-02T11:00:00Z']), e => e.code === '42501');
    });

    // 2) المعلم يُنشئ جلسة.
    let sessionId = '';
    await asUser(teacher, async () => {
      sessionId = (await db.query('select public.create_course_session($1,$2,$3,$4,$5,$6) as id',
        [courseId, 'جلسة أولى', '2026-12-02T10:00:00Z', '2026-12-02T11:00:00Z', 'https://meet.google.com/x', 'ملاحظات'])).rows[0].id;
      assert.match(sessionId, /^[0-9a-f-]{36}$/i);
      // dati غير صالحة → 22023
      await assert.rejects(db.query('select public.create_course_session($1,$2,$3,$4)', [courseId, 'x', '2026-12-02T10:00:00Z', '2026-12-02T09:00:00Z']), e => e.code === '22023');
    });

    // 3) الطالب/العموم يرون الجلسة.
    await asUser(student, async () => {
      const list = (await db.query('select * from public.list_course_sessions($1)', [courseId])).rows;
      assert.equal(list.length, 1);
      assert.equal(list[0].session_status, 'scheduled');
    });
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*)::int as n from public.list_course_sessions($1)', [courseId])).rows[0].n, 1);
    await db.exec('reset role');

    // 4) تسجيل حضور: المعلم يُسجّل طالبًا مسجلًا.
    await asUser(teacher, async () => {
      await db.query('select public.record_attendance($1,$2,$3,$4)', [sessionId, student, 'present', '']);
      // طالب غير مسجل → 42501
      await assert.rejects(db.query('select public.record_attendance($1,$2,$3)', [sessionId, other, 'present']), e => e.code === '42501');
      // حالة غير صالحة → 22023
      await assert.rejects(db.query('select public.record_attendance($1,$2,$3)', [sessionId, student, 'nope']), e => e.code === '22023');
    });

    // 5) الطالب يرى حضوره.
    await asUser(student, async () => {
      const att = (await db.query('select * from public.list_course_attendance($1)', [sessionId])).rows;
      assert.equal(att.length, 1);
      assert.equal(att[0].attendance_status, 'present');
    });
    // other لا يرى حضور student.
    await asUser(other, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.list_course_attendance($1)', [sessionId])).rows[0].n, 0);
    });

    // 6) إلغاء جلسة: المعلم.
    await asUser(teacher, async () => {
      await db.query('select public.cancel_course_session($1)', [sessionId]);
      const list = (await db.query('select session_status from public.list_course_sessions($1)', [courseId])).rows;
      assert.equal(list[0].session_status, 'cancelled');
      await db.query('select public.cancel_course_session($1)', [sessionId]); // idempotent
    });

    // 7) إلغاء من غير المعلم → 42501.
    await asUser(student, async () => {
      const sid2 = null;
      await assert.rejects(db.query('select public.cancel_course_session($1)', [sessionId]), e => e.code === '42501');
    });

    // 8) كتابة مباشرة ممنوعة.
    await asUser(student, async () => {
      await assert.rejects(db.query("insert into public.course_sessions(course_id,starts_at,ends_at,created_by) values($1,now(),now()+interval '1 hour',$2)", [courseId, student]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.course_attendance(session_id,user_id,status,recorded_by) values($1,$2,'present',$2)", [sessionId, student]), e => e.code === '42501');
    });
  } finally { await db.close(); }
});
