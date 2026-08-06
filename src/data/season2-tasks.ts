import type {
  ReviewMode,
  TaskConfig,
  TaskDifficulty,
  TaskLimit,
  TaskType
} from "../core/types.js";

type SeedTask = {
  id: string;
  type: TaskType;
  difficulty: TaskDifficulty;
  title: string;
  points: number;
  description: string;
  requirements: string[];
  limits?: TaskLimit;
  reviewMode?: ReviewMode;
  claimRequired?: boolean;
  minPoints?: number;
  maxPoints?: number;
  plugins?: string[];
};

const pipelineByTaskId: Record<string, string> = {
  T001: "daily_activity_v1",
  T002: "platform_proof_v1",
  T003: "invite_retention_v1",
  T004: "longform_content_v1",
  T005: "proposal_v1",
  T006: "shared_content_v1",
  T007: "community_help_v1",
  T008: "bug_report_v1",
  T009: "social_content_v1",
  T010: "social_content_v1",
  T011: "platform_proof_v1",
  T012: "social_interaction_v1",
  T013: "platform_proof_v1",
  T014: "platform_proof_v1",
  T015: "community_help_v1",
  T016: "community_event_v1",
  T017: "community_recap_v1",
  T018: "proposal_v1",
  T019: "longform_content_v1",
  T020: "longform_content_v1",
  T021: "technical_deliverable_v1",
  T022: "social_interaction_v1",
  T023: "proposal_v1"
};

const task = (input: SeedTask): TaskConfig => ({
  id: input.id,
  seasonId: "season-2",
  title: input.title,
  type: input.type,
  difficulty: input.difficulty,
  description: input.description,
  basePoints: input.points,
  minPoints: input.minPoints,
  maxPoints: input.maxPoints,
  status: "Draft",
  reviewMode: input.reviewMode ?? "rules_then_human",
  claimRequired: input.claimRequired ?? false,
  revisionAllowed: true,
  limits: input.limits ?? {},
  requirements: input.requirements,
  submissionFields: ["summary", "proof_url", "attachment"],
  pluginIds:
    input.plugins ??
    (input.difficulty === "Advanced" || input.difficulty === "Bounty"
      ? ["rule_based_precheck", "ai_webhook_precheck"]
      : ["rule_based_precheck"]),
  precheckPipeline: pipelineByTaskId[input.id] ?? "generic_submission_v1",
  reviewCriteria: input.requirements,
  requiredEvidence: input.requirements.filter((item) =>
    /source|link|screenshot|recording|demo|code|steps|environment|checklist/i.test(
      item
    )
  ),
  disqualifiers: input.requirements.filter((item) =>
    /do not qualify|no rewards|no alternate|meaningless|spam|duplicate/i.test(
      item
    )
  ),
  ...(input.id === "T001"
    ? {
        topicDefinition:
          "Meaningful discussion about SpoonOS, AI, agents, technical development, product use, community questions, and current official discussion topics.",
        positiveExamples: [
          "A concrete technical question or actionable answer",
          "A relevant insight with reasoning or a real example",
          "A product experience, issue, or workflow discussion"
        ],
        negativeExamples: [
          "GM, GN, hello, nice, thanks, or agreement without substance",
          "Emoji-only, link-only, advertising, or repeated messages",
          "Generic AI text unrelated to the active channel topic"
        ]
      }
    : {})
});

