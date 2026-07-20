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
  primary_package_image_url TEXT NOT NULL DEFAULT '',
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
  status_date TEXT,
  voice_text TEXT NOT NULL DEFAULT '',
  voice_generated_on TEXT NOT NULL DEFAULT '',
  voice_generation_source TEXT NOT NULL DEFAULT 'template',
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

CREATE TABLE IF NOT EXISTS ai_pending_actions (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  elder_profile_id TEXT NOT NULL REFERENCES elder_profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('mark_taken', 'record_symptom')),
  reminder_id TEXT REFERENCES reminder_rules(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medication_events (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  elder_profile_id TEXT NOT NULL REFERENCES elder_profiles(id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  drug_id TEXT,
  drug_name_snapshot TEXT NOT NULL DEFAULT '',
  dose_snapshot TEXT NOT NULL DEFAULT '',
  remind_time_snapshot TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('taken', 'skipped')),
  occurrence_date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  pending_action_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (reminder_id, occurrence_date)
);

CREATE TABLE IF NOT EXISTS ai_action_audits (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES ai_pending_actions(id) ON DELETE CASCADE,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS symptom_logs (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  elder_profile_id TEXT NOT NULL REFERENCES elder_profiles(id) ON DELETE CASCADE,
  symptom TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'ai_voice',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_alerts (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  elder_profile_id TEXT NOT NULL REFERENCES elder_profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  content TEXT NOT NULL,
  read_at TEXT,
  read_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_home ON memberships(home_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_elder_profile
  ON memberships(home_id, elder_profile_id)
  WHERE elder_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elders_home ON elder_profiles(home_id);
CREATE INDEX IF NOT EXISTS idx_records_home_elder ON medication_records(home_id, elder_profile_id);
CREATE INDEX IF NOT EXISTS idx_reminders_home_elder ON reminder_rules(home_id, elder_profile_id);
CREATE INDEX IF NOT EXISTS idx_medication_events_home_date ON medication_events(home_id, occurrence_date);
CREATE INDEX IF NOT EXISTS idx_pending_actions_user_status ON ai_pending_actions(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_action_audits_action ON ai_action_audits(action_id, created_at);
CREATE INDEX IF NOT EXISTS idx_symptoms_home_elder ON symptom_logs(home_id, elder_profile_id);
CREATE INDEX IF NOT EXISTS idx_alerts_home ON care_alerts(home_id, read_at, created_at);
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
  migrateSchema(db)
  seedSystemCatalog(db)
  return db
}

export function nowIso() {
  return new Date().toISOString()
}

function migrateSchema(database) {
  const reminderColumns = database.prepare('PRAGMA table_info(reminder_rules)').all()
  if (!reminderColumns.some((column) => column.name === 'status_date')) {
    database.exec('ALTER TABLE reminder_rules ADD COLUMN status_date TEXT')
  }
  if (!reminderColumns.some((column) => column.name === 'voice_generated_on')) {
    database.exec("ALTER TABLE reminder_rules ADD COLUMN voice_generated_on TEXT NOT NULL DEFAULT ''")
  }
  if (!reminderColumns.some((column) => column.name === 'voice_generation_source')) {
    database.exec("ALTER TABLE reminder_rules ADD COLUMN voice_generation_source TEXT NOT NULL DEFAULT 'template'")
  }

  const drugColumns = database.prepare('PRAGMA table_info(drugs)').all()
  if (!drugColumns.some((column) => column.name === 'primary_package_image_url')) {
    database.exec("ALTER TABLE drugs ADD COLUMN primary_package_image_url TEXT NOT NULL DEFAULT ''")
  }

  const alertColumns = database.prepare('PRAGMA table_info(care_alerts)').all()
  if (!alertColumns.some((column) => column.name === 'severity')) {
    database.exec("ALTER TABLE care_alerts ADD COLUMN severity TEXT NOT NULL DEFAULT 'normal'")
  }
  if (!alertColumns.some((column) => column.name === 'read_by')) {
    database.exec('ALTER TABLE care_alerts ADD COLUMN read_by TEXT REFERENCES users(id)')
  }

  migrateMedicationEvents(database)

  // 旧版本仅保存规则的最后一次状态；迁移为一条明确标记为 legacy_snapshot 的历史事件。
  database.exec(`
    INSERT OR IGNORE INTO medication_events (
      id, home_id, elder_profile_id, reminder_id, record_id, drug_id,
      drug_name_snapshot, dose_snapshot, remind_time_snapshot, actor_user_id,
      event_type, occurrence_date, occurred_at, source, pending_action_id, created_at
    )
    SELECT
      'EVLEGACY_' || rm.id || '_' || REPLACE(rm.status_date, '-', ''),
      rm.home_id, rm.elder_profile_id, rm.id, rm.record_id, r.drug_id,
      d.generic_name, r.dose, rm.remind_time, NULL,
      rm.status, rm.status_date, rm.updated_at, 'legacy_snapshot', NULL, rm.updated_at
    FROM reminder_rules rm
    JOIN medication_records r ON r.id = rm.record_id
    JOIN drugs d ON d.id = r.drug_id
    WHERE rm.status_date IS NOT NULL AND rm.status IN ('taken', 'skipped')
  `)
}

function migrateMedicationEvents(database) {
  const columns = database.prepare('PRAGMA table_info(medication_events)').all()
  const foreignKeys = database.prepare('PRAGMA foreign_key_list(medication_events)').all()
  const hasSnapshots = ['drug_id', 'drug_name_snapshot', 'dose_snapshot', 'remind_time_snapshot']
    .every((name) => columns.some((column) => column.name === name))
  const hasMutableParentCascade = foreignKeys.some((key) => ['reminder_id', 'record_id', 'pending_action_id'].includes(key.from))
  if (hasSnapshots && !hasMutableParentCascade) return

  const hasColumn = (name) => columns.some((column) => column.name === name)
  const drugId = hasColumn('drug_id') ? 'me.drug_id' : 'r.drug_id'
  const drugName = hasColumn('drug_name_snapshot') ? 'me.drug_name_snapshot' : "COALESCE(d.generic_name, '')"
  const dose = hasColumn('dose_snapshot') ? 'me.dose_snapshot' : "COALESCE(r.dose, '')"
  const remindTime = hasColumn('remind_time_snapshot') ? 'me.remind_time_snapshot' : "COALESCE(rm.remind_time, '')"

  database.exec(`
    ALTER TABLE medication_events RENAME TO medication_events_legacy;
    CREATE TABLE medication_events (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
      elder_profile_id TEXT NOT NULL REFERENCES elder_profiles(id) ON DELETE CASCADE,
      reminder_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      drug_id TEXT,
      drug_name_snapshot TEXT NOT NULL DEFAULT '',
      dose_snapshot TEXT NOT NULL DEFAULT '',
      remind_time_snapshot TEXT NOT NULL DEFAULT '',
      actor_user_id TEXT REFERENCES users(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('taken', 'skipped')),
      occurrence_date TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      pending_action_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (reminder_id, occurrence_date)
    );
    INSERT INTO medication_events (
      id, home_id, elder_profile_id, reminder_id, record_id, drug_id,
      drug_name_snapshot, dose_snapshot, remind_time_snapshot, actor_user_id,
      event_type, occurrence_date, occurred_at, source, pending_action_id, created_at
    )
    SELECT
      me.id, me.home_id, me.elder_profile_id, me.reminder_id, me.record_id, ${drugId},
      ${drugName}, ${dose}, ${remindTime}, me.actor_user_id,
      me.event_type, me.occurrence_date, me.occurred_at, me.source, me.pending_action_id, me.created_at
    FROM medication_events_legacy me
    LEFT JOIN reminder_rules rm ON rm.id = me.reminder_id
    LEFT JOIN medication_records r ON r.id = me.record_id
    LEFT JOIN drugs d ON d.id = r.drug_id;
    DROP TABLE medication_events_legacy;
    CREATE INDEX IF NOT EXISTS idx_medication_events_home_date ON medication_events(home_id, occurrence_date);
  `)
}

/** 系统药库与常见禁忌，仅在空库时写入一次。 */
function seedSystemCatalog(database) {
  const existing = database.prepare('SELECT COUNT(*) AS c FROM drugs WHERE home_id IS NULL').get()
  if (Number(existing.c) > 0) return

  const ts = nowIso()
  const drugs = [
    ['Dsys01', '阿莫西林', '阿莫仙', '羟氨苄青霉素', 'antibiotic', '阿莫西林', '0.5g', '青霉素过敏者禁用', '避免与活菌制剂同服'],
    ['Dsys02', '硝苯地平', '心痛定', '硝苯吡啶', 'antihypertensive', '硝苯地平', '10mg', '严重主动脉瓣狭窄禁用', '避免与西柚同服'],
    ['Dsys03', '二甲双胍', '格华止', '', 'hypoglycemic', '二甲双胍', '0.5g', '严重肾功能不全禁用', '避免饮酒'],
    ['Dsys04', '阿司匹林', '拜阿司匹灵', '乙酰水杨酸', 'antiplatelet', '阿司匹林', '100mg', '活动性消化道溃疡禁用', '避免与布洛芬同服'],
    ['Dsys05', '头孢克肟', '世福素', '', 'antibiotic', '头孢克肟', '0.1g', '头孢类过敏者禁用', '用药及停药7天内禁酒'],
  ]
  const insertDrug = database.prepare(`
    INSERT INTO drugs (
      id, home_id, generic_name, trade_name, aliases, category, ingredient,
      dosage_text, contraindication_note, interaction_note, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  drugs.forEach((item) => insertDrug.run(...item, ts, ts))

  const contras = [
    ['Csys01', 'Dsys04', null, '布洛芬', 'co_administration', 'severe', '增加消化道出血风险'],
    ['Csys02', 'Dsys02', null, '西柚', 'diet', 'middle', '西柚升高血药浓度致低血压'],
    ['Csys03', 'Dsys03', null, '酒精', 'diet', 'severe', '乳酸酸中毒风险'],
    ['Csys04', 'Dsys05', null, '酒精', 'diet', 'severe', '双硫仑样反应'],
    ['Csys05', 'Dsys01', null, '活菌制剂', 'co_administration', 'light', '抗菌药灭活益生菌'],
  ]
  const insertContra = database.prepare(`
    INSERT INTO contraindications (
      id, home_id, drug_a_id, drug_b_id, drug_b_text, contra_type, severity, note, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  contras.forEach((item) => insertContra.run(...item, ts, ts))
}

if (process.argv.includes('--init')) {
  getDb()
  console.log(`database ready: ${config.databasePath}`)
}
