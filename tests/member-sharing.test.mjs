import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

const ids = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
  admin: '44444444-4444-4444-8444-444444444444',
  teacher: '55555555-5555-4555-8555-555555555555'
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
  const course = (await db.query(`insert into public.courses(teacher_id,kind,title,status,starts_at)
    values($1,'lesson','Open lesson','published', now() + interval '3 days') returning id`, [ids.teacher])).rows[0].id;
  const asUser = async (id, fn) => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const q = (sql, params) => db.query(sql, params);
  const fails = async (promise, code) => {
    await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; });
  };
  return {db, q, asUser, fails, course};
}

const send = (q, to, type, kind, key = '', desc = '', tpl = '') =>
  q('select public.send_member_share($1,$2,$3,$4,$5,$6,$7,$8) as id', [randomUUID(), to, type, kind, key, desc, tpl, '']);

test('member sharing: profiles, search, sending, privacy, limits, invitations, blocks, reports, admin', async () => {
  const {db, q, asUser, fails, course} = await setup();
  try {
    // username validation and uniqueness
    await asUser(ids.a, async () => {
      await q('select public.save_my_share_profile($1,$2,$3)', ['Alice_1', 'Alice', true]);
      assert.equal((await q('select * from public.get_my_share_profile()')).rows[0].username, 'alice_1');
      await fails(q('select public.save_my_share_profile($1,$2,$3)', ['1bad', 'x', true]), '22023');
      await fails(q('select public.save_my_share_profile($1,$2,$3)', ['admin', 'x', true]), '22023');
    });
    await asUser(ids.b, async () => {
      await fails(q('select public.save_my_share_profile($1,$2,$3)', ['alice_1', 'Bob', true]), 'P0001');
      await q('select public.save_my_share_profile($1,$2,$3)', ['bob_1', 'Bob', true]);
      assert.equal((await q('select public.check_username_available($1) as ok', ['alice_1'])).rows[0].ok, false);
    });
    await asUser(ids.c, async () => {
      await q('select public.save_my_share_profile($1,$2,$3)', ['carol_hidden', 'Carol', false]);
    });

    // search: prefix only, min 3 chars, discoverable only, no ids/emails exposed
    await asUser(ids.a, async () => {
      assert.equal((await q('select * from public.search_share_members($1)', ['bo'])).rows.length, 0);
      const r = (await q('select * from public.search_share_members($1)', ['bob'])).rows;
      assert.deepEqual(Object.keys(r[0]).sort(), ['display_name', 'username']);
      assert.equal((await q('select * from public.search_share_members($1)', ['carol'])).rows.length, 0);
    });

    // direct table access is denied; admin cannot read shares through tables either
    await asUser(ids.a, async () => {
      await fails(q('select * from public.member_shares'), '42501');
      await fails(q('select * from public.member_share_profiles'), '42501');
      await fails(q('insert into public.member_shares(request_key,sender_id,recipient_id,share_type,ref_kind,ref_title) values (gen_random_uuid(),$1,$2,\'resource\',\'url\',\'x\')', [ids.a, ids.b]), '42501');
    });

    // sending: valid recipient, invalid recipient generic error, self, hidden
    let urlShare;
    await asUser(ids.a, async () => {
      urlShare = (await send(q, 'bob_1', 'resource', 'url', 'https://example.com/book', 'Useful')).rows[0].id;
      await fails(send(q, 'nobody', 'resource', 'url', 'https://example.com/x'), 'P0001');
      await fails(send(q, 'carol_hidden', 'resource', 'url', 'https://example.com/x'), 'P0001');
      await fails(send(q, 'alice_1', 'resource', 'url', 'https://example.com/x'), 'P0001');
    });

    // unsafe URLs and descriptions
    await asUser(ids.a, async () => {
      for (const bad of ['javascript:alert(1)', 'http://localhost/x', 'http://127.0.0.1/x', 'https://user:pw@example.com/', 'ftp://example.com/x', 'https://example.com/<script>', 'https://printer.local/x']) {
        await fails(send(q, 'bob_1', 'resource', 'url', bad), '22023');
      }
      await fails(send(q, 'bob_1', 'resource', 'url', 'https://example.org/ok', 'see https://evil.example'), '22023');
      await fails(send(q, 'bob_1', 'resource', 'url', 'https://example.org/ok', 'x'.repeat(281)), '22023');
    });

    // recipient isolation, read state, notification delivery without content
    await asUser(ids.b, async () => {
      assert.equal((await q('select public.unread_share_count() as n')).rows[0].n, 1);
      const inbox = (await q('select * from public.list_received_shares()')).rows;
      assert.equal(inbox.length, 1);
      assert.equal(inbox[0].sender_username, 'alice_1');
      assert.ok(!('sender_id' in inbox[0]) && !('recipient_id' in inbox[0]));
      assert.equal((await q('select * from public.list_sent_shares()')).rows.length, 0);
      const note = (await q('select * from public.list_notifications($1)', [10])).rows[0];
      assert.equal(note.notification_kind, 'share');
      await q('select public.mark_share_read($1)', [urlShare]);
      assert.equal((await q('select public.unread_share_count() as n')).rows[0].n, 0);
    });
    await asUser(ids.c, async () => {
      assert.equal((await q('select * from public.list_received_shares()')).rows.length, 0);
      await q('select public.mark_share_read($1)', [urlShare]);
      await fails(q('select public.archive_share($1)', [urlShare]), 'P0001');
    });
    await asUser(ids.a, async () => {
      assert.equal((await q('select * from public.list_sent_shares()')).rows.length, 1);
    });

    // duplicate submission: same request key is idempotent; same content blocked
    await asUser(ids.a, async () => {
      const key = randomUUID();
      const first = (await q('select public.send_member_share($1,$2,$3,$4,$5,$6,$7,$8) as id', [key, 'bob_1', 'resource', 'url', 'https://example.org/dup', '', '', ''])).rows[0].id;
      const again = (await q('select public.send_member_share($1,$2,$3,$4,$5,$6,$7,$8) as id', [key, 'bob_1', 'resource', 'url', 'https://example.org/dup', '', '', ''])).rows[0].id;
      assert.equal(first, again);
      await fails(send(q, 'bob_1', 'resource', 'url', 'https://example.org/dup'), 'P0001');
    });

    // per-recipient limit (3 per 24h; two already sent)
    await asUser(ids.a, async () => {
      await send(q, 'bob_1', 'resource', 'url', 'https://example.org/three');
      await fails(send(q, 'bob_1', 'resource', 'url', 'https://example.org/four'), 'P0001');
    });

    await q('update public.share_settings set max_per_recipient = 50');

    // archive and sender hide are per side
    await asUser(ids.b, async () => {
      await q('select public.archive_share($1)', [urlShare]);
      assert.equal((await q('select * from public.list_received_shares(false)')).rows.length, 2);
      assert.equal((await q('select * from public.list_received_shares(true)')).rows.length, 1);
    });
    await asUser(ids.a, async () => {
      await q('select public.hide_sent_share($1)', [urlShare]);
    });
    assert.equal((await q('select count(*)::int as n from public.member_shares where id=$1', [urlShare])).rows[0].n, 1);

    // activity invitation: accept registers; decline; double response; expiry
    let invite;
    await asUser(ids.a, async () => {
      await q('select public.save_my_share_profile($1,$2,$3)', ['alice_1', 'Alice', true]);
      await fails(send(q, 'bob_1', 'activity_invitation', 'url', 'https://example.org/x'), '22023');
      invite = (await send(q, 'bob_1', 'activity_invitation', 'course', course)).rows[0].id;
    });
    await asUser(ids.c, async () => {
      await fails(q('select public.respond_share_invitation($1,true)', [invite]), 'P0001');
    });
    await asUser(ids.b, async () => {
      assert.equal((await q('select public.respond_share_invitation($1,true) as s', [invite])).rows[0].s, 'accepted');
      await fails(q('select public.respond_share_invitation($1,true)', [invite]), 'P0001');
    });
    assert.equal((await q(`select status from public.course_registrations where course_id=$1 and user_id=$2`, [course, ids.b])).rows[0].status, 'registered');
    await asUser(ids.a, async () => {
      const notes = (await q('select * from public.list_notifications($1)', [10])).rows;
      assert.ok(notes.some(n => n.notification_kind === 'share'));
    });
    await q(`insert into public.member_shares(request_key,sender_id,recipient_id,share_type,ref_kind,ref_key,ref_title,expires_at)
      values (gen_random_uuid(),$1,$2,'activity_invitation','course',$3,'Open lesson', now() - interval '1 hour')`, [ids.a, ids.b, course]);
    await asUser(ids.b, async () => {
      const expired = (await q('select * from public.list_received_shares() where share_status=\'expired\'')).rows[0];
      await fails(q('select public.respond_share_invitation($1,true)', [expired.share_id]), 'P0001');
    });

    // predefined notification only between co-participants of the same activity
    await asUser(ids.a, async () => {
      await fails(send(q, 'bob_1', 'notification', 'course', course, '', 'session_reminder'), '42501');
      await fails(send(q, 'bob_1', 'notification', 'course', course, 'free text', 'session_reminder'), '22023');
    });

    // block + report
    await asUser(ids.b, async () => {
      const first = (await q('select * from public.list_received_shares(false)')).rows[0];
      const reportId = (await q('select public.report_share($1,$2,$3) as id', [first.share_id, 'spam', 'x'])).rows[0].id;
      assert.match(reportId, /^[0-9a-f-]{36}$/);
      await fails(q('select public.report_share($1,$2,$3)', [first.share_id, 'spam', 'x']), 'P0001');
      await fails(q('select public.report_share($1,$2,$3)', [first.share_id, 'bogus', '']), '22023');
      await q('select public.block_share_sender($1)', [first.share_id]);
      assert.equal((await q('select * from public.list_my_blocks()')).rows[0].username, 'alice_1');
    });
    await asUser(ids.a, async () => {
      await fails(send(q, 'bob_1', 'resource', 'url', 'https://example.org/after-block'), 'P0001');
      assert.equal((await q('select * from public.search_share_members($1)', ['bob'])).rows.length, 0);
    });
    await asUser(ids.b, async () => {
      await q('select public.unblock_member($1)', ['alice_1']);
    });

    // admin: non-admins rejected, settings, restriction, review, stats, audit
    await asUser(ids.a, async () => {
      await fails(q('select public.admin_save_share_settings(20,3,24,280,30,14,180,array[\'resource\'])'), '42501');
      await fails(q('select public.admin_set_share_restriction($1,true,1,\'\')', ['bob_1']), '42501');
      assert.equal((await q('select * from public.admin_get_share_settings()')).rows.length, 0);
      assert.equal((await q('select * from public.admin_share_stats()')).rows.length, 0);
    });
    await asUser(ids.admin, async () => {
      await q('select public.admin_save_share_settings(20,3,24,280,30,14,180,array[\'resource\',\'activity_invitation\',\'notification\'])');
      await fails(q('select public.admin_save_share_settings(0,3,24,280,30,14,180,array[\'resource\'])'), '22023');
      const reportId = (await q(`select id from public.reports where target_type='share'`)).rows[0].id;
      const content = (await q('select * from public.admin_review_reported_share($1)', [reportId])).rows[0];
      assert.equal(content.sender_username, 'alice_1');
      assert.equal((await q('select * from public.admin_share_stats()')).rows[0].open_reports > 0, true);
      await q('select public.admin_set_share_restriction($1,true,24,$2)', ['alice_1', 'spam']);
      const events = (await q('select * from public.admin_list_share_events(20)')).rows.map(e => e.event);
      assert.ok(events.includes('settings_changed') && events.includes('report_content_viewed') && events.includes('restricted'));
    });
    await asUser(ids.a, async () => {
      await fails(send(q, 'bob_1', 'resource', 'url', 'https://example.org/restricted'), '42501');
    });
    await asUser(ids.admin, async () => {
      await q('select public.admin_set_share_restriction($1,false,null,\'\')', ['alice_1']);
    });
    await asUser(ids.a, async () => {
      await fails(send(q, 'bob_1', 'recommendation', 'resource', 'main'), '22023');
    });
  } finally {
    await db.close();
  }
});
