import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// INV-001 acceptance: invitations are sent from their activity, authorized on the
// server, deduplicated, expirable, cancellable, and answered only by the invitee.
// Covers study circles, scholarly courses and Tawasi sessions plus the shared
// list_my_activity_invitations/respond_activity_invitation layer.

const ids = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
  d: '44444444-4444-4444-8444-444444444444',
  hidden: '55555555-5555-4555-8555-555555555555',
  blocked: '66666666-6666-4666-8666-666666666666',
  teacher: '77777777-7777-4777-8777-777777777777',
  mentor: '88888888-8888-4888-8888-888888888888',
  admin: '99999999-9999-4999-8999-999999999999'
};

async function setup() {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
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
  for (const id of Object.values(ids)) await db.query('insert into auth.users(id) values($1)', [id]);
  await db.exec('begin');
  await applyMigrations(client, await readMigrations());
  await db.exec('commit');
  await db.query('insert into public.admin_accounts(user_id) values($1)', [ids.admin]);
  await db.query(`insert into public.teacher_applications(user_id,display_name,identity_status,qualification_status,endorsement_status,status)
    values($1,'Teacher','approved','approved','approved','approved')`, [ids.teacher]);
  const course = (await db.query(`insert into public.courses(teacher_id,kind,title,status,capacity,starts_at)
    values($1,'lesson','مجلس الدعوات','published',1,now()+interval '3 days') returning id`, [ids.teacher])).rows[0].id;
  await db.query(`insert into public.tawasi_mentors(user_id,display_name,biography,mentor_type,qualifications,status,directory_visible)
    values($1,'Mentor','','mentor','Qualified','approved',true)`, [ids.mentor]);
  const slots = [];
  for (let i = 0; i < 4; i += 1) {
    slots.push((await db.query(`insert into public.tawasi_mentor_slots(mentor_id,starts_at,ends_at)
      values($1,now()+make_interval(days=>$2),now()+make_interval(days=>$2,mins=>60)) returning id`,
      [ids.mentor, 3 + i])).rows[0].id);
  }
  await db.query("insert into public.member_blocks(blocker_id,blocked_id) values($1,$2)", [ids.blocked, ids.teacher]);
  const asUser = async (id, fn) => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const q = (sql, params) => db.query(sql, params);
  const fails = async (promise, code) => {
    await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; });
  };
  return {db, q, asUser, fails, course, slots};
}