export const season2Tasks: TaskConfig[] = [
  task({
    id: "T001",
    type: "Daily",
    difficulty: "Quick",
    title: "Daily Community Activity",
    points: 20,
    description: "Post at least five meaningful messages related to active community topics in one day.",
    requirements: ["No duplicates, sentence splitting, or emoji spam", "No advertising, scams, or meaningless messages"],
    limits: { perDay: 1, perWeek: 5 },
    reviewMode: "auto",
    plugins: []
  }),
  task({
    id: "T002",
    type: "Social",
    difficulty: "Quick",
    title: "Follow the Official X Account",
    points: 20,
    description: "Follow the official SpoonOS X account and submit verifiable evidence.",
    requirements: ["The account must be public", "The screenshot must show the account identity", "One reward per account"],
    limits: { perSeason: 1 }
  }),
  task({
    id: "T003",
    type: "Community",
    difficulty: "Standard",
    title: "Invite an Active New Member",
    points: 80,
    description: "Invite a real new member who remains active in the community.",
    requirements: ["Member for at least seven days", "Reach Lv.3", "Meaningful activity on at least three days", "No alternate accounts or reciprocal farming"],
    limits: { perWeek: 2, perSeason: 5 },
    claimRequired: true
  }),
  task({
    id: "T004",
    type: "Contribute",
    difficulty: "Advanced",
    title: "Create High-Quality Content",
    points: 160,
    minPoints: 120,
    maxPoints: 200,
    description: "Create an original tutorial, use case, technical study, or best-practice guide.",
    requirements: ["Original and relevant to the Spoon ecosystem", "Complete structure", "Reproducible or actionable", "Sources and evidence included"],
    limits: { perWeek: 1, perSeason: 4 }
  }),
  task({
    id: "T005",
    type: "Contribute",
    difficulty: "Standard",
    title: "Submit a Product Improvement Proposal",
    points: 60,
    description: "Submit a product proposal covering the problem, solution, expected impact, and scope.",
    requirements: ["Describe a specific problem", "Provide an actionable solution", "Duplicate proposals do not qualify", "Adoption bonuses are added through the point ledger"],
    limits: { perWeek: 2 },
    reviewMode: "ai_then_human",
    plugins: ["rule_based_precheck", "ai_webhook_precheck"]
  }),
  task({
    id: "T006",
    type: "Community",
    difficulty: "Standard",
    title: "Share Valuable AI or Technical Content",
    points: 30,
    description: "Share valuable AI or technical content with its source and your own summary.",
    requirements: ["Include the original source", "Add your own perspective", "Link-only posts, ads, and duplicates do not qualify"],
    limits: { perWeek: 3 },
    reviewMode: "ai_then_human",
    plugins: ["rule_based_precheck", "ai_webhook_precheck"]
  }),
  task({
    id: "T007",
    type: "Contribute",
    difficulty: "Standard",
    title: "Answer a Community Technical Question",
    points: 60,
    minPoints: 40,
    maxPoints: 80,
    description: "Provide a specific and actionable technical answer to a community member.",
    requirements: ["Link the question and answer messages", "The answer must be actionable", "Confirmed by the asker or reviewed by an administrator"],
    limits: { perWeek: 3 }
  }),
  task({
    id: "T008",
    type: "Contribute",
    difficulty: "Bounty",
    title: "Submit a Valid Bug Report",
    points: 200,
    minPoints: 100,
    maxPoints: 400,
    description: "Find and report a reproducible product bug. Points depend on severity.",
    requirements: ["Reproduction steps", "Expected and actual behavior", "Environment details", "Screenshot or recording", "Duplicates and known issues do not qualify"],
    limits: { perSeason: 5 }
  }),
  task({
    id: "T009",
    type: "Contribute",
    difficulty: "Standard",
    title: "Complete the Agent Personality Test",
    points: 80,
    description: "Complete the test and publicly share an authentic reflection.",
    requirements: ["Result screenshot", "Original reflection", "Public community post or X link"],
    limits: { perSeason: 1 }
  }),
  task({
    id: "T010",
    type: "Contribute",
    difficulty: "Standard",
    title: "Experience SpoonOS Arena and Share",
    points: 100,
    description: "Use SpoonOS Arena and publish an original experience post.",
    requirements: ["Experience screenshot", "Public link", "Original written content"],
    limits: { perSeason: 1 }
  }),
  task({
    id: "T011",
    type: "Community",
    difficulty: "Quick",
    title: "Participate in an Official Community Poll",
    points: 10,
    description: "Complete a designated official community poll.",
    requirements: ["One reward per official poll", "No rewards through multiple accounts"],
    limits: { perWeek: 1 },
    reviewMode: "rules_then_human"
  }),
  task({
    id: "T012",
    type: "Social",
    difficulty: "Quick",
    title: "Repost a Designated Official X Post",
    points: 15,
    description: "Repost designated official content from a public account.",
    requirements: ["The account and post must be verifiable", "Points may be deducted if the post is deleted"],
    limits: { perWeek: 2 },
    reviewMode: "ai_then_human",
    plugins: ["rule_based_precheck", "ai_webhook_precheck"]
  }),
  task({
    id: "T013",
    type: "Social",
    difficulty: "Quick",
    title: "Follow the Official Reddit Account",
    points: 20,
    description: "Follow the official Reddit account and submit a verifiable screenshot.",
    requirements: ["The screenshot must be verifiable", "One reward per account"],
    limits: { perSeason: 1 }
  }),
  task({
    id: "T014",
    type: "Community",
    difficulty: "Quick",
    title: "Complete Community Onboarding",
    points: 20,
    description: "Complete the rules confirmation, role selection, and task-center onboarding.",
    requirements: ["Read the rules", "Select a role", "Visit the task, submission, and leaderboard entry points"],
    limits: { perSeason: 1 },
    reviewMode: "rules_then_human"
  }),
  task({
    id: "T015",
    type: "Community",
    difficulty: "Standard",
    title: "Help a New Member Solve a Problem",
    points: 30,
    description: "Help a new member resolve a real community or product problem.",
    requirements: ["Provide the message link", "The answer must resolve the problem", "Greetings and non-substantive replies do not qualify"],
    limits: { perWeek: 2 }
  }),
  task({
    id: "T016",
    type: "Community",
    difficulty: "Advanced",
    title: "Host a Community Topic Discussion",
    points: 100,
    description: "Prepare a topic, host an active discussion, and submit a recap.",
    requirements: ["Submit the topic and outline in advance", "Actively host the discussion", "Submit a recap and discussion link"],
    limits: { perWeek: 1 },
    claimRequired: true
  }),
  task({
    id: "T017",
    type: "Community",
    difficulty: "Standard",
    title: "Create the Weekly Community Recap",
    points: 60,
    description: "Summarize the week's discussions, content, product updates, and notable contributions.",
    requirements: ["Include original source links", "Do not simply copy content", "Only one contributor can complete it each week"],
    limits: { perWeek: 1 },
    claimRequired: true
  }),
  task({
    id: "T018",
    type: "Contribute",
    difficulty: "Advanced",
    title: "Submit a Product Experience Report",
    points: 120,
    minPoints: 80,
    maxPoints: 150,
    description: "Submit a structured report based on a real product-use process.",
    requirements: ["Use scenario", "Complete workflow", "Problems, strengths, and weaknesses", "Specific recommendations", "Screenshot or recording"],
    limits: { perMonth: 2 }
  }),
  task({
    id: "T019",
    type: "Contribute",
    difficulty: "Advanced",
    title: "Create a Reproducible SpoonOS Use Case",
    points: 150,
    description: "Create a real SpoonOS use case that another member can reproduce.",
    requirements: ["Scenario and objective", "Usage steps", "Final result", "Screenshot or demo", "Practical value"],
    limits: { perMonth: 2 }
  }),
  task({
    id: "T020",
    type: "Contribute",
    difficulty: "Advanced",
    title: "Improve Community FAQ or Product Documentation",
    points: 120,
    minPoints: 80,
    maxPoints: 150,
    description: "Add to or correct the community FAQ or product documentation.",
    requirements: ["Accurate content", "Clear structure", "Identify additions or changes", "Duplicates and formatting-only edits do not qualify"],
    claimRequired: true
  }),
  task({
    id: "T021",
    type: "Contribute",
    difficulty: "Bounty",
    title: "Build a Skill, Demo, or Automation Workflow",
    points: 300,
    minPoints: 200,
    maxPoints: 400,
    description: "Build a working technical deliverable for an official bounty.",
    requirements: ["Working project or code", "Installation instructions", "Demo", "Test results", "Known limitations"],
    limits: { perSeason: 2 },
    claimRequired: true
  }),
  task({
    id: "T022",
    type: "Social",
    difficulty: "Standard",
    title: "Publish an Original Product Use Case on X",
    points: 80,
    description: "Publish an original X post based on a real product experience.",
    requirements: ["Publicly visible", "Original perspective", "Product screenshot or demo", "Mention the official account and campaign tag"],
    limits: { perWeek: 1 },
    reviewMode: "ai_then_human",
    plugins: ["rule_based_precheck", "ai_webhook_precheck"]
  }),
  task({
    id: "T023",
    type: "Contribute",
    difficulty: "Advanced",
    title: "Join Product Beta Testing and Submit a Report",
    points: 150,
    minPoints: 100,
    maxPoints: 200,
    description: "Complete the assigned beta-testing checklist and submit a structured report.",
    requirements: ["Complete the testing checklist", "Submit issues and recommendations", "Screenshots", "Overall evaluation"],
    limits: { perSeason: 2 },
    claimRequired: true
  })
];
