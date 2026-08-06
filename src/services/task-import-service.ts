import * as XLSX from "xlsx";
import { AppError } from "../core/errors.js";
import { db } from "../db/database.js";
import type {
  ReviewMode,
  TaskConfig,
  TaskDifficulty,
  TaskStatus,
  TaskType
} from "../core/types.js";
import { TaskService } from "./task-service.js";

type ImportResult = {
  created: string[];
  updated: string[];
};

type ImportedTask = Omit<TaskConfig, "status"> & {
  status?: TaskStatus;
};

const headerAliases: Record<string, string> = {
  taskid: "task_id",
  "task id": "task_id",
  任务id: "task_id",
  任务编号: "task_id",
  标题: "title",
  类型: "type",
  难度: "difficulty",
  描述: "description",
  任务描述: "description",
  积分: "base_points",
  建议积分: "base_points",
  基础积分: "base_points",
  最低积分: "min_points",
  最高积分: "max_points",
  状态: "status",
  审核方式: "review_mode",
  发放方式: "review_mode",
  需要领取: "claim_required",
  允许修改: "revision_allowed",
  每日限制: "per_day",
  每周限制: "per_week",
  每月限制: "per_month",
  赛季限制: "per_season",
  限制: "limits",
  验收标准: "requirements",
  提交字段: "submission_fields",
  ai预审: "ai_precheck",
  预审流程: "precheck_pipeline",
  审核维度: "review_criteria",
  必要证据: "required_evidence",
  淘汰条件: "disqualifiers",
  话题定义: "topic_definition",
  正面示例: "positive_examples",
  反面示例: "negative_examples",
  指定频道: "allowed_channel_ids",
  指定账号: "target_accounts",
  指定帖子: "target_post_ids",
  开始时间: "opens_at",
  截止时间: "closes_at"
};

const normalizeHeader = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return headerAliases[value.trim().toLowerCase()] ??
    headerAliases[normalized.replaceAll("_", " ")] ??
    normalized;
};

const text = (value: unknown): string =>
  value == null ? "" : String(value).trim();

const optionalInteger = (
  value: unknown,
  field: string,
  rowNumber: number
): number | undefined => {
  if (text(value) === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return parsed;
};

const booleanValue = (
  value: unknown,
  defaultValue: boolean
): boolean => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return defaultValue;
  if (["true", "yes", "1", "y", "是"].includes(normalized)) return true;
  if (["false", "no", "0", "n", "否"].includes(normalized)) return false;
  throw new Error(`invalid boolean value "${text(value)}"`);
};

