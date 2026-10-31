import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// ILM-009: اختبارات مجالس العلم — دورة حياة المجالس، وحدود النشر، ومنع المدفوع
// بلا استحقاق، وخصوصية التسليمات والمواد.
test('ilm councils: lifecycle, publishing gates, entitlement, submission privacy', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const teacher = '11111111-1111-4111-8111-111111111111';
  const admin = '22222222-2222-4222-8222-222222222222';
  const student = '33333333-3333-4333-8333-333333333333';
  const other = '44444444-4444-4444-8444-444444444444';
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
    await asUser(admin,async()=>{
      await db.query('select public.save_platform_feature_pricing($1,$2,$3,$4,$5,$6,$7,$8)',
        ['circle_live','جلسات التواصي المباشرة','',true,true,null,null,null]);
    });

    // 1) قبل الاعتماد: لا إنشاء ولا نشر.
    await asUser(teacher, async () => {
      await assert.rejects(db.query('select public.create_course($1,$2)', ['lesson', 'درس']), e => e.code === '42501');
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)', ['شيخ مختبر', 'نبذة', 'فقه', 'مؤهلات', 'تزكية']);
    });
    await asUser(admin, async () => {
      await db.query('select public.review_teacher_application($1,$2,$3,$4,$5)', [teacher, 'approved', 'approved', 'approved', 'تم']);
    });

    // 2) دورة حياة المجلس: مسودة → منشور، مع بوابة الدروس للسلسلة.
    let courseId = '';
    let seriesId = '';
    await asUser(teacher, async () => {
      courseId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'مجلس الاختبار', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 3, 'public', 'open', ''])).rows[0].id;
      assert.equal((await db.query('select status from public.courses where id=$1', [courseId])).rows[0].status, 'draft');
      // سلسلة بلا دروس: النشر مرفوض حتى تكتمل الدروس.
      seriesId = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['series', 'سلسلة بلا دروس', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 3, 'public', 'open', ''])).rows[0].id;
      await assert.rejects(db.query('select public.set_course_status($1,$2)', [seriesId, 'published']), e => e.code === 'P0001');
      await db.query('select public.save_course_lesson($1,$2,$3,$4)', [seriesId, null, 1, 'الدرس الأول']);
      await db.query('select public.save_course_lesson($1,$2,$3,$4)', [seriesId, null, 2, 'الدرس الثاني']);
      await db.query('select public.set_course_status($1,$2)', [seriesId, 'published']);
      await db.query('select public.set_course_status($1,$2)', [courseId, 'published']);
      assert.equal((await db.query('select status from public.courses where id=$1', [courseId])).rows[0].status, 'published');
      // التعديل بعد النشر مرفوض
      await assert.rejects(db.query('select public.update_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [courseId, 'lesson', 'عنوان جديد', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 3, 'public', 'open', '']), e => e.code === 'P0001');
    });

    // 3) السعة والتسجيل: ثالث يسدّ السعة، ورابع يُرفض.
    await asUser(student, async () => {
      await db.query('select public.register_for_course($1)', [courseId]);
    });
    await asUser(other, async () => {
      await db.query('select public.register_for_course($1)', [courseId]);
    });
    const third = '55555555-5555-4555-8555-555555555555';
    const fourth = '66666666-6666-4666-8666-666666666666';
    await db.exec(`insert into auth.users(id) values ('${third}'),('${fourth}')`);
    await asUser(third, async () => {
      await db.query('select public.register_for_course($1)', [courseId]);
    });
    await asUser(fourth, async () => {
      await assert.rejects(db.query('select public.register_for_course($1)', [courseId]), e => e.code === 'P0001');
    });

    // 4) منع المدفوع بلا استحقاق: لا أحد يملك الميزة المميزة دون اشتراك سارٍ أو منحة إدارية.
    await asUser(student, async () => {
      const ok = (await db.query('select public.has_feature_access($1) as ok', ['circle_live'])).rows[0].ok;
      assert.equal(ok, false);
    });
    await asUser(other, async () => {
      const ok = (await db.query('select public.has_feature_access($1) as ok', ['circle_live'])).rows[0].ok;
      assert.equal(ok, false);
    });

    // 5) خصوصية التسليمات: الطالب يرى تسليمه، والآخر لا يرى.
    // الواجب يُنشأ في مسودة (الواجهات لا تُعدَّل بعد النشر) ثم يُنشر المجلس.
    let assignmentId = '';
    await asUser(teacher, async () => {
      const draftCourse = (await db.query('select public.create_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
        ['lesson', 'مجلس الواجبات', 'وصف', 'هدف', '', 'all', 'فقه', 'موعد', '2026-12-01T10:00:00Z', 'Africa/Cairo', 3, 'public', 'open', ''])).rows[0].id;
      assignmentId = (await db.query('select public.save_course_assignment($1,$2,$3,$4,$5,$6) as id',
        [draftCourse, null, 'واجب', 'وصف', null, 50])).rows[0].id;
      await db.query('select public.set_course_status($1,$2)', [draftCourse, 'published']);
    });
    await asUser(student, async () => {
      const draftCourse = (await db.query("select id from public.courses where title='مجلس الواجبات'")).rows[0].id;
      await db.query('select public.register_for_course($1)', [draftCourse]);
      await db.query('select public.submit_course_assignment($1,$2)', [assignmentId, 'إجابتي']);
    });
    await asUser(student, async () => {
      const subs = (await db.query('select * from public.list_course_submissions($1)', [assignmentId])).rows;
      assert.equal(subs.length, 1);
    });
    await asUser(other, async () => {
      const subs = (await db.query('select * from public.list_course_submissions($1)', [assignmentId])).rows;
      assert.equal(subs.length, 0);
    });

    // 6) المواد مرئية للنشر، والتعديل مرفوض بعد النشر.
    await asUser(teacher, async () => {
      await assert.rejects(db.query('select public.save_course_material($1,$2,$3,$4,$5)', [courseId, null, 1, 'text', 'x']), e => e.code === 'P0001');
    });

    // 7) تعليق الشيخ يحجب المنشور العام.
    await asUser(admin, async () => {
      await db.query('select public.review_teacher_application($1,$2,$3,$4,$5,$6)', [teacher, 'approved', 'approved', 'approved', 'تعليق', true]);
    });
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*)::int as n from public.courses where id=$1', [courseId])).rows[0].n, 0);
    await db.exec('reset role');

    // 8) لاCourse للأعضاء: القوائم العامة لا تعرض إلا المنشورة المسموح بها.
    await asUser(other, async () => {
      const visible = (await db.query('select count(*)::int as n from public.courses')).rows[0].n;
      assert.equal(visible, 0);
    });
  } finally { await db.close(); }
});
