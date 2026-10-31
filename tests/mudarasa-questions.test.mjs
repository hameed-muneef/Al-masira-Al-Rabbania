import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('mudarasa questions: members reply, approved teachers verify, staff cannot self-verify, RLS', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const creator = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const teacher = '33333333-3333-4333-8333-333333333333';
  const outsider = '55555555-5555-4555-8555-555555555555';
  async function asUser(id, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { await fn(); } finally { await db.exec('reset role'); }
  }
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
    await db.exec(`insert into auth.users(id) values ('${creator}'),('${member}'),('${teacher}'),('${outsider}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');

    let circleId = '';
    await asUser(creator, async () => {
      circleId = (await db.query('select public.create_study_circle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as id',
        ['مدارسة الأسئلة', 'book', 'aqeedah', 'sync', '', '', 'approval', null, null, null, '', ''])).rows[0].id;
    });
    await db.query(`insert into public.study_circle_members(circle_id,user_id,role) values
      ($1,$2,'member'),($1,$3,'teacher')`, [circleId, member, teacher]);
    await db.query(`insert into public.teacher_applications
      (user_id,display_name,qualifications,endorsement,identity_status,qualification_status,endorsement_status,status)
      values($1,'معلم معتمد','مؤهل','تزكية','approved','approved','approved','approved')`, [teacher]);

    let questionId = '';
    await asUser(member, async () => {
      questionId = (await db.query('select public.add_study_question($1,$2,$3,$4) as id',
        [circleId, 'ما معنى هذا المصطلح؟', 'أحتاج شرحًا لمعنى المصطلح في الدرس.', null])).rows[0].id;
      assert.equal((await db.query('select * from public.list_study_questions($1)', [circleId])).rows.length, 1);
      await assert.rejects(
        db.query('select public.add_study_question($1,$2,$3,$4)', [circleId, 'س', 'سؤال غير صالح', null]),
        error => error.code === '22023'
      );
    });
    assert.equal((await db.query("select count(*)::int as n from public.notifications where recipient_id=$1 and title like 'سؤال جديد%'", [creator])).rows[0].n, 1);

    await asUser(outsider, async () => {
      assert.equal((await db.query('select * from public.list_study_questions($1)', [circleId])).rows.length, 0);
      await assert.rejects(
        db.query('select public.reply_study_question($1,$2)', [questionId, 'رد خارج المدارسة']),
        error => error.code === '42501'
      );
      await assert.rejects(db.query('select * from public.study_questions'), error => error.code === '42501');
    });

    await asUser(creator, async () => {
      await assert.rejects(
        db.query('select public.set_study_question_state($1,$2,$3)', [questionId, 'answered', false]),
        error => error.code === '42501'
      );
    });
    await asUser(member, async () => {
      await db.query('select public.reply_study_question($1,$2)', [questionId, 'هذا رد من عضو يحتاج مراجعة.']);
      const replies = (await db.query('select * from public.list_study_question_replies($1)', [questionId])).rows;
      assert.equal(replies.length, 1);
      assert.equal(replies[0].teacher_verified, false);
    });
    await asUser(teacher, async () => {
      await db.query('select public.reply_study_question($1,$2)', [questionId, 'الجواب الموثق من المعلم المعتمد.']);
      const replies = (await db.query('select * from public.list_study_question_replies($1)', [questionId])).rows;
      assert.equal(replies.length, 2);
      assert.equal(replies[1].teacher_verified, true);
      await db.query('select public.set_study_question_state($1,$2,$3)', [questionId, 'answered', true]);
    });
    await asUser(member, async () => {
      const question = (await db.query('select * from public.list_study_questions($1)', [circleId])).rows[0];
      assert.equal(question.status, 'answered');
      assert.equal(question.is_pinned, true);
      assert.equal(Number(question.reply_count), 2);
      await assert.rejects(
        db.query('select public.set_study_question_state($1,$2,$3)', [questionId, 'needs_review', false]),
        error => error.code === '42501'
      );
    });
    assert.equal((await db.query("select count(*)::int as n from public.notifications where recipient_id=$1 and title='رد جديد على سؤالك'", [member])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from public.notifications where recipient_id=$1 and title='تمت الإجابة عن سؤالك'", [member])).rows[0].n, 1);
  } finally { await db.close(); }
});
