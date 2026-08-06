import * as XLSX from "xlsx";
import { AppError } from "../core/errors.js";
import type {
  PrecheckResult,
  ReviewDecision,
  SubmissionRecord,
  SubmissionStatus,
  TaskConfig
} from "../core/types.js";
import { db } from "../db/database.js";
import { newId, parseJson } from "../db/utils.js";
import { SubmissionService } from "./submission-service.js";

const reviewHeaders = [
  "batch_id",
  "submission_id",
  "review_decision",
  "final_points",
  "quality_coefficient",
  "review_note",
  "submitted_at_utc",
  "task_id",
  "task_title",
  "user_id",
  "current_status",
  "summary",
  "evidence_summary",
  "proof_url",
  "attachment_url",
  "base_points",
  "max_points",
  "ai_score",
  "ai_recommendation",
  "ai_suggested_decision",
  "ai_suggested_coefficient",
  "ai_suggested_points",
  "ai_reason",
  "ai_flags",
  "ai_missing_items",
  "ai_review_questions",
  "ai_details"
] as const;

export type ReviewBatchCreateOptions = {
  days?: number;
  startDate?: string;
  endDate?: string;
};

type ExportRow = {
  id: string;
  user_id: string;
  task_id: string;
  status: SubmissionStatus;
  summary: string;
  structured_data_json: string | null;
  proof_url: string | null;
  attachment_url: string | null;
  ai_precheck_json: string | null;
  created_at: string;
  config_json: string;
};

type ImportedReview = {
  batchId: string;
  submissionId: string;
  decision: ReviewDecision["decision"];
  points?: number;
  coefficient?: number;
  note: string;
  rowNumber: number;
};

export type BatchReviewExport = {
  batchId: string;
  startDate: string;
  endDate: string;
  count: number;
  aiPrechecked: number;
  aiPending: number;
  csv: string;
  xlsx: Buffer;
};

export type ReviewBatchCreated = {
  batchId: string;
  startDate: string;
  endDate: string;
  count: number;
};

export type BatchAiPreviewResult = {
  batchId: string;
  processed: number;
  succeeded: number;
  unavailable: number;
  previewedTotal: number;
  remaining: number;
  total: number;
};

export type BatchReviewImportResult = {
  batchId: string;
  approved: number;
  revisionRequired: number;
  rejected: number;
  skippedBlank: number;
  skippedFinalized: number;
  awardedPoints: number;
  reviewed: SubmissionRecord[];
  failed: { submissionId: string; rowNumber: number; error: string }[];
};

export type BatchApprovalResult = {
  batchId: string;
  taskId?: string;
  approved: number;
  skippedFinalized: number;
  awardedPoints: number;
  reviewed: SubmissionRecord[];
  failed: { submissionId: string; error: string }[];
};

const escapeCsv = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