test('activity invitations: study, course and Tawasi lifecycle, privacy and authorization', async () => {
  const {db, q, asUser, fails, course, slots} = await setup();
  try {
    // كل المدعوين لديهم اسم مستخدم؛ hidden غير قابل للاكتشاف.
    for (const [id, username, visible] of [
      [ids.a, 'alice_one', true], [ids.b, 'bob_one', true], [ids.c, 'carol_one', true],
      [ids.d, 'dave_one', true], [ids.hidden, 'hidden_one', false], [ids.blocked, 'blocked_one', true]
    ]) {
      await asUser(id, async () => { await q('select public.save_my_share_profile($1,$2,$3)', [username, username, visible]); });
    }

    // ---------- مجالس العلم ----------
    const inv = async (teacher, username) =>
      (await asUser(teacher, async () => (await q('select public.invite_course_member($1,$2) as id', [course, username])).rows[0].id));

    await asUser(ids.c, async () => {
      await fails(q('select public.invite_course_member($1,$2)', [course, 'bob_one']), '42501');
      await fails(q('select public.list_course_invites($1)', [course]), '42501');
    });
    await asUser(ids.teacher, async () => {
      await fails(q('select public.invite_course_member($1,$2)', [course, 'hidden_one']), 'P0001');
      await fails(q('select public.invite_course_member($1,$2)', [course, 'blocked_one']), 'P0001');
      await fails(q('select public.invite_course_member($1,$2)', [course, 'nobody_here']), 'P0001');
    });

    const courseInvite = await inv(ids.teacher, 'bob_one');
    await asUser(ids.teacher, async () => {
      await fails(q('select public.invite_course_member($1,$2)', [course, 'bob_one']), 'P0001');
      const rows = (await q('select * from public.list_course_invites($1)', [course])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].invitee_username, 'bob_one');
      assert.equal(rows[0].status, 'pending');
    });

    // المستلم يرى الدعوة عبر الطبقة الموحّدة، وقراءة الإشعارات لا تغيّر حالتها.
    await asUser(ids.b, async () => {
      const rows = (await q("select * from public.list_my_activity_invitations('course')")).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].activity_type, 'course');
      assert.equal(rows[0].invitation_id, courseInvite);
      assert.equal(rows[0].activity_title, 'مجلس الدعوات');
      assert.equal((await q("select * from public.list_my_activity_invitations('tawasi_session')")).rows.length, 0);
      await q('select public.mark_all_notifications_read()');
    });
    assert.equal((await q('select status from public.course_invitations where id=$1', [courseInvite])).rows[0].status, 'pending');

    // لا يملك غير المدعو الرد أو الإلغاء.
    await asUser(ids.c, async () => {
      await fails(q('select public.respond_course_invitation($1,true)', [courseInvite]), '42501');
      await fails(q('select public.cancel_course_invite($1)', [courseInvite]), '42501');
    });

    // إلغاء الدعوة المعلّقة يمنع قبولها لاحقًا.
    await asUser(ids.teacher, async () => { await q('select public.cancel_course_invite($1)', [courseInvite]); });
    assert.equal((await q('select status from public.course_invitations where id=$1', [courseInvite])).rows[0].status, 'cancelled');
    await asUser(ids.b, async () => {
      await fails(q('select public.respond_course_invitation($1,true)', [courseInvite]), 'P0001');
    });

    // قبول دعوة يسجّل المشارك فعلًا، ويُشعر المعلم مرة واحدة.
    const acceptedInvite = await inv(ids.teacher, 'bob_one');
    await asUser(ids.b, async () => {
      assert.equal((await q('select public.respond_activity_invitation($1,$2,true) as r', ['course', acceptedInvite])).rows[0].r, 'accepted');
    });
    assert.equal((await q('select status from public.course_invitations where id=$1', [acceptedInvite])).rows[0].status, 'accepted');
    assert.equal((await q("select count(*)::int n from public.course_registrations where course_id=$1 and user_id=$2 and status='registered'", [course, ids.b])).rows[0].n, 1);
    assert.equal((await q("select count(*)::int n from public.notifications where recipient_id=$1 and kind='invitation' and title like 'قبل دعوتك%'", [ids.teacher])).rows[0].n, 1);

    // السعة تبقى محفوظة، والدعوة المعلقة لا تحجز مقعدًا.
    const capacityInvite = await inv(ids.teacher, 'carol_one');
    await asUser(ids.c, async () => {
      await fails(q('select public.respond_activity_invitation($1,$2,true)', ['course', capacityInvite]), 'P0001');
    });
    assert.equal((await q('select status from public.course_invitations where id=$1', [capacityInvite])).rows[0].status, 'pending');
    await asUser(ids.teacher, async () => { await q('select public.cancel_course_invite($1)', [capacityInvite]); });

    // الدعوة المنتهية لا تُقبل.
    const expiredInvite = await inv(ids.teacher, 'dave_one');
    await q("update public.course_invitations set expires_at=now()-interval '1 minute' where id=$1", [expiredInvite]);
    await asUser(ids.d, async () => {
      assert.equal((await q('select public.respond_course_invitation($1,true) as r', [expiredInvite])).rows[0].r, 'expired');
    });
    assert.equal((await q('select status from public.course_invitations where id=$1', [expiredInvite])).rows[0].status, 'expired');

    await asUser(ids.b, async () => {
      await fails(q("select * from public.list_my_activity_invitations('unknown')"), '22023');
      await fails(q("select public.respond_activity_invitation('unknown',$1,true)", [acceptedInvite]), '22023');
    });

    // ---------- جلسات التواصي ----------
    await asUser(ids.b, async () => {
      await fails(q('select public.invite_tawasi_member($1,$2,$3)', [slots[0], 'alice_one', 'توجيه']), '42501');
    });
    const tawasiInvite = async (username, slot) =>
      (await asUser(ids.mentor, async () => (await q('select public.invite_tawasi_member($1,$2,$3) as id', [slot, username, 'توجيه تربوي'])).rows[0].id));

    const firstTawasi = await tawasiInvite('alice_one', slots[0]);
    await asUser(ids.mentor, async () => {
      await fails(q('select public.invite_tawasi_member($1,$2,$3)', [slots[0], 'alice_one', 'توجيه تربوي']), 'P0001');
    });
    const secondTawasi = await tawasiInvite('bob_one', slots[0]);
    await asUser(ids.b, async () => {
      await fails(q('select public.respond_tawasi_invitation($1,true)', [firstTawasi]), '42501');
    });

    await asUser(ids.a, async () => {
      assert.equal((await q('select public.respond_activity_invitation($1,$2,true) as r', ['tawasi_session', firstTawasi])).rows[0].r, 'accepted');
    });
    assert.equal((await q('select status from public.tawasi_mentor_slots where id=$1', [slots[0]])).rows[0].status, 'booked');
    assert.equal((await q("select status from public.tawasi_mentorship_requests where slot_id=$1 and requester_id=$2", [slots[0], ids.a])).rows[0].status, 'confirmed');
    assert.equal((await q("select count(*)::int n from public.notifications where recipient_id=$1 and kind='invitation' and title like 'قبل دعوتك إلى جلسة%'", [ids.mentor])).rows[0].n, 1);

    // الموعد المحجوز يُنهي الدعوات المعلقة الأخرى على الموعد نفسه.
    await asUser(ids.b, async () => {
      assert.equal((await q('select public.respond_tawasi_invitation($1,true) as r', [secondTawasi])).rows[0].r, 'unavailable');
    });
    assert.equal((await q('select status from public.tawasi_session_invitations where id=$1', [secondTawasi])).rows[0].status, 'expired');

    const cancelledTawasi = await tawasiInvite('carol_one', slots[1]);
    await asUser(ids.mentor, async () => { await q('select public.cancel_tawasi_slot_invitation($1)', [cancelledTawasi]); });
    await asUser(ids.c, async () => {
      await fails(q('select public.respond_tawasi_invitation($1,true)', [cancelledTawasi]), 'P0001');
    });

    const expiredTawasi = await tawasiInvite('dave_one', slots[2]);
    await q("update public.tawasi_session_invitations set expires_at=now()-interval '1 minute' where id=$1", [expiredTawasi]);
    await asUser(ids.d, async () => {
      assert.equal((await q('select public.respond_tawasi_invitation($1,true) as r', [expiredTawasi])).rows[0].r, 'expired');
    });
    assert.equal((await q('select status from public.tawasi_session_invitations where id=$1', [expiredTawasi])).rows[0].status, 'expired');

    await asUser(ids.mentor, async () => {
      const rows = (await q('select * from public.list_tawasi_slot_invitations()')).rows;
      assert.equal(rows.length, 4);
      assert.equal(rows.every(row => row.status !== 'pending' || row.invitee_username !== null), true);
    });

    // ---------- إدارة دعوات المدارسة ----------
    let circleId;
    await asUser(ids.a, async () => {
      circleId = (await q("select public.create_study_circle('Fiqh','book','fiqh','async','','','approval',null,null,null,'','') as id")).rows[0].id;
      await q('select public.invite_study_member($1,$2)', [circleId, 'bob_one']);
    });
    const studyInvite = (await q('select id from public.study_member_invites where circle_id=$1', [circleId])).rows[0].id;
    await asUser(ids.a, async () => {
      const rows = (await q('select * from public.list_study_circle_invites($1)', [circleId])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].invitee_username, 'bob_one');
      assert.equal(rows[0].status, 'pending');
    });
    await asUser(ids.b, async () => {
      await fails(q('select public.list_study_circle_invites($1)', [circleId]), '42501');
      await fails(q('select public.cancel_study_invite($1)', [studyInvite]), '42501');
    });
    await asUser(ids.a, async () => { await q('select public.cancel_study_invite($1)', [studyInvite]); });
    await asUser(ids.b, async () => {
      await fails(q('select public.respond_study_invite($1,true)', [studyInvite]), 'P0001');
    });

    // الحد اليومي للدعوات من إعدادات المشاركة نفسها لا من قيمة مضمّنة.
    await q('update public.share_settings set max_per_day=1 where id');
    await asUser(ids.mentor, async () => {
      await fails(q('select public.invite_tawasi_member($1,$2,$3)', [slots[3], 'alice_one', 'توجيه تربوي']), 'P0001');
    });
  } finally {
    await db.close();
  }
});
