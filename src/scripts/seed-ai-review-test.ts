import { db, migrate } from "../db/database.js";

type TestSubmission = {
  id: string;
  taskId: string;
  userId: string;
  summary: string;
  proofUrl?: string;
  structuredData?: Record<string, unknown>;
  createdAt: string;
};

const submissions: TestSubmission[] = [
  {
    id: "test-ai-20260801-01",
    taskId: "T005",
    userId: "199900000000000001",
    createdAt: "2026-08-01 08:20:00",
    proofUrl: "https://example.com/evidence/filter-state-recording",
    summary:
      "Problem: task filters reset when a member opens a task and returns to the list. I reproduced this on desktop Chrome three times. Solution: store the selected task type and difficulty in URL parameters and restore them when the list loads. Expected impact: members can compare several missions without repeating navigation, reducing abandonment during task discovery. Scope: the task portal filter state only. The linked recording shows the complete reproduction flow."
  },
  {
    id: "test-ai-20260801-02",
    taskId: "T005",
    userId: "199900000000000002",
    createdAt: "2026-08-01 10:45:00",
    summary:
      "Please make SpoonOS better and add more AI features. This will attract many users and make the community grow very quickly."
  },
  {
    id: "test-ai-20260801-03",
    taskId: "T006",
    userId: "199900000000000003",
    createdAt: "2026-08-01 14:10:00",
    proofUrl: "https://example.com/research/agent-evaluation",
    summary:
      "Source: https://example.com/research/agent-evaluation. The useful idea is to separate planning failures from tool-execution failures when evaluating agents. For SpoonOS, contributors could use the same distinction in bug reports: state whether the plan was incorrect or whether a tool result was mishandled, then attach the relevant trace. This would make community feedback easier to reproduce, route, and compare across product versions."
  },
  {
    id: "test-ai-20260802-01",
    taskId: "T006",
    userId: "199900000000000004",
    createdAt: "2026-08-02 07:30:00",
    proofUrl: "https://example.com/ai-news",
    summary:
      "Huge AI news. This is very important and everyone should read it now: https://example.com/ai-news"
  },
  {
    id: "test-ai-20260802-02",
    taskId: "T012",
    userId: "199900000000000005",
    createdAt: "2026-08-02 11:15:00",
    proofUrl: "https://x.com/SpoonOS/status/1951000000000000000",
    structuredData: {
      postUrl: "https://x.com/SpoonOS/status/1951000000000000000",
      interactionType: "reply"
    },
    summary:
      "I replied that transparent task criteria are especially valuable for agent communities because contributors need to know whether a result is reproducible, not merely impressive. I also suggested publishing one accepted and one rejected example for every Advanced mission so new members can calibrate quality before submitting."
  },
  {
    id: "test-ai-20260802-03",
    taskId: "T012",
    userId: "199900000000000006",
    createdAt: "2026-08-02 15:40:00",
    proofUrl: "https://x.com/SpoonOS/status/1951000000000000001",
    structuredData: {
      postUrl: "https://x.com/SpoonOS/status/1951000000000000001",
      interactionType: "repost"
    },
    summary: "Amazing project! Great work, LFG!"
  },
  {
    id: "test-ai-20260803-01",
    taskId: "T008",
    userId: "199900000000000007",
    createdAt: "2026-08-03 06:25:00",
    proofUrl: "https://example.com/evidence/arena-timeout-video",
    summary:
      "Bug: Arena remains on the loading state after an agent run times out. Environment: macOS 15.5, Chrome 138, logged-in test account. Reproduction: open Arena, start a workflow that calls an unavailable endpoint, wait for the request timeout, then press Run again. Expected: the previous run ends with an error and the button becomes available. Actual: the spinner remains and Run stays disabled until the page is refreshed. I reproduced this four times and attached a screen recording with timestamps and console output."
  },
  {
    id: "test-ai-20260803-02",
    taskId: "T004",
    userId: "199900000000000008",
    createdAt: "2026-08-03 09:50:00",
    summary:
      "Artificial intelligence is changing the world at an unprecedented speed. Agents will improve productivity, unlock innovation, empower every creator, transform communities, and build a better future. SpoonOS is a powerful platform with unlimited potential. We should embrace technology, keep learning, collaborate together, and use AI responsibly so that everyone can benefit from the next generation of intelligent systems."
  },
  {
    id: "test-ai-20260803-03",
    taskId: "T018",
    userId: "199900000000000009",
    createdAt: "2026-08-03 13:05:00",
    proofUrl: "https://example.com/evidence/onboarding-test-notes",
    summary:
      "I tested the complete first-time contributor flow from joining Discord to locating T005 and preparing a submission. The task portal made task discovery clear, but the transition back to Discord was confusing because the submit command and required evidence were not shown beside the task card. Two new testers both returned to the guide channel to search for instructions. I recommend adding a Submit in Discord button plus a compact evidence checklist on every task detail. Success can be measured by task-view-to-submission conversion and median time to first valid submission."
  },
  {
    id: "test-ai-20260803-04",
    taskId: "T021",
    userId: "199900000000000010",
    createdAt: "2026-08-03 16:35:00",
    proofUrl: "https://example.com/demo/community-faq-agent",
    summary:
      "I built a small FAQ retrieval workflow that accepts a Discord question, searches a versioned SpoonOS FAQ dataset, returns the matching answer with its source section, and declines when confidence is below 0.72. The demo includes setup instructions, five reproducible test cases, expected outputs, and one failure case involving ambiguous wallet questions. I also documented how an operator can update the source data without changing the workflow code. The linked demo contains the configuration, execution trace, and test results."
  }
];

migrate();

const fresh = process.argv.includes("--fresh");
const batchSuffix = new Date()
  .toISOString()
  .replace(/\D/g, "")
  .slice(0, 14);

const taskVersion = db.prepare(
  `SELECT current_version
   FROM tasks
   WHERE id = ? AND season_id = 'season-2'`
);
const insert = db.prepare(
  `INSERT OR IGNORE INTO submissions
    (id, season_id, task_id, task_version, user_id, summary,
     proof_url, structured_data_json, status, ai_precheck_json,
     created_at, updated_at)
   VALUES (?, 'season-2', ?, ?, ?, ?, ?, ?, 'Submitted', NULL, ?, ?)`
);

let created = 0;
let skipped = 0;
for (const submission of submissions) {
  const submissionId = fresh
    ? `${submission.id}-${batchSuffix}`
    : submission.id;
  const task = taskVersion.get(submission.taskId) as
    | { current_version: number }
    | undefined;
  if (!task) {
    throw new Error(`Task ${submission.taskId} does not exist in season-2.`);
  }
  const result = insert.run(
    submissionId,
    submission.taskId,
    task.current_version,
    submission.userId,
    submission.summary,
    submission.proofUrl ?? null,
    submission.structuredData
      ? JSON.stringify(submission.structuredData)
      : null,
    submission.createdAt,
    submission.createdAt
  );
  if (result.changes) created += 1;
  else skipped += 1;
}

console.log(
  `AI review test seed complete. Created ${created}; already existed ${skipped}.${
    fresh ? ` Fresh batch: ${batchSuffix}.` : ""
  }`
);
