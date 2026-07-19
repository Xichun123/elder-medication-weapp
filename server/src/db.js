import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  openid TEXT NOT NULL UNIQUE,
  unionid TEXT,
  nickname TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'caregiver_edit', 'caregiver_view', 'elder')),
  elder_profile_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (home_id, user_id)
);

CREATE TABLE IF NOT EXISTS elder_profiles (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'female',
  age INTEGER NOT NULL DEFAULT 0,
  relationship TEXT NOT NULL DEFAULT '',
  allergy_note TEXT NOT NULL DEFAULT '无',
  voice_tone TEXT NOT NULL DEFAULT 'female_warm',
  linked_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('caregiver_edit', 'caregiver_view', 'elder')),
  elder_profile_id TEXT REFERENCES elder_profiles(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_by TEXT REFERENCES users(id),
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drugs (
  id TEXT PRIMARY KEY,
  home_id TEXT REFERENCES homes(id) ON DELETE CASCADE,
  generic_name TEXT NOT NULL,
  trade_name TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  ingredient TEXT NOT NULL DEFAULT '',
  dosage_text TEXT NOT NULL DEFAULT '',
  contraindication_note TEXT NOT NULL DEFAULT '',
  interaction_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medication_records (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  elder_profile_id TEXT NOT NULL REFERENCES elder_profiles(id) ON DELETE CASCADE,
  drug_id TEXT NOT NULL REFERENCES drugs(id),
  dose TEXT NOT NULL,
  frequency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_rules (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  elder_profile_id TEXT NOT NULL REFERENCES elder_profiles(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES medication_records(id) ON DELETE CASCADE,
  remind_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  voice_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contraindications (
  id TEXT PRIMARY KEY,
  home_id TEXT REFERENCES homes(id) ON DELETE CASCADE,
  drug_a_id TEXT NOT NULL REFERENCES drugs(id),
  drug_b_id TEXT REFERENCES drugs(id),
  drug_b_text TEXT NOT NULL DEFAULT '',
  contra_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_home ON memberships(home_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_elder_profile
  ON memberships(home_id, elder_profile_id)
  WHERE elder_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elders_home ON elder_profiles(home_id);
CREATE INDEX IF NOT EXISTS idx_records_home_elder ON medication_records(home_id, elder_profile_id);
CREATE INDEX IF NOT EXISTS idx_reminders_home_elder ON reminder_rules(home_id, elder_profile_id);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
`

let db

/**
 * 轻量包装，API 接近 better-sqlite3，便于业务代码书写。
 */
function wrap(database) {
  return {
    exec(sql) {
      database.exec(sql)
    },
    prepare(sql) {
      const stmt = database.prepare(sql)
      return {
        run(...params) {
          const result = stmt.run(...params)
          return {
            changes: Number(result.changes || 0),
            lastInsertRowid: result.lastInsertRowid,
          }
        },
        get(...params) {
          return stmt.get(...params)
        },
        all(...params) {
          return stmt.all(...params)
        },
      }
    },
    transaction(fn) {
      return (...args) => {
        database.exec('BEGIN')
        try {
          const result = fn(...args)
          database.exec('COMMIT')
          return result
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      }
    },
  }
}

export function getDb() {
  if (db) return db
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true })
  const raw = new DatabaseSync(config.databasePath)
  raw.exec('PRAGMA journal_mode = WAL;')
  raw.exec('PRAGMA foreign_keys = ON;')
  raw.exec(SCHEMA)
  db = wrap(raw)
  return db
}

export function nowIso() {
  return new Date().toISOString()
}

if (process.argv.includes('--init')) {
  getDb()
  console.log(`database ready: ${config.databasePath}`)
}
