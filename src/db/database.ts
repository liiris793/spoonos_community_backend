import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../config.js";

const databasePath = resolve(config.databasePath);
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      current_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, season_id),
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS task_versions (
      task_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      effective_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, season_id, version),
      FOREIGN KEY (task_id, season_id) REFERENCES tasks(id, season_id)
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_version INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      UNIQUE (season_id, task_id, user_id, status)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_version INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      proof_url TEXT,
      attachment_url TEXT,
      structured_data_json TEXT,
      status TEXT NOT NULL DEFAULT 'Submitted',
      ai_precheck_json TEXT,
      reviewer_id TEXT,
      review_note TEXT,
      quality_coefficient REAL,
      final_points INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS submissions_review_queue
      ON submissions(status, created_at);
    CREATE INDEX IF NOT EXISTS submissions_user
      ON submissions(season_id, user_id, created_at);

    CREATE TABLE IF NOT EXISTS point_ledger (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT,
      submission_id TEXT,
      base_points INTEGER NOT NULL,
      multiplier REAL NOT NULL DEFAULT 1,
      points INTEGER NOT NULL,
      reason TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (submission_id, reason)
    );

    CREATE INDEX IF NOT EXISTS point_ledger_user
      ON point_ledger(season_id, user_id, created_at);

    CREATE TABLE IF NOT EXISTS public_profiles (
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      is_test INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS review_batches (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      start_date_utc TEXT NOT NULL,
      end_date_utc TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      imported_at TEXT
    );

    CREATE TABLE IF NOT EXISTS review_batch_items (
      batch_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      initial_status TEXT NOT NULL,
      PRIMARY KEY (batch_id, submission_id),
      FOREIGN KEY (batch_id) REFERENCES review_batches(id),
      FOREIGN KEY (submission_id) REFERENCES submissions(id)
    );

    CREATE INDEX IF NOT EXISTS review_batch_items_submission
      ON review_batch_items(submission_id);

    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      submission_id TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      resolution TEXT,
      resolver_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_activity (
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      valid_messages INTEGER NOT NULL DEFAULT 0,
      awarded INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (season_id, user_id, activity_date)
    );

    CREATE TABLE IF NOT EXISTS activity_messages (
      message_id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL,
      reply_to_message_id TEXT,
      created_at_utc TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      rule_status TEXT NOT NULL DEFAULT 'Pending',
      rule_flags_json TEXT,
      ai_status TEXT,
      relevance_score INTEGER,
      quality_score INTEGER,
      ai_reason TEXT,
      counted INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS activity_messages_daily
      ON activity_messages(season_id, created_at_utc, user_id, channel_id);

    CREATE TABLE IF NOT EXISTS activity_daily_reviews (
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      candidate_messages INTEGER NOT NULL,
      rule_passed_messages INTEGER NOT NULL,
      ai_valid_messages INTEGER NOT NULL,
      suggested_points INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, user_id, activity_date),
      UNIQUE (submission_id),
      FOREIGN KEY (submission_id) REFERENCES submissions(id)
    );
  `);
}
