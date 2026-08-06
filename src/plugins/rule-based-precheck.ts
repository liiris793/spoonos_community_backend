import type {
  PluginContext,
  PrecheckPlugin,
  PrecheckResult
} from "../core/types.js";

const normalize = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

function similarity(a: string, b: string): number {
  const aWords = new Set(normalize(a).split(" "));
  const bWords = new Set(normalize(b).split(" "));
  if (!aWords.size || !bWords.size) return 0;
  const intersection = [...aWords].filter((word) => bWords.has(word)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return intersection / union;
}

export class RuleBasedPrecheckPlugin implements PrecheckPlugin {
  id = "rule_based_precheck";

  supports(): boolean {
    return true;
  }

  async run(context: PluginContext): Promise<PrecheckResult> {
    const { submission, task, recentSubmissionTexts } = context;
    const flags: string[] = [];
    const missingItems: string[] = [];
    const reviewQuestions: string[] = [];
    let score = 100;

    const minimumLength =
      task.config.difficulty === "Advanced" || task.config.difficulty === "Bounty"
        ? 180
        : 60;
    if (submission.summary.trim().length < minimumLength) {
      score -= 25;
      flags.push("summary_too_short");
      missingItems.push(
        `The submission summary should contain at least ${minimumLength} characters`
      );
    }

    if (
      task.config.requirements.some((item) =>
        /截图|录屏|Demo|链接|证明|source|evidence/i.test(item)
      ) &&
      !submission.proofUrl &&
      !submission.attachmentUrl
    ) {
      score -= 30;
      flags.push("evidence_missing");
      missingItems.push(
        "A link, screenshot, demo, or other supporting evidence is missing"
      );
    }

    const highestSimilarity = Math.max(
      0,
      ...recentSubmissionTexts
        .map((text) => similarity(text, submission.summary))
    );
    if (highestSimilarity >= 0.75) {
      score -= 35;
      flags.push("possible_duplicate");
      reviewQuestions.push(
        "This submission is highly similar to previous content. Explain its new value."
      );
    }

    if (
      task.config.difficulty === "Advanced" ||
      task.config.difficulty === "Bounty"
    ) {
      reviewQuestions.push(
        "Describe the real process, final result, and how another member can reproduce it."
      );
    }

    const recommendation =
      score >= 80 ? "pass" : score >= 55 ? "review" : "revision";

    return {
      pluginId: this.id,
      score: Math.max(0, score),
      recommendation,
      flags,
      missingItems,
      reviewQuestions
    };
  }
}