const csv = (rows: Record<string, unknown>[]): string => {
  const lines = [reviewHeaders.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(reviewHeaders.map((header) => escapeCsv(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
};

const reviewWorkbook = (rows: Record<string, unknown>[]): Buffer => {
  const workbook = XLSX.utils.book_new();
  const reviewSheet = XLSX.utils.aoa_to_sheet([
    [...reviewHeaders],
    ...rows.map((row) => reviewHeaders.map((header) => row[header] ?? ""))
  ]);
  reviewSheet["!autofilter"] = {
    ref: `A1:${XLSX.utils.encode_col(reviewHeaders.length - 1)}${rows.length + 1}`
  };
  reviewSheet["!cols"] = reviewHeaders.map((header) => ({
    wch:
      header === "summary" || header === "ai_reason"
        ? 48
        : header === "review_note"
          ? 36
          : Math.max(14, Math.min(28, header.length + 3))
  }));

  const instructions = XLSX.utils.aoa_to_sheet([
    ["SpoonOS Batch Review — Human Decision Instructions"],
    [],
    ["Important", "AI columns are suggestions only. Points are awarded only after a human completes the Human Review columns and imports this workbook."],
    [],
    ["Column", "What you should enter"],
    ["review_decision", "Required final decision: approve, revision, or reject."],
    ["final_points", "For approve only. Enter the exact whole-number points to award."],
    ["quality_coefficient", "For approve only. Alternatively enter 0.5, 1, 1.25, or 1.5. Do not fill this together with final_points."],
    ["review_note", "Required for revision/reject; optional for approve."],
    [],
    ["Workflow", "Review the submission and AI suggestions → fill the four Human Review columns → save the workbook → upload it with /review import."]
  ]);
  instructions["!cols"] = [{ wch: 25 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, reviewSheet, "Human Review");
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

const utcDate = (date: Date): string => date.toISOString().slice(0, 10);

const parseDate = (value: string, field: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(
      "Invalid UTC date",
      "INVALID_UTC_DATE",
      `${field} must use YYYY-MM-DD format.`
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || utcDate(parsed) !== value) {
    throw new AppError(
      "Invalid UTC date",
      "INVALID_UTC_DATE",
      `${field} is not a valid UTC calendar date.`
    );
  }
  return parsed;
};

const nextUtcDate = (date: string): string => {
  const parsed = parseDate(date, "end_date");
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return utcDate(parsed);
};

const normalizeHeader = (value: string): string =>
  value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const text = (value: unknown): string =>
  value == null ? "" : String(value).trim();

const aiReason = (precheck?: PrecheckResult): string => {
  if (!precheck) return "";
  const results = Array.isArray(precheck.raw) ? precheck.raw : [precheck.raw];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const result = item as Record<string, unknown>;
    const raw =
      result.raw && typeof result.raw === "object"
        ? (result.raw as Record<string, unknown>)
        : result;
    const aiResult =
      raw.aiResult && typeof raw.aiResult === "object"
        ? (raw.aiResult as Record<string, unknown>)
        : raw;
    if (typeof aiResult.reason === "string" && aiResult.reason.trim()) {
      return aiResult.reason.trim().slice(0, 1500);
    }
  }
  return precheck.reviewQuestions[0] ?? "";
};

const aiSettlementSuggestion = (
  task: TaskConfig,
  precheck?: PrecheckResult
): {
  decision: "approve" | "manual_review" | "revision" | "reject";
  coefficient: number | "";
  points: number | "";
} => {
  if (
    !precheck ||
    precheck.flags.some((flag) =>
      [
        "ai_service_unavailable",
        "ai_unavailable",
        "ai_not_configured"
      ].includes(flag)
    )
  ) {
    return { decision: "manual_review", coefficient: "", points: "" };
  }
  if (precheck.recommendation === "revision") {
    return {
      decision: precheck.score < 40 ? "reject" : "revision",
      coefficient: 0,
      points: 0
    };
  }
  if (precheck.recommendation === "review") {
    return { decision: "manual_review", coefficient: "", points: "" };
  }

  const coefficient =
    precheck.score >= 90 ? 1.25 : precheck.score >= 75 ? 1 : 0.5;
  const rawPoints = Math.round(task.basePoints * coefficient);
  const points = Math.min(task.maxPoints ?? rawPoints, rawPoints);
  return { decision: "approve", coefficient, points };
};

const AI_PREVIEW_DEFAULT_LIMIT = 5;
const AI_PREVIEW_MAX_LIMIT = 20;
const AI_PREVIEW_CONCURRENCY = 3;

const AI_UNAVAILABLE_FLAGS = [
  "ai_service_unavailable",
  "ai_unavailable",
  "ai_not_configured"
];

const hasCompletedAiPreview = (precheck?: PrecheckResult): boolean =>
  Boolean(
    precheck &&
      (precheck.pluginId.includes("ai_webhook_precheck") ||
        precheck.pluginId.includes("daily_activity_v1")) &&
      !precheck.flags.some((flag) => AI_UNAVAILABLE_FLAGS.includes(flag))
  );

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

export class BatchReviewService {
  constructor(private readonly submissions: SubmissionService) {}

  listBatches(): {
    id: string;
    seasonId: string;
    startDate: string;
    endDate: string;
    count: number;
    imported: boolean;
    createdAt: string;
  }[] {
    return db
      .prepare(
        `SELECT
           b.id,
           b.season_id       AS seasonId,
           b.start_date_utc  AS startDate,
           b.end_date_utc    AS endDate,
           b.imported_at IS NOT NULL AS imported,
           b.created_at      AS createdAt,
           (SELECT COUNT(*) FROM review_batch_items i WHERE i.batch_id = b.id) AS count
         FROM review_batches b
         ORDER BY b.created_at DESC`
      )
      .all() as {
      id: string;
      seasonId: string;
      startDate: string;
      endDate: string;
      count: number;
      imported: boolean;
      createdAt: string;
    }[];
  }

  createBatch(
    seasonId: string,
    actorId: string,
    options: ReviewBatchCreateOptions = {},
    now = new Date()
  ): ReviewBatchCreated {
    const { startDate, endDate } = this.dateRange(options, now);
    const rows = db
      .prepare(
        `SELECT s.id, s.status, s.created_at
         FROM submissions s
         WHERE s.season_id = ?
           AND s.status IN ('Submitted', 'Prechecked')
           AND s.created_at >= ?
           AND s.created_at < ?
         ORDER BY s.created_at, s.id`
      )
      .all(
        seasonId,
        `${startDate} 00:00:00`,
        `${nextUtcDate(endDate)} 00:00:00`
      ) as { id: string; status: SubmissionStatus; created_at: string }[];
    if (!rows.length) {
      throw new AppError(
        "No pending submissions",
        "NO_PENDING_SUBMISSIONS",
        "No unbatched submissions were found in this UTC date range."
      );
    }

    const batchId = newId("review");
    const actualStartDate =
      options.days == null && !options.startDate && !options.endDate
        ? rows[0].created_at.slice(0, 10)
        : startDate;
    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO review_batches
          (id, season_id, start_date_utc, end_date_utc, created_by)
         VALUES (?, ?, ?, ?, ?)`
      ).run(batchId, seasonId, actualStartDate, endDate, actorId);
      const addItem = db.prepare(
        `INSERT INTO review_batch_items
          (batch_id, submission_id, initial_status) VALUES (?, ?, ?)`
      );
      const markUnderReview = db.prepare(
        `UPDATE submissions
         SET status = 'UnderReview', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('Submitted', 'Prechecked')`
      );
      for (const row of rows) {
        addItem.run(batchId, row.id, row.status);
        markUnderReview.run(row.id);
      }
    });
    transaction();

    return {
      batchId,
      startDate: actualStartDate,
      endDate,
      count: rows.length
    };
  }

  async previewBatch(
    batchId: string,
    limit = AI_PREVIEW_DEFAULT_LIMIT
  ): Promise<BatchAiPreviewResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > AI_PREVIEW_MAX_LIMIT) {
      throw new AppError(
        "Invalid AI preview size",
        "INVALID_AI_PREVIEW_SIZE",
        `limit must be between 1 and ${AI_PREVIEW_MAX_LIMIT}.`
      );
    }
    const batch = db
      .prepare("SELECT id FROM review_batches WHERE id = ?")
      .get(batchId);
    if (!batch) {
      throw new AppError(
        "Review batch not found",
        "REVIEW_BATCH_NOT_FOUND",
        "The requested review batch could not be found."
      );
    }
    const rows = db
      .prepare(
        `SELECT s.id, s.ai_precheck_json
         FROM review_batch_items i
         JOIN submissions s ON s.id = i.submission_id
         WHERE i.batch_id = ?
           AND s.status IN ('Submitted', 'Prechecked', 'UnderReview')
         ORDER BY s.created_at, s.id`
      )
      .all(batchId) as { id: string; ai_precheck_json: string | null }[];
    const pending = rows
      .filter(
        (row) =>
          !hasCompletedAiPreview(
            parseJson<PrecheckResult>(row.ai_precheck_json)
          )
      )
      .slice(0, limit);

    const checked = await mapWithConcurrency(
      pending,
      AI_PREVIEW_CONCURRENCY,
      (row) => this.submissions.precheckWithAi(row.id)
    );
    const succeeded = checked.filter((item) =>
      hasCompletedAiPreview(item.aiPrecheck)
    ).length;
    const unavailable = checked.length - succeeded;
    const refreshed = db
      .prepare(
        `SELECT s.ai_precheck_json
         FROM review_batch_items i
         JOIN submissions s ON s.id = i.submission_id
         WHERE i.batch_id = ?
           AND s.status IN ('Submitted', 'Prechecked', 'UnderReview')`
      )
      .all(batchId) as { ai_precheck_json: string | null }[];
    const previewedTotal = refreshed.filter((row) =>
      hasCompletedAiPreview(parseJson<PrecheckResult>(row.ai_precheck_json))
    ).length;

    return {
      batchId,
      processed: checked.length,
      succeeded,
      unavailable,
      previewedTotal,
      remaining: refreshed.length - previewedTotal,
      total: refreshed.length
    };
  }

  exportBatch(batchId: string): BatchReviewExport {
    const batch = db
      .prepare(
        `SELECT id, start_date_utc, end_date_utc
         FROM review_batches WHERE id = ?`
      )
      .get(batchId) as
      | { id: string; start_date_utc: string; end_date_utc: string }
      | undefined;
    if (!batch) {
      throw new AppError(
        "Review batch not found",
        "REVIEW_BATCH_NOT_FOUND",
        "The requested review batch could not be found."
      );
    }
    const rows = db
      .prepare(
        `SELECT s.id, s.user_id, s.task_id, s.status, s.summary,
                s.structured_data_json, s.proof_url, s.attachment_url,
                s.ai_precheck_json, s.created_at, v.config_json
         FROM review_batch_items i
         JOIN submissions s ON s.id = i.submission_id
         JOIN task_versions v
           ON v.task_id = s.task_id
          AND v.season_id = s.season_id
          AND v.version = s.task_version
         WHERE i.batch_id = ?
         ORDER BY s.created_at, s.id`
      )
      .all(batchId) as ExportRow[];

    const output = rows.map((row) => {
      const task = JSON.parse(row.config_json) as TaskConfig;
      const ai = parseJson<PrecheckResult>(row.ai_precheck_json);
      const suggestion = aiSettlementSuggestion(task, ai);
      const structured = parseJson<Record<string, unknown>>(row.structured_data_json);
      const evidence = Array.isArray(structured?.messageEvidence)
        ? structured.messageEvidence
            .slice(0, 30)
            .map((item) => {
              const value = item as Record<string, unknown>;
              return [
                `[${value.ruleStatus ?? "?"}/${value.aiStatus ?? "?"}]`,
                `channel:${value.channelId ?? "?"}`,
                `message:${value.messageId ?? "?"}`,
                `relevance:${value.relevanceScore ?? "-"}`,
                String(value.content ?? "")
              ].join(" ");
            })
            .join("\n")
        : "";
      return {
        batch_id: batchId,
        submission_id: row.id,
        review_decision: "",
        final_points: "",
        quality_coefficient: "",
        review_note: "",
        submitted_at_utc: row.created_at,
        task_id: row.task_id,
        task_title: task.title,
        user_id: row.user_id,
        current_status: row.status,
        summary: row.summary,
        evidence_summary: evidence,
        proof_url: row.proof_url,
        attachment_url: row.attachment_url,
        base_points: task.basePoints,
        max_points: task.maxPoints,
        ai_score: ai?.score,
        ai_recommendation: ai?.recommendation,
        ai_suggested_decision: suggestion.decision,
        ai_suggested_coefficient: suggestion.coefficient,
        ai_suggested_points: suggestion.points,
        ai_reason: aiReason(ai),
        ai_flags: ai?.flags.join(" | "),
        ai_missing_items: ai?.missingItems.join(" | "),
        ai_review_questions: ai?.reviewQuestions.join(" | "),
        ai_details: ai?.raw ? JSON.stringify(ai.raw) : ""
      };
    });

    return {
      batchId,
      startDate: batch.start_date_utc,
      endDate: batch.end_date_utc,
      count: rows.length,
      aiPrechecked: rows.filter((row) =>
        hasCompletedAiPreview(parseJson<PrecheckResult>(row.ai_precheck_json))
      ).length,
      aiPending: rows.filter(
        (row) =>
          !hasCompletedAiPreview(
            parseJson<PrecheckResult>(row.ai_precheck_json)
          )
      ).length,
      csv: csv(output),
      xlsx: reviewWorkbook(output)
    };
  }

  parse(file: Buffer, filename: string): {
    batchId: string;
    reviews: ImportedReview[];
    skippedBlank: number;
  } {
    if (!/\.(csv|xlsx|xls)$/i.test(filename)) {
      throw new AppError(
        "Unsupported review file",
        "UNSUPPORTED_REVIEW_FILE",
        "Upload the completed .csv, .xlsx, or .xls review file."
      );
    }
    const workbook = XLSX.read(file, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) {
      throw new AppError(
        "Empty review file",
        "EMPTY_REVIEW_FILE",
        "The review file does not contain a worksheet."
      );
    }
    const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[firstSheet],
      { defval: "" }
    );
    if (!sourceRows.length) {
      throw new AppError(
        "Empty review file",
        "EMPTY_REVIEW_FILE",
        "The review file does not contain any submission rows."
      );
    }

    let batchId = "";
    let skippedBlank = 0;
    const seen = new Set<string>();
    const reviews: ImportedReview[] = [];
    for (const [index, source] of sourceRows.entries()) {
      const rowNumber = index + 2;
      const row = Object.fromEntries(
        Object.entries(source).map(([key, value]) => [
          normalizeHeader(key),
          value
        ])
      );
      const rowBatchId = text(row.batch_id);
      const submissionId = text(row.submission_id);
      const rawDecision = text(row.review_decision).toLowerCase();
      if (!rowBatchId || !submissionId) {
        throw new AppError(
          "Invalid review row",
          "INVALID_REVIEW_ROW",
          `Row ${rowNumber}: batch_id and submission_id are required.`
        );
      }
      if (!batchId) batchId = rowBatchId;
      if (batchId !== rowBatchId) {
        throw new AppError(
          "Mixed review batches",
          "MIXED_REVIEW_BATCHES",
          `Row ${rowNumber}: all rows must belong to the same batch.`
        );
      }
      if (seen.has(submissionId)) {
        throw new AppError(
          "Duplicate review row",
          "DUPLICATE_REVIEW_ROW",
          `Row ${rowNumber}: submission_id ${submissionId} appears more than once.`
        );
      }
      seen.add(submissionId);
      if (!rawDecision) {
        skippedBlank += 1;
        continue;
      }
      const decisionAliases: Record<string, ReviewDecision["decision"]> = {
        approve: "approve",
        approved: "approve",
        revision: "revision",
        revise: "revision",
        revisionrequired: "revision",
        "revision required": "revision",
        reject: "reject",
        rejected: "reject"
      };
      const decision = decisionAliases[rawDecision];
      if (!decision) {
        throw new AppError(
          "Invalid review decision",
          "INVALID_REVIEW_DECISION",
          `Row ${rowNumber}: review_decision must be approve, revision, or reject.`
        );
      }
      const coefficientText = text(row.quality_coefficient);
      const pointsText = text(row.final_points);
      const points = pointsText === "" ? undefined : Number(pointsText);
      if (
        points != null &&
        (!Number.isInteger(points) || points <= 0)
      ) {
        throw new AppError(
          "Invalid final points",
          "INVALID_FINAL_POINTS",
          `Row ${rowNumber}: final_points must be a positive whole number.`
        );
      }
      const coefficient =
        coefficientText === "" ? undefined : Number(coefficientText);
      if (
        coefficient != null &&
        ![0.5, 1, 1.25, 1.5].includes(coefficient)
      ) {
        throw new AppError(
          "Invalid quality coefficient",
          "INVALID_COEFFICIENT",
          `Row ${rowNumber}: quality_coefficient must be 0.5, 1, 1.25, or 1.5.`
        );
      }
      if (decision !== "approve" && coefficient != null) {
        throw new AppError(
          "Unexpected quality coefficient",
          "UNEXPECTED_COEFFICIENT",
          `Row ${rowNumber}: only approved rows may contain a quality coefficient.`
        );
      }
      if (decision !== "approve" && points != null) {
        throw new AppError(
          "Unexpected final points",
          "UNEXPECTED_FINAL_POINTS",
          `Row ${rowNumber}: only approved rows may contain final_points.`
        );
      }
      if (points != null && coefficient != null) {
        throw new AppError(
          "Choose points or coefficient",
          "POINTS_AND_COEFFICIENT_CONFLICT",
          `Row ${rowNumber}: fill either final_points or quality_coefficient, not both.`
        );
      }
      const note = text(row.review_note);
      if ((decision === "revision" || decision === "reject") && !note) {
        throw new AppError(
          "Review note required",
          "REVIEW_NOTE_REQUIRED",
          `Row ${rowNumber}: revision and reject decisions require a review_note.`
        );
      }
      reviews.push({
        batchId,
        submissionId,
        decision,
        points,
        coefficient,
        note,
        rowNumber
      });
    }
    return { batchId, reviews, skippedBlank };
  }

  apply(
    parsed: ReturnType<BatchReviewService["parse"]>,
    reviewerId: string
  ): BatchReviewImportResult {
    const batch = db
      .prepare("SELECT id FROM review_batches WHERE id = ?")
      .get(parsed.batchId);
    if (!batch) {
      throw new AppError(
        "Review batch not found",
        "REVIEW_BATCH_NOT_FOUND",
        "This file was not generated by the current Bot database."
      );
    }

    for (const review of parsed.reviews) {
      const item = db
        .prepare(
          `SELECT 1 FROM review_batch_items
           WHERE batch_id = ? AND submission_id = ?`
        )
        .get(parsed.batchId, review.submissionId);
      if (!item) {
        throw new AppError(
          "Submission is not in this batch",
          "SUBMISSION_NOT_IN_BATCH",
          `Row ${review.rowNumber}: ${review.submissionId} does not belong to batch ${parsed.batchId}.`
        );
      }
    }

    const result: BatchReviewImportResult = {
      batchId: parsed.batchId,
      approved: 0,
      revisionRequired: 0,
      rejected: 0,
      skippedBlank: parsed.skippedBlank,
      skippedFinalized: 0,
      awardedPoints: 0,
      reviewed: [],
      failed: []
    };
    for (const review of parsed.reviews) {
      const current = db
        .prepare("SELECT status FROM submissions WHERE id = ?")
        .get(review.submissionId) as { status: SubmissionStatus } | undefined;
      if (
        !current ||
        !["Submitted", "Prechecked", "UnderReview"].includes(current.status)
      ) {
        result.skippedFinalized += 1;
        continue;
      }
      try {
        const reviewed = db.transaction(() =>
          this.submissions.review({
            submissionId: review.submissionId,
            reviewerId,
            decision: review.decision,
            note: review.note || "Approved in batch review",
            qualityCoefficient: review.coefficient,
            finalPoints: review.points
          })
        )();
        result.reviewed.push(reviewed);
        if (reviewed.status === "Approved") {
          result.approved += 1;
          result.awardedPoints += reviewed.finalPoints ?? 0;
        } else if (reviewed.status === "RevisionRequired") {
          result.revisionRequired += 1;
        } else if (reviewed.status === "Rejected") {
          result.rejected += 1;
        }
      } catch (e) {
        result.failed.push({
          submissionId: review.submissionId,
          rowNumber: review.rowNumber,
          error:
            e instanceof AppError
              ? e.userMessage
              : e instanceof Error
                ? e.message
                : String(e)
        });
      }
    }
    if (result.reviewed.length > 0 || result.failed.length === 0) {
      db.prepare(
        `UPDATE review_batches
         SET imported_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(parsed.batchId);
    }
    return result;
  }

  approveBatch(
    batchId: string,
    reviewerId: string,
    options: {
      taskId?: string;
      pointMode?: "standard" | "ai_suggested";
      qualityCoefficient?: number;
      note?: string;
    } = {}
  ): BatchApprovalResult {
    const pointMode = options.pointMode ?? "standard";
    if (pointMode === "ai_suggested" && options.qualityCoefficient != null) {
      throw new AppError(
        "Conflicting batch point options",
        "CONFLICTING_BATCH_POINT_OPTIONS",
        "Do not provide a coefficient when point_mode is ai_suggested."
      );
    }
    const coefficient = options.qualityCoefficient ?? 1;
    if (![0.5, 1, 1.25, 1.5].includes(coefficient)) {
      throw new AppError(
        "Invalid quality coefficient",
        "INVALID_COEFFICIENT",
        "The quality coefficient must be 0.5, 1, 1.25, or 1.5."
      );
    }
    const batch = db
      .prepare(
        `SELECT id FROM review_batches
         WHERE id = ?`
      )
      .get(batchId);
    if (!batch) {
      throw new AppError(
        "Review batch not found",
        "REVIEW_BATCH_NOT_FOUND",
        "The requested review batch could not be found."
      );
    }

    const rows = db
      .prepare(
        `SELECT s.id, s.status, s.ai_precheck_json, v.config_json
         FROM review_batch_items i
         JOIN submissions s ON s.id = i.submission_id
         JOIN task_versions v
           ON v.task_id = s.task_id
          AND v.season_id = s.season_id
          AND v.version = s.task_version
         WHERE i.batch_id = ?
           ${options.taskId ? "AND s.task_id = ?" : ""}
         ORDER BY s.created_at, s.id`
      )
      .all(...(options.taskId ? [batchId, options.taskId] : [batchId])) as {
      id: string;
      status: SubmissionStatus;
      ai_precheck_json: string | null;
      config_json: string;
    }[];
    if (!rows.length) {
      throw new AppError(
        "No submissions found",
        "BATCH_SUBMISSIONS_NOT_FOUND",
        options.taskId
          ? `Batch ${batchId} does not contain submissions for task ${options.taskId}.`
          : `Batch ${batchId} does not contain any submissions.`
      );
    }

    if (pointMode === "ai_suggested") {
      const invalid = rows.filter((row) => {
        if (!["Submitted", "Prechecked", "UnderReview"].includes(row.status)) {
          return false;
        }
        const suggestion = aiSettlementSuggestion(
          JSON.parse(row.config_json) as TaskConfig,
          parseJson<PrecheckResult>(row.ai_precheck_json)
        );
        return suggestion.decision !== "approve" || suggestion.points === "";
      });
      if (invalid.length) {
        throw new AppError(
          "Batch is not safe for AI-suggested approval",
          "BATCH_AI_APPROVAL_INCOMPLETE",
          `${invalid.length} pending submission(s) do not have an AI approve decision with suggested points. Review them in the exported workbook instead.`
        );
      }
    }

    const result: BatchApprovalResult = {
      batchId,
      taskId: options.taskId,
      approved: 0,
      skippedFinalized: 0,
      awardedPoints: 0,
      reviewed: [],
      failed: []
    };
    for (const row of rows) {
      if (
        !["Submitted", "Prechecked", "UnderReview"].includes(row.status)
      ) {
        result.skippedFinalized += 1;
        continue;
      }
      try {
        const reviewed = db.transaction(() =>
          this.submissions.review({
            submissionId: row.id,
            reviewerId,
            decision: "approve",
            note: options.note?.trim() || `Approved as part of batch ${batchId}`,
            ...(pointMode === "ai_suggested"
              ? {
                  finalPoints: aiSettlementSuggestion(
                    JSON.parse(row.config_json) as TaskConfig,
                    parseJson<PrecheckResult>(row.ai_precheck_json)
                  ).points as number
                }
              : { qualityCoefficient: coefficient })
          })
        )();
        result.reviewed.push(reviewed);
        result.approved += 1;
        result.awardedPoints += reviewed.finalPoints ?? 0;
      } catch (e) {
        result.failed.push({
          submissionId: row.id,
          error:
            e instanceof AppError
              ? e.userMessage
              : e instanceof Error
                ? e.message
                : String(e)
        });
      }
    }
    if (result.reviewed.length > 0 || result.failed.length === 0) {
      db.prepare(
        `UPDATE review_batches
         SET imported_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(batchId);
    }
    return result;
  }

  private dateRange(
    options: ReviewBatchCreateOptions,
    now: Date
  ): { startDate: string; endDate: string } {
    if (options.days != null && (options.startDate || options.endDate)) {
      throw new AppError(
        "Conflicting date options",
        "CONFLICTING_DATE_OPTIONS",
        "Use either days or start_date/end_date, not both."
      );
    }
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    let start: Date;
    let end: Date;
    if (options.startDate || options.endDate) {
      start = parseDate(
        options.startDate ?? options.endDate!,
        "start_date"
      );
      end = parseDate(options.endDate ?? options.startDate!, "end_date");
    } else {
      const days = options.days;
      if (days == null) {
        end = yesterday;
        start = new Date("1970-01-01T00:00:00.000Z");
        return { startDate: utcDate(start), endDate: utcDate(end) };
      }
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        throw new AppError(
          "Invalid day range",
          "INVALID_DAY_RANGE",
          "days must be between 1 and 90."
        );
      }
      end = yesterday;
      start = new Date(end);
      start.setUTCDate(start.getUTCDate() - days + 1);
    }
    if (end < start) {
      throw new AppError(
        "Invalid date range",
        "INVALID_DATE_RANGE",
        "end_date must be on or after start_date."
      );
    }
    if (end >= today) {
      throw new AppError(
        "Current-day submissions cannot be exported",
        "CURRENT_DAY_EXPORT_FORBIDDEN",
        `The latest allowed UTC date is ${utcDate(yesterday)}.`
      );
    }
    const span = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (span > 90) {
      throw new AppError(
        "Date range too large",
        "DATE_RANGE_TOO_LARGE",
        "A review export may contain at most 90 UTC days."
      );
    }
    return { startDate: utcDate(start), endDate: utcDate(end) };
  }
}
