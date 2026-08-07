export type TaskType = "Daily" | "Social" | "Community" | "Contribute";
export type TaskDifficulty = "Quick" | "Standard" | "Advanced" | "Bounty";
export type TaskStatus = "Draft" | "Published" | "Paused" | "Closed" | "Archived";
export type ReviewMode =
  | "auto"
  | "human"
  | "rules_then_human"
  | "ai_then_human";

export type SubmissionStatus =
  | "Submitted"
  | "Prechecked"
  | "UnderReview"
  | "RevisionRequired"
  | "Approved"
  | "Rejected"
  | "Appealed";

export interface TaskLimit {
  perDay?: number;
  perWeek?: number;
  perMonth?: number;
  perSeason?: number;
}

export interface TaskConfig {
  id: string;
  seasonId: string;
  title: string;
  titleEn?: string;
  type: TaskType;
  difficulty: TaskDifficulty;
  description: string;
  descriptionEn?: string;
  basePoints: number;
  minPoints?: number;
  maxPoints?: number;
  status: TaskStatus;
  reviewMode: ReviewMode;
  claimRequired: boolean;
  revisionAllowed: boolean;
  limits: TaskLimit;
  requirements: string[];
  submissionFields: string[];
  pluginIds: string[];
  precheckPipeline?: string;
  reviewCriteria?: string[];
  requiredEvidence?: string[];
  disqualifiers?: string[];
  topicDefinition?: string;
  positiveExamples?: string[];
  negativeExamples?: string[];
  allowedChannelIds?: string[];
  targetAccounts?: string[];
  targetPostIds?: string[];
  opensAt?: string;
  closesAt?: string;
  seasonPointsCap?: number;
}

export interface TaskRecord {
  id: string;
  seasonId: string;
  status: TaskStatus;
  currentVersion: number;
  config: TaskConfig;
}

export interface SubmissionInput {
  taskId: string;
  userId: string;
  summary: string;
  proofUrl?: string;
  attachmentUrl?: string;
  structuredData?: Record<string, unknown>;
}

export interface SubmissionRecord extends SubmissionInput {
  id: string;
  seasonId: string;
  taskVersion: number;
  status: SubmissionStatus;
  aiPrecheck?: PrecheckResult;
  reviewerId?: string;
  reviewNote?: string;
  qualityCoefficient?: number;
  finalPoints?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrecheckResult {
  pluginId: string;
  score: number;
  recommendation: "pass" | "review" | "revision";
  flags: string[];
  missingItems: string[];
  reviewQuestions: string[];
  raw?: unknown;
}

export interface ReviewDecision {
  submissionId: string;
  reviewerId: string;
  decision: "approve" | "revision" | "reject";
  note: string;
  qualityCoefficient?: number;
  finalPoints?: number;
}

export interface PointLedgerEntry {
  id: string;
  seasonId: string;
  userId: string;
  taskId?: string;
  submissionId?: string;
  basePoints: number;
  multiplier: number;
  points: number;
  reason: string;
  operatorId: string;
  createdAt: string;
}

export interface PluginContext {
  task: TaskRecord;
  submission: SubmissionRecord;
  recentSubmissionTexts: string[];
}

export interface PrecheckPlugin {
  id: string;
  supports(task: TaskRecord): boolean;
  run(context: PluginContext): Promise<PrecheckResult>;
}
