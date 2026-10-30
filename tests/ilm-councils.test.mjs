import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// ILM-009: consolidated acceptance walk for the ILM councils scope:
// teacher approval -> free course -> discovery -> registration -> sessions ->
// attendance -> recurrence. Free offerings require no payment entitlement.
test('ILM councils acceptance: approval, free course, discovery, sessions, attendance, registration', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const teacher = '11111111-1111-4111-8111-111111111111';
  const admin = '33333333-3333-4333-8333-333333333333';
  const student = '44444444-4444-4444-8444-444444444444';
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
    await db.exec(`insert into auth.users(id) values ('${teacher}'),('${admin}'),('${student}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)', [admin]);

    // Unapproved teacher cannot create a course.
    await asUser(teacher, async () => {
      await assert.rejects(db.query('select public.create_course($1,$2)', ['lesson', 'درس']), e => e.code === '42501');
    });
    // Approved teacher -> create -> publish -> free registration -> session -> attendance.
    await asUser(teacher, async () => {
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)', ['شيخ', 'نبذة', 'فقه', 'مؤهلات', 'تزكية']);
    });
    await asUser(admin, async () => {
      await db.query('select public.review_teacher_application($1,$2,$3,$4,$5)', [teacher, 'approved', 'approved', 'approved', 'تم']);
    });
    let courseId = '';
    await asUser(teacher, async () => {
      courseId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'دورة مجتمع', 'وصف', 'هدف', '', 'all', 'فقه', 'وصف الجدول', '2026-12-01T10:00:00Z', 'Africa/Cairo', 50, 'public', 'open', ''])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
    });
    // Free course: registration opens without any payment entitlement.
    await asUser(student, async () => {
      assert.equal((await db.query('select public.register_for_course($1)', [courseId])).rows[0].register_for_course, 'registered');
    });
    // Teacher creates a live session and records attendance for the registered student.
    let sessionId = '';
    await asUser(teacher, async () => {
      sessionId = (await db.query('select public.create_course_session($1,$2,$3,$4,$5,$6) as id',
        [courseId, 'جلسة مجتمع', '2026-12-02T10:00:00Z', '2026-12-02T11:00:00Z', 'https://meet.google.com/x', ''])).rows[0].id;
      await db.query('select public.record_attendance($1,$2,$3,$4)', [sessionId, student, 'present', '']);
      const att = (await db.query('select * from public.list_course_attendance($1)', [sessionId])).rows;
      assert.equal(att.length, 1);
      assert.equal(att[0].attendance_status, 'present');
    });
    // Recurring sessions keep working alongside attendance.
    await asUser(teacher, async () => {
      const ids = (await db.query('select public.generate_course_sessions($1,$2,$3,$4,$5,$6) as id',
        [courseId, 'جلسة دورية', '2026-12-02T10:00:00Z', 60, 3, 'weekly'])).rows.map((r) => r.id);
      assert.equal(ids.length, 3);
    });
    // Published public course is discoverable by an anonymous caller; private ones are not.
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*)::int as n from public.courses where id=$1', [courseId])).rows[0].n, 1);
    await db.exec('reset role');
  } finally { await db.close(); }
});
