// openStore() on a temp data dir: what it says when home.db can't be used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DataDirError, openStore } from '../store.js';
import { tempDir } from './helpers.js';

const canWriteAnything = process.getuid && process.getuid() === 0;

function opening(dir) {
  try {
    openStore(dir).close();
  } catch (e) {
    return e;
  }
  assert.fail('openStore did not throw');
}

test('a home.db that is not a database fails naming the file, not permissions', () => {
  const t = tempDir({ 'data/home.db': 'not sqlite at all '.repeat(100) });
  try {
    const e = opening(t.path('data'));
    assert.ok(e instanceof DataDirError);
    assert.match(e.message, new RegExp(`^cannot open ${t.path('data/home.db')}: file is not a database`));
    assert.doesNotMatch(e.message, /chown|not writable/);
  } finally { t.cleanup(); }
});

test('a home.db locked by another process fails naming the file, not permissions', () => {
  const t = tempDir();
  mkdirSync(t.path('data'));
  const other = new DatabaseSync(t.path('data/home.db'));
  other.exec('CREATE TABLE t (x); BEGIN EXCLUSIVE; INSERT INTO t VALUES (1);');
  try {
    const e = opening(t.path('data'));
    assert.ok(e instanceof DataDirError);
    assert.match(e.message, new RegExp(`^cannot open ${t.path('data/home.db')}: database is locked`));
    assert.doesNotMatch(e.message, /chown|not writable/);
  } finally {
    other.exec('ROLLBACK');
    other.close();
    t.cleanup();
  }
});

test('a home.db the server may not open is reported as not writable', { skip: canWriteAnything && 'root can write anywhere' }, () => {
  const t = tempDir();
  mkdirSync(t.path('data'));
  openStore(t.path('data')).close();
  chmodSync(t.path('data/home.db'), 0o000);
  try {
    const e = opening(t.path('data'));
    assert.ok(e instanceof DataDirError);
    assert.match(e.message, /is not writable by uid \d+ .*chown/);
  } finally { t.cleanup(); }
});
