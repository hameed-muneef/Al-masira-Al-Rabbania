import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('admin content archive is reversible, admin-only, and preserves privacy boundaries', async () => {
  const db = new PGlite();
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const admin = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const circle = '33333333-3333-4333-8333-333333333333';
  const course = '44444444-4444-4444-8444-444444444444';
  const lesson = '55555555-5555-4555-8555-555555555555';
  const sharedNote = '66666666-6666-4666-8666-666666666666';
  const privateNote = '77777777-7777-4777-8777-777777777777';
  const meeting = '88888888-8888-4888-8888-888888888888';
  const archivedTask = '99999999-9999-4999-8999-999999999999';
  const activeTask = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
      alter table storage.objects enable row level security;`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');
    await db.exec(`insert into auth.users(id) values ('${admin}'),('${member}');
      insert into public.admin_accounts(user_id) values ('${admin}');
      insert into public.study_circles(id,creator_id,title,kind,category,mode)
        values ('${circle}','${member}','مدارسة اختبار الأرشيف','book','aqeedah','async');
      insert into public.study_circle_members(circle_id,user_id,role) values ('${circle}','${member}','creator');
      insert into public.study_notes(id,circle_id,author_id,note_type,title,content)
        values ('${sharedNote}','${circle}','${member}','scientific','فائدة مشتركة','محتوى مشترك'),
               ('${privateNote}','${circle}','${member}','reflection','تأمل شخصي','محتوى خاص لا يدخل أداة الأرشيف');
      insert into public.study_plan_tasks(id,circle_id,position,title)
        values ('${archivedTask}','${circle}',1,'مهمة قديمة'),('${activeTask}','${circle}',2,'مهمة نشطة');
      insert into public.study_meetings(id,circle_id,title,agenda,starts_at,ends_at,meeting_url,created_by)
        values ('${meeting}','${circle}','اجتماع خاص','يرجى الانضمام https://meet.google.com/abc-defg-hij',
          '2026-10-31 10:00Z','2026-10-31 11:00Z',
          'https://meet.google.com/abc-defg-hij','${member}');
      insert into public.courses(id,teacher_id,kind,title,status)
        values ('${course}','${member}','course','دورة اختبار الأرشيف','published');
      insert into public.course_lessons(id,course_id,position,title)
        values ('${lesson}','${course}',1,'درس قابل للأرشفة');`);

    await asUser(member, async () => {
      assert.equal((await db.query('select * from public.list_study_notes($1)', [circle])).rows.length, 2);
      await assert.rejects(
        db.query('select public.list_admin_archivable_content(false,100,0)'),
        error => error.code === '42501'
      );
      await assert.rejects(
        db.query("select public.archive_platform_content('study_note',$1,'test')", [sharedNote]),
        error => error.code === '42501'
      );
    });

    await asUser(admin, async () => {
      const active = await db.query('select * from public.list_admin_archivable_content(false,100,0)');
      assert.equal(active.rows.filter(row => row.content_type === 'study_note').length, 1);
      assert.equal(active.rows.some(row => row.content_id === privateNote), false);
      const meetingRow = active.rows.find(row => row.content_type === 'study_meeting');
      assert.equal(meetingRow.content_summary, '');
      assert.equal(JSON.stringify(meetingRow).includes('meet.google.com'), false);

      await assert.rejects(
        db.query("select public.archive_platform_content('study_note',$1,'استثناء الخصوصية')", [privateNote]),
        error => error.code === 'P0001'
      );
      await db.query("select public.archive_platform_content('study_note',$1,'مراجعة المحتوى')", [sharedNote]);
      await db.query("select public.archive_platform_content('course_lesson',$1,'تنظيم المنهج')", [lesson]);
      await db.query("select public.archive_platform_content('study_meeting',$1,'إخفاء اجتماع قديم')", [meeting]);
      await db.query("select public.archive_platform_content('study_plan_task',$1,'تنظيم الخطة')", [archivedTask]);
      const archived = await db.query('select * from public.list_admin_archivable_content(true,100,0)');
      assert.equal(archived.rows.length, 4);
      assert.ok(archived.rows.every(row => row.archived_at));
    });

    await asUser(member, async () => {
      assert.equal((await db.query('select * from public.list_study_notes($1)', [circle])).rows.length, 1);
      assert.equal((await db.query('select * from public.study_plan_tasks where circle_id=$1', [circle])).rows.length, 1);
      await db.query('select public.set_study_plan($1,$2::jsonb)', [
        circle, JSON.stringify([{title:'تحديث المهمة النشطة',material_id:null,part_id:null,target_date:null}])
      ]);
      assert.equal((await db.query('select title from public.study_plan_tasks where id=$1', [activeTask])).rows[0].title,'تحديث المهمة النشطة');
      await db.query('select public.set_study_plan($1,$2::jsonb)', [
        circle, JSON.stringify([
          {title:'تحديث المهمة النشطة',material_id:null,part_id:null,target_date:null},
          {title:'مهمة جديدة',material_id:null,part_id:null,target_date:null}
        ])
      ]);
      assert.equal((await db.query('select * from public.study_plan_tasks where circle_id=$1', [circle])).rows.length, 2);
      assert.equal((await db.query('select total_tasks from public.study_progress_summary($1)', [circle])).rows[0].total_tasks,2);
      assert.equal((await db.query('select * from public.list_study_meetings($1)', [circle])).rows.length, 0);
      await assert.rejects(
        db.query('select public.reveal_study_meeting_url($1)', [meeting]),
        error => error.code === '42501'
      );
      await assert.rejects(
        db.query("select public.update_study_note($1,'','محاولة تعديل',null,null,null,'')", [sharedNote]),
        error => error.code === '42501'
      );
    });
    await asUser(admin, async () => {
      await db.query("select public.restore_platform_content('study_note',$1)", [sharedNote]);
      await db.query("select public.restore_platform_content('study_plan_task',$1)", [archivedTask]);
    });
    await asUser(member, async () => {
      assert.equal((await db.query('select * from public.list_study_notes($1)', [circle])).rows.length, 2);
      assert.equal((await db.query('select * from public.study_plan_tasks where circle_id=$1', [circle])).rows.length, 3);
    });
    await db.exec('set role anon');
    try {
      assert.equal((await db.query('select * from public.course_lessons where id=$1', [lesson])).rows.length, 0);
    } finally { await db.exec('reset role'); }
    await asUser(member, async () => {
      await assert.rejects(
        db.query('select public.restore_platform_content($1,$2)', ['course_lesson', lesson]),
        error => error.code === '42501'
      );
    });
    await asUser(admin, async () => {
      assert.equal((await db.query('select * from public.list_admin_archivable_content(true,100,0)')).rows.length, 2);
    });
  } finally { await db.close(); }
});