const listValue = (value: unknown, fallback: string[] = []): string[] => {
  const normalized = text(value);
  if (!normalized) return fallback;
  return normalized
    .split(/\r?\n|\s*\|\s*|\s*;\s*|\s*；\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T => {
  const raw = text(value);
  const match = allowed.find(
    (candidate) => candidate.toLowerCase() === raw.toLowerCase()
  );
  if (!match) throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  return match;
};

const reviewModeValue = (value: unknown): ReviewMode => {
  const normalized = text(value).toLowerCase();
  const aliases: Record<string, ReviewMode> = {
    auto: "auto",
    automatic: "auto",
    自动: "auto",
    自动发放: "auto",
    human: "human",
    人工: "human",
    人工审核: "human",
    rules_then_human: "rules_then_human",
    rules: "rules_then_human",
    规则预审: "rules_then_human",
    ai_then_human: "ai_then_human",
    ai: "ai_then_human",
    ai预审: "ai_then_human"
  };
  if (!normalized) return "rules_then_human";
  const mode = aliases[normalized];
  if (!mode) {
    throw new Error(
      "review_mode must be auto, human, rules_then_human, or ai_then_human"
    );
  }
  return mode;
};

const parseGenericLimits = (value: unknown): Partial<TaskConfig["limits"]> => {
  const result: Partial<TaskConfig["limits"]> = {};
  const source = text(value).toLowerCase();
  const pattern = /(\d+)\s*(?:\/|per\s+)(day|week|month|season)/g;
  for (const match of source.matchAll(pattern)) {
    const count = Number(match[1]);
    const field = {
      day: "perDay",
      week: "perWeek",
      month: "perMonth",
      season: "perSeason"
    }[match[2]] as keyof TaskConfig["limits"];
    result[field] = count;
  }
  return result;
};

const userFacingFieldsAreEnglish = (values: string[]): boolean =>
  !values.some((value) => /[\u3400-\u9fff]/u.test(value));

export class TaskImportService {
  constructor(private readonly tasks = new TaskService()) {}

  parse(file: Buffer, filename: string, seasonId: string): ImportedTask[] {
    if (!/\.(csv|xlsx|xls)$/i.test(filename)) {
      throw new AppError(
        "Unsupported task file",
        "UNSUPPORTED_TASK_FILE",
        "Upload a .csv, .xlsx, or .xls task file."
      );
    }

    const workbook = XLSX.read(file, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new AppError(
        "Empty workbook",
        "EMPTY_TASK_FILE",
        "The uploaded task file does not contain a worksheet."
      );
    }

    const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      { defval: "" }
    );
    if (!sourceRows.length) {
      throw new AppError(
        "Empty task file",
        "EMPTY_TASK_FILE",
        "The uploaded task file does not contain any task rows."
      );
    }

    const seen = new Set<string>();
    return sourceRows.map((source, index) => {
      const rowNumber = index + 2;
      const row = Object.fromEntries(
        Object.entries(source).map(([key, value]) => [
          normalizeHeader(key),
          value
        ])
      );

      try {
        const id = text(row.task_id).toUpperCase();
        const title = text(row.title);
        const description = text(row.description);
        const requirements = listValue(row.requirements);
        if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(id)) {
          throw new Error(
            "task_id must use 2–32 uppercase letters, numbers, _ or -"
          );
        }
        if (seen.has(id)) throw new Error(`duplicate task_id ${id} in file`);
        seen.add(id);
        if (!title) throw new Error("title is required");
        if (!description) throw new Error("description is required");
        if (
          !userFacingFieldsAreEnglish([title, description, ...requirements])
        ) {
          throw new Error(
            "title, description, and requirements must be written in English"
          );
        }

        const basePoints = optionalInteger(
          row.base_points,
          "base_points",
          rowNumber
        );
        if (!basePoints || basePoints <= 0) {
          throw new Error("base_points must be greater than 0");
        }

        const genericLimits = parseGenericLimits(row.limits);
        const limits = {
          ...genericLimits,
          perDay:
            optionalInteger(row.per_day, "per_day", rowNumber) ??
            genericLimits.perDay,
          perWeek:
            optionalInteger(row.per_week, "per_week", rowNumber) ??
            genericLimits.perWeek,
          perMonth:
            optionalInteger(row.per_month, "per_month", rowNumber) ??
            genericLimits.perMonth,
          perSeason:
            optionalInteger(row.per_season, "per_season", rowNumber) ??
            genericLimits.perSeason
        };
        for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
          if (limits[key] === 0 || limits[key] == null) delete limits[key];
        }

        const reviewMode = reviewModeValue(row.review_mode);
        const aiPrecheck =
          booleanValue(row.ai_precheck, reviewMode === "ai_then_human");
        const pluginIds =
          reviewMode === "auto"
            ? []
            : [
                "rule_based_precheck",
                ...(aiPrecheck ? ["ai_webhook_precheck"] : [])
              ];

        return {
          id,
          seasonId,
          title,
          type: enumValue(
            row.type,
            ["Daily", "Social", "Community", "Contribute"] as const,
            "type"
          ) as TaskType,
          difficulty: enumValue(
            row.difficulty,
            ["Quick", "Standard", "Advanced", "Bounty"] as const,
            "difficulty"
          ) as TaskDifficulty,
          description,
          basePoints,
          minPoints: optionalInteger(row.min_points, "min_points", rowNumber),
          maxPoints: optionalInteger(row.max_points, "max_points", rowNumber),
          status: text(row.status)
            ? enumValue(
                row.status,
                ["Draft", "Published", "Paused", "Closed", "Archived"] as const,
                "status"
              )
            : undefined,
          reviewMode,
          claimRequired: booleanValue(row.claim_required, false),
          revisionAllowed: booleanValue(row.revision_allowed, true),
          limits,
          requirements,
          submissionFields: listValue(row.submission_fields, [
            "summary",
            "proof_url",
            "attachment"
          ]),
          pluginIds,
          precheckPipeline: text(row.precheck_pipeline) || undefined,
          reviewCriteria: listValue(row.review_criteria, requirements),
          requiredEvidence: listValue(row.required_evidence),
          disqualifiers: listValue(row.disqualifiers),
          topicDefinition: text(row.topic_definition) || undefined,
          positiveExamples: listValue(row.positive_examples),
          negativeExamples: listValue(row.negative_examples),
          allowedChannelIds: listValue(row.allowed_channel_ids),
          targetAccounts: listValue(row.target_accounts),
          targetPostIds: listValue(row.target_post_ids),
          opensAt: text(row.opens_at) || undefined,
          closesAt: text(row.closes_at) || undefined
        };
      } catch (error) {
        throw new AppError(
          `Invalid task row ${rowNumber}`,
          "INVALID_TASK_ROW",
          `Row ${rowNumber}: ${
            error instanceof Error ? error.message : "invalid task data"
          }.`
        );
      }
    });
  }

  apply(
    imported: ImportedTask[],
    seasonId: string,
    actorId: string
  ): ImportResult {
    const applyAll = db.transaction(() => {
      const result: ImportResult = { created: [], updated: [] };
      for (const task of imported) {
        const current = this.tasks.find(task.id, seasonId);
        const config: TaskConfig = {
          ...task,
          seasonId,
          status: task.status ?? current?.status ?? "Draft"
        };
        if (current) {
          this.tasks.update(task.id, seasonId, config, actorId);
          result.updated.push(task.id);
        } else {
          this.tasks.create(config, actorId);
          result.created.push(task.id);
        }
      }
      return result;
    });
    return applyAll();
  }
}
