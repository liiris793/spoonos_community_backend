// Seed fake submissions for testing the /mysubmissions and /mysubmission commands.
//
// Usage:
//   node scripts/seed-fake-submissions.mjs --user <discordId> [--count 12]
//   node scripts/seed-fake-submissions.mjs --user <discordId> --clear
//
// All seeded rows use the id prefix "SUBSEED-" so they never collide with real
// submissions and can be removed with --clear. This script only writes to the
// `submissions` table (no point_ledger rows are created), so no points are
// awarded — but Approved rows DO count toward a user's per-task submission
// limits in the real code path. Use a throwaway/test Discord ID to be safe.
import "dotenv/config";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const dbPath =
  process.env.DATABASE_PATH || "./data/community-e2e-test.db";
const db = new Database(resolve(dbPath));
db.pragma("journal_mode = WAL");

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const clearFlag = args.includes("--clear");
const userId = arg("--user");
const count = Number(arg("--count") || 12);

if (!userId && !clearFlag) {
  console.error(
    "Usage: node scripts/seed-fake-submissions.mjs --user <discordId> [--count 12] [--clear]"
  );
  process.exit(1);
}

const SEASON = process.env.DEFAULT_SEASON_ID || "season-2";
const REVIEWER = "200000000000000001"; // fake reviewer id
const ID_PREFIX = "SUBSEED-";

// ---- helpers ---------------------------------------------------------------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function newSeedId() {
  return ID_PREFIX + randomBytes(4).toString("hex").toUpperCase();
}

function basePointsFor(taskId) {
  const row = db
    .prepare(
      `SELECT config_json FROM task_versions
       WHERE task_id = ? AND season_id = ?
       ORDER BY version DESC LIMIT 1`
    )
    .get(taskId, SEASON);
  if (!row) return 30;
  try {
    const cfg = JSON.parse(row.config_json);
    return cfg.basePoints ?? 30;
  } catch {
    return 30;
  }
}

function isoDaysAgo(daysAgo, idx) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  // stagger hours so ordering is deterministic within a day
  d.setUTCHours((idx * 2) % 24, (idx * 7) % 60, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

// ---- clear -----------------------------------------------------------------
if (clearFlag && userId) {
  const info = db
    .prepare(`DELETE FROM submissions WHERE id LIKE ? AND user_id = ?`)
    .run(`${ID_PREFIX}%`, userId);
  console.log(`Cleared ${info.changes} seeded submission(s) for user ${userId}.`);
  process.exit(0);
}

// ---- clear previous seeds for this user (idempotent re-run) ---------------
db.prepare(`DELETE FROM submissions WHERE id LIKE ? AND user_id = ?`).run(
  `${ID_PREFIX}%`,
  userId
);

// ---- build 12 varied fake submissions -------------------------------------
const tasks = [
  "T001", "T002", "T003", "T005", "T008", "T012",
  "T015", "T018", "T020", "T023", "T100", "T004"
];

// status blueprints: 3 approved, 2 revision, 2 rejected, 2 under_review,
// 2 prechecked, 1 submitted  => 12
const blueprints = [
  { status: "Approved", coef: 1.5 },
  { status: "Approved", coef: 1.25 },
  { status: "Approved", coef: 1 },
  { status: "RevisionRequired", note: "Please add screenshots showing the final result against the acceptance criteria." },
  { status: "RevisionRequired", note: "Summary is too short; describe the steps you took." },
  { status: "Rejected", note: "Submission does not meet the task requirements." },
  { status: "Rejected", note: "Evidence link is inaccessible / expired." },
  { status: "UnderReview" },
  { status: "UnderReview" },
  { status: "Prechecked", score: 82 },
  { status: "Prechecked", score: 64 },
  { status: "Submitted" }
];

const summaries = [
  "Completed the daily check-in and shared a short progress note in the community channel.",
  "Wrote a tutorial covering the setup steps and common pitfalls, published to the docs site.",
  "Fixed three reported bugs and opened a pull request with tests.",
  "Recorded a 5-minute demo video walking through the feature end to end.",
  "Translated the onboarding guide into Chinese and submitted the PR.",
  "Answered five questions in the help channel and marked them resolved.",
  "Designed a pixel-art banner for the season launch and attached the source.",
  "Ran the local benchmark and posted the comparison table with before/after numbers.",
  "Organized a community call, took notes, and uploaded the recording.",
  "Built a small reusable component and documented its props.",
  "Reviewed three peer submissions and left constructive feedback.",
  "Set up the CI pipeline and verified it passes on the main branch."
];

const proofUrls = [
  "https://example.com/evidence/001",
  "https://example.com/evidence/002",
  null,
  "https://example.com/evidence/004",
  null,
  "https://example.com/evidence/006"
];

const insert = db.prepare(
  `INSERT INTO submissions
    (id, season_id, task_id, task_version, user_id, summary,
     proof_url, attachment_url, structured_data_json, status,
     ai_precheck_json, reviewer_id, review_note,
     quality_coefficient, final_points, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const created = [];
db.transaction(() => {
  for (let i = 0; i < count; i++) {
    const bp = blueprints[i % blueprints.length];
    const taskId = tasks[i % tasks.length];
    const createdAt = isoDaysAgo(count - 1 - i, i); // newest first
    const id = newSeedId();
    let qualityCoefficient = null;
    let finalPoints = null;
    let reviewerId = null;
    let reviewNote = null;
    let aiPrecheckJson = null;

    if (bp.status === "Approved") {
      const base = basePointsFor(taskId);
      qualityCoefficient = bp.coef;
      finalPoints = Math.round(base * bp.coef);
      reviewerId = REVIEWER;
      reviewNote = "Approved after quick review.";
    } else if (bp.status === "RevisionRequired" || bp.status === "Rejected") {
      reviewerId = REVIEWER;
      reviewNote = bp.note;
    } else if (bp.status === "Prechecked") {
      const ai = {
        pluginId: "rule_based_precheck",
        score: bp.score,
        recommendation: bp.score >= 70 ? "pass" : "review",
        flags: [],
        missingItems: [],
        reviewQuestions: [],
        raw: []
      };
      aiPrecheckJson = JSON.stringify(ai);
    }

    insert.run(
      id,
      SEASON,
      taskId,
      1,
      userId,
      summaries[i % summaries.length],
      proofUrls[i % proofUrls.length],
      null,
      null,
      bp.status,
      aiPrecheckJson,
      reviewerId,
      reviewNote,
      qualityCoefficient,
      finalPoints,
      createdAt,
      createdAt
    );
    created.push({
      id,
      taskId,
      status: bp.status,
      points: finalPoints ?? "—",
      createdAt
    });
  }
})();

console.log(`Seeded ${created.length} fake submission(s) for user ${userId} in ${dbPath}`);
console.log("");
console.log("ID".padEnd(16), "TASK".padEnd(6), "STATUS".padEnd(16), "POINTS".padEnd(7), "CREATED_AT");
for (const r of created) {
  console.log(
    r.id.padEnd(16),
    r.taskId.padEnd(6),
    r.status.padEnd(16),
    String(r.points).padEnd(7),
    r.createdAt
  );
}
console.log("");
console.log("Try in Discord:");
console.log(`  /mysubmissions`);
console.log(`  /mysubmission id:${created[0].id}`);
