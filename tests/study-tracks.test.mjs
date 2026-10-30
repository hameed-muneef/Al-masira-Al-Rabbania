import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('study tracks: create, parts, progress, access', async () => {
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

    // 1) teacher creates study track linked to a published course.
    let courseId = '';
    await asUser(teacher, async () => {
      courseId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'دورة دراسة', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 5, 'public', 'open', ''])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
    });

    let trackId = '';
    await asUser(teacher, async () => {
      trackId = (await db.query('select public.create_study_track($1,$2,$3,$4)', ['مسار كتاب', 'كتاب', 'وصف', courseId])).rows[0].create_study_track;
      assert.match(trackId, /^[0-9a-f-]{36}$/i);
      const partId = (await db.query('select public.add_study_part($1,$2,$3,$4,$5)', [trackId, 1, 'باب 1', 'محتوى', 'سؤال؟'])).rows[0].add_study_part;
      assert.match(partId, /^[0-9a-f-]{36}$/i);
      await assert.rejects(db.query('select public.add_study_part($1,$2,$3)', [trackId, 1, ' duplicate']), e => e.code === '23505');
    });

    // 2) student sees track + parts.
    await asUser(student, async () => {
      const tracks = (await db.query('select * from public.list_study_tracks($1)', [courseId])).rows;
      assert.equal(tracks.length, 1);
      const parts = (await db.query('select * from public.list_study_parts($1)', [trackId])).rows;
      assert.equal(parts.length, 1);
      assert.equal(parts[0].part_title, 'باب 1');
    });

    // 3) student marks part complete; progress recorded.
    await asUser(student, async () => {
      await db.query('select public.mark_study_part_complete($1,$2)', [trackId, 1]);
      await db.query('select public.mark_study_part_complete($1,$2)', [trackId, 1]); // idempotent
      const progress = (await db.query('select count(*)::int as n from public.study_progress where track_id=$1 and user_id=$2', [trackId, student])).rows[0].n;
      assert.equal(progress, 1);
    });

    // 4) other student can also see (published course) and mark progress.
    await asUser(other, async () => {
      const tracks = (await db.query('select * from public.list_study_tracks($1)', [courseId])).rows;
      assert.equal(tracks.length, 1);
      await db.query('select public.mark_study_part_complete($1,$2)', [trackId, 1]);
    });

    // 5) non-member cannot create track for a circle they don't own.
    let circleId = '';
    await asUser(teacher, async () => {
      circleId = (await db.query('select public.create_group($1,$2) as id', ['حلقة دراسة', 'book'])).rows[0].id;
    });
    await asUser(student, async () => {
      await assert.rejects(db.query('select public.create_study_track($1,$2,$3,$4,$5)', ['مسار', 'كتاب', '', null, circleId]), e => e.code === '42501');
    });

    // 6) founder creates track for their circle; member reads.
    await asUser(teacher, async () => {
      const tid = (await db.query('select public.create_study_track($1,$2,$3,$4,$5)', ['مسار حلقة', 'كتاب', '', null, circleId])).rows[0].create_study_track;
      assert.match(tid, /^[0-9a-f-]{36}$/i);
    });
    await db.query(`insert into public.group_members(group_id,user_id,role) values($1,$2,'member')`, [circleId, student]);
    await asUser(student, async () => {
      const tracks = (await db.query('select * from public.list_study_tracks($1,$2)', [null, circleId])).rows;
      assert.equal(tracks.length, 1);
    });

    // 7) direct writes denied (RLS) for study_tracks/study_parts.
    await asUser(student, async () => {
      await assert.rejects(db.query("insert into public.study_tracks(title,created_by) values('x',$1)", [student]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.study_parts(track_id,position,title) values($1,1,'x')", [trackId]), e => e.code === '42501');
    });

    // 8) invalid part position → 22023.
    await asUser(teacher, async () => {
      await assert.rejects(db.query('select public.add_study_part($1,$2,$3)', [trackId, 0, 'x']), e => e.code === '22023');
    });
  } finally { await db.close(); }
});
