import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('mudarasa meetings: staff schedule, members reveal the link, attendance and summary', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const creator = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const outsider = '55555555-5555-4555-8555-555555555555';
  async function asUser(id, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { await fn(); } finally { await db.exec('reset role'); }
  }
  const url = 'https://meet.google.com/abc-defg-hij';
  const start = new Date(Date.now() + 86400000).toISOString();
  const end = new Date(Date.now() + 86400000 + 3600000).toISOString();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth, public to anon, authenticated;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key, bucket_id text, name text);
      alter table storage.objects enable row level security; create extension if not exists pgcrypto with schema extensions;`);
    await db.exec(`insert into auth.users(id) values ('${creator}'),('${member}'),('${outsider}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');

    let circleId = '';
    await asUser(creator, async () => {
      circleId = (await db.query('select public.create_study_circle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as id',
        ['مدارسة الاجتماعات', 'book', 'aqeedah', 'sync', '', '', 'approval', null, null, null, '', ''])).rows[0].id;
    });
    await db.query(`insert into public.study_circle_members(circle_id,user_id,role) values($1,$2,'member')`, [circleId, member]);

    let meetingId = '';
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.schedule_study_meeting($1,$2,$3,$4,$5,$6)', [circleId, 'لقاء', start, end, url, '']), e => e.code === '42501');
    });
    await asUser(creator, async () => {
      await assert.rejects(db.query('select public.schedule_study_meeting($1,$2,$3,$4,$5,$6)', [circleId, 'لقاء', start, end, 'https://evil.example/abc', '']), e => e.code === '22023');
      await assert.rejects(db.query('select public.schedule_study_meeting($1,$2,$3,$4,$5,$6)', [circleId, 'لقاء', end, start, url, '']), e => e.code === '22023');
      meetingId = (await db.query('select public.schedule_study_meeting($1,$2,$3,$4,$5,$6) as id', [circleId, 'لقاء الأسبوع الأول', start, end, url, 'مراجعة الفصل الأول'])).rows[0].id;
    });
    assert.equal((await db.query("select count(*)::int as n from public.notifications where recipient_id=$1 and title like 'اجتماع جديد%'", [member])).rows[0].n, 1);

    await asUser(member, async () => {
      await assert.rejects(db.query('select meeting_url from public.study_meetings'), e => e.code === '42501');
      const list = (await db.query('select * from public.list_study_meetings($1)', [circleId])).rows;
      assert.equal(list.length, 1);
      assert.equal(list[0].has_meeting_link, true);
      assert.equal('meeting_url' in list[0], false);
      assert.equal((await db.query('select public.reveal_study_meeting_url($1) as url', [meetingId])).rows[0].url, url);
      await assert.rejects(db.query('select public.mark_study_attendance($1,$2,$3)', [meetingId, member, 'present']), e => e.code === '42501');
      await assert.rejects(db.query('select public.save_study_meeting_summary($1,$2,$3)', [meetingId, 'x', '']), e => e.code === '42501');
    });
    await asUser(outsider, async () => {
      await assert.rejects(db.query('select * from public.list_study_meetings($1)', [circleId]), e => e.code === '42501');
      await assert.rejects(db.query('select public.reveal_study_meeting_url($1)', [meetingId]), e => e.code === '42501');
    });

    await asUser(creator, async () => {
      await assert.rejects(db.query('select public.mark_study_attendance($1,$2,$3)', [meetingId, outsider, 'present']), e => e.code === '22023');
      await db.query('select public.mark_study_attendance($1,$2,$3)', [meetingId, member, 'present']);
      assert.equal((await db.query('select * from public.list_study_meeting_attendance($1)', [meetingId])).rows.length, 1);
      await db.query('select public.save_study_meeting_summary($1,$2,$3)', [meetingId, 'ناقشنا الفصل الأول.', 'مراجعة المصادر']);
    });
    await asUser(member, async () => {
      const row = (await db.query('select * from public.list_study_meetings($1)', [circleId])).rows[0];
      assert.equal(row.status, 'completed');
      assert.equal(row.summary, 'ناقشنا الفصل الأول.');
      assert.equal(row.my_attendance, 'present');
      assert.equal(Number(row.present_count), 1);
      await assert.rejects(db.query('select public.reveal_study_meeting_url($1)', [meetingId]), e => e.code === '42501');
    });

    let secondId = '';
    await asUser(creator, async () => {
      secondId = (await db.query('select public.schedule_study_meeting($1,$2,$3,$4,$5,$6) as id', [circleId, 'لقاء ثانٍ', start, end, url, ''])).rows[0].id;
      await db.query('select public.cancel_study_meeting($1)', [secondId]);
      await assert.rejects(db.query('select public.cancel_study_meeting($1)', [secondId]), e => e.code === 'P0001');
      await db.query('select public.set_study_circle_status($1,$2)', [circleId, 'paused']);
      await assert.rejects(db.query('select public.schedule_study_meeting($1,$2,$3,$4,$5,$6)', [circleId, 'لقاء ثالث', start, end, url, '']), e => e.code === 'P0001');
    });
  } finally { await db.close(); }
});
