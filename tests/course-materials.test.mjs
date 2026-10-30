import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('course materials/assignments: teacher manages, student submits, grading, privacy', async () => {
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
        ['lesson', 'دورة مواد', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 5, 'public', 'open', ''])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
    });
    await asUser(student, async () => {
      await db.query('select public.register_for_course($1)', [courseId]);
    });

    // 1) teacher saves material + assignment (draft only → but course published; materials allowed? migration allows save only in draft. Course is published → P0001)
    // Make a draft course for editing materials.
    let draftId = '';
    await asUser(teacher, async () => {
      draftId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'دورة مسودة', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 5, 'public', 'open', ''])).rows[0].id;
      const matId = (await db.query('select public.save_course_material($1,$2,$3,$4,$5,$6,$7)', [draftId, null, 1, 'link', 'رابط', '', 'https://example.com'])).rows[0].save_course_material;
      assert.match(matId, /^[0-9a-f-]{36}$/i);
      const asgId = (await db.query('select public.save_course_assignment($1,$2,$3,$4,$5,$6)', [draftId, null, 'واجب 1', 'وصف', null, 50])).rows[0].save_course_assignment;
      assert.match(asgId, /^[0-9a-f-]{36}$/i);
      // remove material
      await db.query('select public.remove_course_material($1,$2)', [draftId, matId]);
      await assert.rejects(db.query('select public.save_course_material($1,$2,$3,$4,$5)', [draftId, null, 2, 'badkind', 'x']), e => e.code === '22023');
    });

    // 2) published course materials/assignments visible to student.
    await asUser(teacher, async () => {
      // create materials/assignments on draft then publish
      const d2 = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'دورة مواد 2', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 5, 'public', 'open', ''])).rows[0].id;
      await db.query('select public.save_course_material($1,$2,$3,$4,$5,$6,$7)', [d2, null, 1, 'text', 'ملاحظة', 'نص مفيد', '']);
      await db.query('select public.save_course_assignment($1,$2,$3,$4,$5,$6)', [d2, null, 'واجب', 'وصف', null, 100]);
      await db.query('select public.set_course_status($1,$2)', [d2, 'published']);
      // update after publish → P0001
      await assert.rejects(db.query('select public.save_course_material($1,$2,$3,$4,$5)', [d2, null, 2, 'text', 'x']), e => e.code === 'P0001');
    });

    // 3) student submits assignment; teacher grades.
    // find published course with assignment
    const courses = (await db.query("select id from public.courses where title='دورة مواد 2'")).rows;
    const cId = courses[0].id;
    const asgs = (await db.query('select * from public.list_course_assignments($1)', [cId])).rows;
    assert.equal(asgs.length, 1);
    const asgId = asgs[0].assignment_id;
    await asUser(student, async () => {
      await db.query('select public.register_for_course($1)', [cId]);
    });
    await asUser(student, async () => {
      const subId = (await db.query('select public.submit_course_assignment($1,$2,$3)', [asgId, 'إجابتي', ''])).rows[0].submit_course_assignment;
      assert.match(subId, /^[0-9a-f-]{36}$/i);
      // re-submit updates
      await db.query('select public.submit_course_assignment($1,$2)', [asgId, 'إجابتي 2']);
      const subs = (await db.query('select * from public.list_course_submissions($1)', [asgId])).rows;
      assert.equal(subs.length, 1);
      assert.equal(subs[0].submission_content, 'إجابتي 2');
    });

    // 4) student not registered → cannot submit.
    await asUser(other, async () => {
      await assert.rejects(db.query('select public.submit_course_assignment($1,$2)', [asgId, 'x']), e => e.code === '42501');
    });

    // 5) teacher grades.
    await asUser(teacher, async () => {
      const subs = (await db.query('select * from public.list_course_submissions($1)', [asgId])).rows;
      assert.equal(subs.length, 1);
      await db.query('select public.grade_course_submission($1,$2,$3)', [subs[0].submission_id, 85, 'أحسنت']);
      const graded = (await db.query('select submission_score, submission_status from public.list_course_submissions($1)', [asgId])).rows[0];
      assert.equal(graded.submission_score, 85);
      assert.equal(graded.submission_status, 'graded');
      // score out of range → 22023
      await assert.rejects(db.query('select public.grade_course_submission($1,$2)', [subs[0].submission_id, 999]), e => e.code === '22023');
    });

    // 6) student sees own submission; other student does not.
    await asUser(student, async () => {
      const subs = (await db.query('select * from public.list_course_submissions($1)', [asgId])).rows;
      assert.equal(subs.length, 1);
    });
    await asUser(other, async () => {
      const subs = (await db.query('select * from public.list_course_submissions($1)', [asgId])).rows;
      assert.equal(subs.length, 0);
    });

    // 7) materials visible to student.
    const mats = (await db.query('select * from public.list_course_materials($1)', [cId])).rows;
    assert.equal(mats.length, 1);

    // 8) direct writes denied.
    await asUser(student, async () => {
      await assert.rejects(db.query("insert into public.course_materials(course_id,position,kind,title) values($1,1,'text','x')", [cId]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.course_submissions(assignment_id,user_id,content) values($1,$2,'x')", [asgId, student]), e => e.code === '42501');
    });
  } catch (e) {
    throw e;
  } finally { await db.close(); }
});
