# SpoonOS Community Bot · Manual Acceptance Test Plan

## 1. Test objective

Validate the complete Season 2 flow without allowing AI to award points:

```text
Task configuration → User submission / Discord messages → Rules → AI advice
→ Review export → Human decision → Point ledger → Leaderboard
```

Run these cases in a test Discord server. Prefer a separate database:

```dotenv
DATABASE_PATH=./data/acceptance-test.db
```

Then initialize it with `npm run seed`. Do not approve simulated submissions in
the production database unless leaderboard pollution is acceptable.

## 2. Test accounts and channels

Prepare three Discord accounts or roles:

| Identity | Required access |
|---|---|
| Test member A | Normal member; can view and submit tasks |
| Test member B | Normal member; used for duplicate and ranking checks |
| Test operator | Manage Messages / configured reviewer role |

Prepare:

- One channel included in `ACTIVITY_CHANNEL_IDS`.
- One channel not included in `ACTIVITY_CHANNEL_IDS`.
- One private operator channel for export files.

Record results as `Pass`, `Fail`, or `Blocked`. Save screenshots for failures.

## 3. Environment and connectivity

### ENV-01 · Python service starts

**Priority:** P0

1. Start `review-service` with its `.env`.
2. Run `curl http://127.0.0.1:8000/health`.

Expected:

```json
{"ok":true,"aiEnabled":true}
```

### ENV-02 · Agnes configuration is recognized

Use:

```dotenv
OPENAI_BASE_URL=https://apihub.agnes-ai.com/v1
OPENAI_API_KEY=<secret>
OPENAI_MODEL=agnes-2.0-flash
```

Expected:

- Health shows `aiEnabled: true`.
- Token is not printed in logs.
- Final endpoint is `/v1/chat/completions`.

### ENV-03 · Bot connects to precheck service

Root `.env`:

```dotenv
PRECHECK_SERVICE_URL=http://127.0.0.1:8000
PRECHECK_SERVICE_TOKEN=<same optional internal token as review-service>
```

Expected: Bot starts without connection or authentication errors.

### ENV-04 · Invalid internal service token

Temporarily use different `PRECHECK_SERVICE_TOKEN` values in the two services,
then submit an AI-enabled task.

Expected:

- No points are awarded.
- Submission remains available for manual review.
- Precheck contains an AI service failure flag or manual-review guidance.

Restore the matching token after the test.

### ENV-05 · Slash commands are current

Run `npm run deploy:commands`, then type `/` in the test server.

Expected: `/activity-admin`, `/review`, `/task-admin`, `/submit`, and `/tasks`
are visible with English descriptions.

## 4. Task center and permissions

### TASK-01 · `/tasks` without filters

Expected: all Published tasks are shown to a member. A manager may also see
non-archived drafts. No filter should mean “all”, not an empty result.

### TASK-02 · Task details

Run `/task task_id:T005`.

Expected: title, description, difficulty, points, limits, review mode, and
acceptance criteria are present and written in English.

### TASK-03 · Draft task cannot be submitted

Set a test task to Draft and submit it.

Expected: `Task unavailable`; no submission is created.

### TASK-04 · Member cannot use management commands

As Test member A, try `/task-admin`, `/review`, and `/activity-admin`.

Expected: command is unavailable or returns a permission error; no state changes.

## 5. Deferred batch AI precheck

Publish T005, T006, and T012 before testing.

### SUB-01 · Strong product proposal

Command:

```text
/submit
task_id: T005
summary: Problem: task filters disappear when a member opens a task and returns to the list. Solution: persist the selected type and difficulty in the URL and browser session. Expected impact: contributors can compare tasks without repeating navigation. Scope: the task portal filter state only. I reproduced this on desktop Chrome and recorded the workflow.
proof_url: https://example.com/test/filter-recording
```

Expected:

- User receives `Submission received` and a submission ID.
- Status is `Prechecked`.
- User does not see the AI score, internal flags, or prompt.
- Only deterministic rule results exist immediately after submission.
- No points are awarded yet.

After the target UTC day is complete, run:

```text
/review export start_date:YYYY-MM-DD end_date:YYYY-MM-DD ai_precheck:True ai_limit:5
```

Expected: no more than five eligible submissions are AI prechecked and exported;
the CSV contains the AI recommendation and provider details. Run the command again
to process the next batch.

### SUB-02 · Vague product proposal

```text
/submit
task_id: T005
summary: Make the product better and add more AI features because users will like it.
```

Expected: submission is retained; precheck recommends revision or manual review,
with missing problem, actionable solution, impact, evidence, or scope.

### SUB-03 · Valuable technical content

```text
/submit
task_id: T006
summary: Source: https://example.com/research/agent-evaluation. The useful idea is to separate planning failures from tool-execution failures. For SpoonOS, this can improve bug reports: contributors should state whether the plan was wrong or the tool result was mishandled, then attach the relevant trace.
proof_url: https://example.com/research/agent-evaluation
```

Expected: source and personal analysis pass deterministic formatting checks;
AI evaluates relevance and community value.

### SUB-04 · Link-only content

```text
/submit
task_id: T006
summary: Big AI news, everyone should read it: https://example.com/ai-news
proof_url: https://example.com/ai-news
```

Expected: missing/weak personal analysis is flagged. No automatic rejection or points.

### SUB-05 · Exact duplicate

Submit the exact SUB-03 summary a second time from Test member B.

Expected:

- First submission is not compared with itself.
- Second submission contains `possible_duplicate` or `exact_duplicate`.
- The second submission remains available for human review.

### SUB-06 · X interaction

