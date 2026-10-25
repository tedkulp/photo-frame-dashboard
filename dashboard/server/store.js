// The home server's own state: one SQLite file, home.db, in a writable data dir (ADR 0001).
// openStore() creates the dir if needed, checks it can be written, and brings the schema up to
// date. A dir that can't be created or written throws a DataDirError naming the fix, so the
// server never starts without somewhere to save; a home.db that is corrupt or locked throws a
// DataDirError naming the file instead.
import { accessSync, constants, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class DataDirError extends Error {}

// Each entry moves the schema up one version (PRAGMA user_version). Add new tables (shopping, …)
// as new entries at the end; never edit one that has shipped.
const MIGRATIONS = [
  // 1: chores. Title and emoji are overwritten; owner, days and deletion are versions
  // that apply from their date until the next one (ADR 0002). Done is (chore, date).
  `CREATE TABLE chores (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     emoji TEXT NOT NULL,
     routine TEXT NOT NULL
   );
   CREATE TABLE chore_versions (
     chore_id INTEGER NOT NULL REFERENCES chores(id),
     date TEXT NOT NULL,
     owner TEXT NOT NULL,
     days TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (chore_id, date)
   );
   CREATE TABLE chore_done (
     chore_id INTEGER NOT NULL REFERENCES chores(id),
     date TEXT NOT NULL,
     PRIMARY KEY (chore_id, date)
   );`,
  // 2: chores are for the whole day: drop the routine (Morning/Evening) each one sat in.
  `ALTER TABLE chores DROP COLUMN routine;`,
];

function notWritable(dir, why) {
  const uid = process.getuid ? process.getuid() : '?';
  const gid = process.getgid ? process.getgid() : '?';
  return new DataDirError(`data dir ${dir} is not writable by uid ${uid} (${why}): run \`chown ${uid}:${gid}\` on it (with Docker, \`chown ${uid}:${gid} ./data\` next to compose.yaml)`);
}

function checkDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw notWritable(dir, e.code || e.message);
  }
  if (!statSync(dir).isDirectory()) throw new DataDirError(`data dir ${dir} is not a directory`);
  try {
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch (e) {
    throw notWritable(dir, e.code || e.message);
  }
}

// SQLITE_PERM, SQLITE_READONLY, SQLITE_CANTOPEN: the file or dir can't be opened or written.
// Anything else (not a database, locked, …) is about the file itself, not ownership.
const PERMISSION_CODES = [3, 8, 14];
function isPermission(e) {
  if (typeof e.errcode === 'number') return PERMISSION_CODES.includes(e.errcode & 0xff);
  return /readonly|unable to open|permission/i.test(e.message);
}

export function openStore(dir) {
  checkDir(dir);
  const file = join(dir, 'home.db');
  let db;
  try {
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  } catch (e) {
    if (db) db.close();
    throw isPermission(e) ? notWritable(dir, e.message) : new DataDirError(`cannot open ${file}: ${e.message}`);
  }
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > MIGRATIONS.length) {
    db.close();
    throw new DataDirError(`${file} has schema version ${version}, newer than this server knows (${MIGRATIONS.length}); run a newer server`);
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      db.close();
      throw e;
    }
  }
  return { db, close: () => db.close() };
}
