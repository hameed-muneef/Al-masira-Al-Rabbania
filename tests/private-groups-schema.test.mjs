import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('private group RLS hides groups and prevents role changes', async () => {
  const db = new PGlite();
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const founder = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const outsider = '33333333-3333-4333-8333-333333333333';
  const group = '44444444-4444-4444-8444-444444444444';
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
      alter table storage.objects enable row level security;`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');
    await db.exec(`insert into auth.users(id) values ('${founder}'), ('${member}'), ('${outsider}');
      insert into public.study_groups(id, founder_id, name, kind) values ('${group}', '${founder}', 'حلقة خاصة', 'friends');
      insert into public.group_members(group_id,user_id,role) values
        ('${group}','${founder}','founder'), ('${group}','${member}','member');`);

    for (const id of [founder, member]) await asUser(id, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n, 1);
      assert.equal((await db.query('select count(*)::int as n from public.group_members')).rows[0].n, 2);
    });
    await asUser(outsider, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int as n from public.group_members')).rows[0].n, 0);
      await assert.rejects(db.query(`insert into public.group_members(group_id,user_id,role) values ('${group}','${outsider}','founder')`), e => e.code === '42501');
    });
    await asUser(member, async () => {
      await assert.rejects(db.query(`update public.group_members set role='founder' where group_id='${group}' and user_id='${member}'`), e => e.code === '42501');
      await assert.rejects(db.query(`update public.study_groups set name='معدلة' where id='${group}'`), e => e.code === '42501');
    });
    await db.exec(`delete from public.group_members where group_id='${group}' and user_id='${member}'`);
    await asUser(member, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n, 0);
    });
  } finally { await db.close(); }
});
