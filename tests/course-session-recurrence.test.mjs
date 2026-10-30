import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('course session recurrence: generate N sessions, validation, ownership', async () => {
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
    await asUser(teacher, async () => {
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)', ['شيخ', 'نبذة', 'فقه', 'مؤهلات', 'تزكية']);
    });
    await asUser(admin, async () => {
      await db.query('select public.review_teacher_application($1,$2,$3,$4,$5)', [teacher, 'approved', 'approved', 'approved', 'تم']);
    });
    let courseId = '';
    await asUser(teacher, async () => {
      courseId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'دورة تكرار', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 5, 'public', 'open', ''])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
    });

    // 1) generate 4 weekly sessions.
    await asUser(teacher, async () => {
      const ids = (await db.query('select public.generate_course_sessions($1,$2,$3,$4,$5,$6) as id',
        [courseId, 'جلسة أسبوعية', '2026-12-02T10:00:00Z', 60, 4, 'weekly'])).rows.map((r) => r.id);
      assert.equal(ids.length, 4);
    });
    const count = (await db.query('select count(*)::int as n from public.course_sessions where course_id=$1', [courseId])).rows[0].n;
    assert.equal(count, 4);

    // 2) non-teacher cannot generate.
    await asUser(student, async () => {
      await assert.rejects(db.query('select public.generate_course_sessions($1,$2,$3,$4,$5)', [courseId, 'x', '2026-12-02T10:00:00Z', 60, 2]), e => e.code === '42501');
    });

    // 3) invalid params → 22023.
    await asUser(teacher, async () => {
      await assert.rejects(db.query('select public.generate_course_sessions($1,$2,$3,$4,$5,$6)', [courseId, 'x', '2026-12-02T10:00:00Z', 60, 0, 'weekly']), e => e.code === '22023');
      await assert.rejects(db.query('select public.generate_course_sessions($1,$2,$3,$4,$5,$6)', [courseId, 'x', '2026-12-02T10:00:00Z', 10, 2, 'weekly']), e => e.code === '22023');
      await assert.rejects(db.query('select public.generate_course_sessions($1,$2,$3,$4,$5,$6)', [courseId, 'x', '2026-12-02T10:00:00Z', 60, 2, 'nope']), e => e.code === '22023');
    });

    // 4) recurrence_rule stored.
    const rule = (await db.query('select distinct recurrence_rule from public.course_sessions where course_id=$1', [courseId])).rows[0].recurrence_rule;
    assert.equal(rule, 'weekly');

    // 5) direct writes denied.
    await asUser(student, async () => {
      await assert.rejects(db.query("insert into public.course_sessions(course_id,title,starts_at,ends_at,created_by) values($1,'x',now(),now()+interval '1 hour',$2)", [courseId, student]), e => e.code === '42501');
    });
  } finally { await db.close(); }
});

test('course sessions: recurring occurrences keep the local wall clock across DST', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const teacher = '11111111-1111-4111-8111-111111111111';
  const admin = '33333333-3333-4333-8333-333333333333';
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
    await db.exec(`insert into auth.users(id) values ('${teacher}'),('${admin}')`);
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
        ['lesson', 'دورة توقيت صيفي', 'وصف', 'هدف', '', 'all', 'فقه', 'وصف الجدول', '2026-11-01T14:00:00Z', 'America/New_York', 5, 'public', 'open', ''])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
    });
    // Occurrences before and after the spring-forward transition (America/New_York, 2026-03-08).
    await asUser(teacher, async () => {
      const springIds = (await db.query('select public.generate_course_sessions($1,$2,$3,$4,$5,$6) as id',
        [courseId, 'جلسة الربيع', '2026-03-01T15:00:00Z', 60, 2, 'weekly'])).rows.map((r) => r.id);
      assert.equal(springIds.length, 2);
    });
    // Occurrences around the autumn fall-back transition (America/New_York, 2026-11-01).
    await asUser(teacher, async () => {
      const fallIds = (await db.query('select public.generate_course_sessions($1,$2,$3,$4,$5,$6) as id',
        [courseId, 'جلسة الخريف', '2026-10-25T14:00:00Z', 60, 3, 'weekly'])).rows.map((r) => r.id);
      assert.equal(fallIds.length, 3);
    });
    const sessions = (await db.query(
      "select starts_at, ends_at, (starts_at at time zone 'America/New_York')::text as local_start from public.course_sessions where course_id=$1 order by starts_at",
      [courseId])).rows;
    // UTC instants plus the local wall clock: 10:00 local must be kept across DST shifts.
    assert.deepEqual(sessions.map((s) => [new Date(s.starts_at).toISOString(), s.local_start]), [
      ['2026-03-01T15:00:00.000Z', '2026-03-01 10:00:00'],
      ['2026-03-08T14:00:00.000Z', '2026-03-08 10:00:00'],
      ['2026-10-25T14:00:00.000Z', '2026-10-25 10:00:00'],
      ['2026-11-01T15:00:00.000Z', '2026-11-01 10:00:00'],
      ['2026-11-08T15:00:00.000Z', '2026-11-08 10:00:00'],
    ]);
  } finally { await db.close(); }
});
