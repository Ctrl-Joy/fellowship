import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

export interface MigratableModule {
  name: string;
  migrations: string[];
}

/** Open (and create) the SQLite database with WAL + foreign keys enabled. */
export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    module TEXT NOT NULL,
    idx INTEGER NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (module, idx)
  );`);
  return db;
}

/** Run each module's migrations (in module order), each SQL string exactly once. */
export function runMigrations(db: Db, modules: MigratableModule[]): void {
  const applied = db.prepare('SELECT 1 FROM _migrations WHERE module = ? AND idx = ?');
  const record = db.prepare('INSERT INTO _migrations (module, idx, applied_at) VALUES (?, ?, ?)');
  for (const mod of modules) {
    mod.migrations.forEach((sql, idx) => {
      if (applied.get(mod.name, idx)) return;
      tx(db, () => {
        db.exec(sql);
        record.run(mod.name, idx, Date.now());
      });
    });
  }
}

/** Run fn inside a transaction (nested calls join the outer transaction). */
let depth = 0;
export function tx<T>(db: Db, fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}
