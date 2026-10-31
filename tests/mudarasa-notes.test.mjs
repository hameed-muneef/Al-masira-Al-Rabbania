import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// AL_MUDARASA Phase 2 foundation: study notes (6 types), comments, helpful reactions, RLS.

test('mudarasa notes: add/list/update/delete note, comments, helpful, RLS', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const creator = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const outsider = '55555555-5555-4555-8555-555555555555';
  async function asUser(id, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { await fn(); } finally { await db.exec('reset role'); };
  };
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
    await db.exec(`insert into auth.users(id) values ('${creator}'),('${member}'),('${outsider}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');

    let circleId = '';
    await asUser(creator, async () => {
      circleId = (await db.query('select public.create_study_circle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as id',
        ['مدارسة الفوائد', 'book', 'aqeedah', 'sync', 'وصف', 'هدف', 'approval', null, null, null, '', ''])).rows[0].id;
    });
    await db.query("insert into public.study_circle_members(circle_id,user_id,role) values($1,$2,'member')", [circleId, member]);

    // 1) إضافة فائدة علمية من عضو (المؤسس).
    let noteId = '';
    await asUser(creator, async () => {
      noteId = (await db.query('select public.add_study_note($1,$2,$3,$4,$5,$6,$7,$8) as id',
        [circleId, 'scientific', 'فائدة في أول فصل', 'كانت الفوائد واضحة جدًا.', null, null, null, ''])).rows[0].id;
      assert.match(noteId, /^[0-9a-f-]{36}$/i);
    });

    // 2) قائمة المشاركات للأعضاء فقط + عدد الفوائد النافعة.
    let notes = (await db.query('select * from public.list_study_notes($1)', [circleId])).rows;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].note_type, 'scientific');
    assert.equal(Number(notes[0].helpful_count), 0);
    assert.equal(notes[0].author_id, creator);

    // 3) علامة فائدة نافعة وإلغاؤها.
    await asUser(creator, async () => { await db.query('select public.toggle_study_note_helpful($1,$2)', [noteId, true]); });
    notes = (await db.query('select * from public.list_study_notes($1)', [circleId])).rows;
    assert.equal(Number(notes[0].helpful_count), 1);
    await asUser(creator, async () => { await db.query('select public.toggle_study_note_helpful($1,$2)', [noteId, false]); });
    notes = (await db.query('select * from public.list_study_notes($1)', [circleId])).rows;
    assert.equal(Number(notes[0].helpful_count), 0);

    // 4) تعليق على الفائدة.
    await asUser(member, async () => {
      const commentId = (await db.query('select public.add_study_note_comment($1,$2) as id', [noteId, 'سؤال: هل نحتاج لمراجعة المصدر؟'])).rows[0].id;
      assert.match(commentId, /^[0-9a-f-]{36}$/i);
      const comments = (await db.query('select * from public.study_note_comments where note_id=$1', [noteId])).rows;
      assert.equal(comments.length, 1);
      assert.equal(comments[0].author_id, member);
      assert.equal(comments[0].content, 'سؤال: هل نحتاج لمراجعة المصدر؟');
    });

    // 5) تعديل من صاحب الفائدة + حذف من صاحبها.
    await asUser(creator, async () => { await db.query('select public.update_study_note($1,$2,$3,$4,$5,$6,$7)', [noteId, 'فائدة أول فصل (محدّثة)', 'كانت الفوائد واضحة جدًا.', null, null, null, '']); });
    notes = (await db.query('select * from public.list_study_notes($1)', [circleId])).rows;
    assert.equal(notes[0].title, 'فائدة أول فصل (محدّثة)');
    await asUser(creator, async () => { await db.query('select public.delete_study_note($1)', [noteId]); });
    notes = (await db.query('select * from public.list_study_notes($1)', [circleId])).rows;
    assert.equal(notes.length, 0);

    // 6) نوع فائدة غير صالح → رفض.
    await asUser(creator, async () => {
      await assert.rejects(db.query('select public.add_study_note($1,$2,$3,$4,$5,$6,$7,$8)', [circleId, 'hacked', 'x', 'y', null, null, null, '']), e => e.code === '22023');
    });

    // 7) عضو خارج المدارسة لا يضيف فائدة.
    await asUser(outsider, async () => {
      await assert.rejects(db.query('select public.add_study_note($1,$2,$3,$4,$5,$6,$7,$8)', [circleId, 'scientific', 'x', 'y', null, null, null, '']), e => e.code === '42501');
      assert.equal((await db.query('select count(*)::int as n from public.study_notes')).rows[0].n, 0);
    });

    // 8) غير عضو لا يرى المشاركات.
    await asUser(outsider, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_notes')).rows[0].n, 0);
    });
  } catch (e) { console.error('FAILED:', e && e.code, e && e.message); if (e && e.query) console.error('QUERY:', e.query); throw e; } finally { await db.close(); };
});