```text
/submit
task_id: T012
summary: I reposted the designated product update and added a specific observation about the task workflow.
proof_url: https://x.com/test_member/status/1900000000000000000
```

Expected: URL format and text quality are checked, but the result explicitly
requires X API or manual verification for account ownership and repost status.

### SUB-07 · AI service unavailable

Stop `review-service`, then submit a valid T005 item.

Expected:

- Submission is not lost.
- No points are awarded.
- Operator is told to perform manual review.
- Bot process must not crash.

Restart the service after the test.

## 6. Daily activity collection and precheck

### ACT-01 · Configured channel is collected

Send a normal message in the configured activity channel while the Bot is online.
Run `/activity-admin status date:<current UTC date>`.

Expected: message and member counts increase.

### ACT-02 · Unconfigured channel is ignored

Send the same message in a channel not included in `ACTIVITY_CHANNEL_IDS`.

Expected: activity status does not increase because of that message.

### ACT-03 · Deleted message is excluded

Send a message in the configured channel, confirm it is collected, then delete it.

Expected: it is marked deleted and excluded from completed-day precheck totals.

### ACT-04 · Historical collection is idempotent

For a completed UTC date with existing messages, run twice:

```text
/activity-admin collect channel:#configured-channel date:YYYY-MM-DD
```

Expected: first run stores messages; second run reports zero or fewer new
messages. No duplicate message records are created.

### ACT-05 · Low-value messages

Send these as separate messages in the configured channel:

```text
gm
gn
nice
🔥🔥🔥
https://example.com
```

Expected: deterministic rules reject them as greeting, too short, emoji-only,
or link-only. They do not count toward the five-message threshold.

### ACT-06 · Five meaningful messages

Send five separate messages similar to:

```text
I tested the Arena retry flow and keeping the previous prompt would reduce repeated work.
The loading state should explain whether the agent is waiting for a tool or generating text.
The onboarding FAQ needs one screenshot for the role-selection step.
Does Skill Marketplace ranking use recent activity or total installs only?
I reproduced the workflow issue on Chrome and recorded the exact steps for the product channel.
```

After that UTC day is complete, run:

```text
/activity-admin precheck date:YYYY-MM-DD
```

Expected: one T001 `Prechecked` submission is created for the member, containing
message-level rule results, relevance scores, reasons, and suggested points.
No points are awarded yet.

### ACT-07 · Current UTC day cannot be finalized

Run `/activity-admin precheck` using today's UTC date.

Expected: `Activity prechecks can only run for a completed UTC day.`

### ACT-08 · Daily precheck is idempotent

Run precheck twice for the same member and UTC date.

Expected: only one T001 daily review submission exists.

## 7. Batch review and point settlement

The repository already includes ten simulated submissions dated `2026-08-02`
UTC. They can be recreated idempotently with:

```bash
npm run seed:mock-submissions -- 2026-08-02
```

### REV-01 · Export simulated review batch

```text
/review export start_date:2026-08-02 end_date:2026-08-02
```

Expected: ten rows—T001 ×3, T005 ×3, T006 ×3, T012 ×1.

### REV-02 · Exported AI columns

Expected columns:

```text
ai_score
ai_recommendation
ai_flags
ai_missing_items
ai_review_questions
ai_details
evidence_summary
review_decision
quality_coefficient
review_note
```

Expected: T001 rows contain message text and per-message decisions in
`evidence_summary`. User-facing review columns are blank.

### REV-03 · Mixed batch decisions

In an isolated test database, fill three rows:

| Row | review_decision | quality_coefficient | review_note |
|---|---|---:|---|
| Strong submission | approve | 1 | Evidence verified |
| Incomplete submission | revision | | Add the missing source and analysis |
| Low-quality submission | reject | | Spam or non-substantive contribution |

Upload with `/review import`.

Expected: statuses change correctly; only the approved row receives points;
revision/reject notes are sent to the submission owner where DMs are available.

### REV-04 · Re-import protection

Upload the same completed review file again.

Expected: finalized rows are skipped and no points are awarded twice.

### REV-05 · Batch approval confirmation

Run `/review approve-batch` with `confirm:false`.

Expected: no rows are approved and no points are awarded.

### REV-06 · Quality coefficient

Approve a 100-point isolated test task with coefficient `1.25`.

Expected: 125 points unless the task's `maxPoints` caps the result. Ledger stores
base points, multiplier, final points, reviewer, and submission ID.

### REV-07 · T001 weekly cap

Prepare more than five eligible T001 days for one member in the same UTC week.
Approve five, then attempt to approve the sixth.

Expected: sixth approval is blocked by the weekly limit. Earlier legitimate
failed days do not receive points.

## 8. Profile, leaderboard, and public portal

### DATA-01 · `/me` after approval

Expected: total points, level, title, next-level progress, and recent submission
status match the point ledger.

### DATA-02 · Leaderboard order

Approve different point totals for two test members.

Expected: higher total appears first; displayed points equal ledger totals.

### DATA-03 · `/tasks` portal link

With `COMMUNITY_PORTAL_URL` configured, run `/tasks` as a normal member.

Expected: Bot provides the public portal link. The portal reads task and
leaderboard data from the Bot's read-only API.

## 9. Exit criteria

Release is ready for a controlled pilot when:

- All P0 cases pass.
- No failed AI request loses a submission or awards points.
- Duplicate imports and reviews cannot create duplicate point entries.
- Only configured channels contribute to T001.
- Users cannot see internal AI scores or anti-abuse flags.
- Reviewer exports contain enough evidence to make a human decision.
- Test data is kept out of the production leaderboard.
