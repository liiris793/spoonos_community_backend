import { describe, expect, it } from "vitest";
import { commands } from "../src/discord/commands.js";
import {
  ANNOUNCEMENT_COLOR,
  announcementEmbed,
  parseAnnouncementMarkdown
} from "../src/discord/presenters.js";

describe("community announcement", () => {
  it("uses English command descriptions and excludes appeal commands", () => {
    expect(commands.map((command) => command.name)).not.toContain("appeal");
    expect(commands.map((command) => command.name)).not.toContain("appeal-admin");

    const assertEnglishDescriptions = (
      items: Array<{ description?: string; options?: unknown[] }> = []
    ) => {
      for (const item of items) {
        if (item.description) {
          expect(item.description).not.toMatch(/[\u3400-\u9fff]/u);
        }
        if (item.options) {
          assertEnglishDescriptions(
            item.options as Array<{ description?: string; options?: unknown[] }>
          );
        }
      }
    };

    assertEnglishDescriptions(commands);
  });

  it("places required command options before optional options", () => {
    const assertOptionOrder = (
      options: Array<{ required?: boolean; options?: unknown[]; name: string }> = []
    ) => {
      let optionalSeen = false;
      for (const option of options) {
        if (option.required === false) optionalSeen = true;
        if (option.required === true) expect(optionalSeen).toBe(false);
        if (option.options) {
          assertOptionOrder(
            option.options as Array<{
              required?: boolean;
              options?: unknown[];
              name: string;
            }>
          );
        }
      }
    };

    for (const command of commands) {
      assertOptionOrder(command.options);
    }
  });

  it("registers an admin-only announce command", () => {
    const command = commands.find((item) => item.name === "announce");
    expect(command).toBeDefined();
    expect(command?.default_member_permissions).toBeDefined();
    expect(command?.options?.map((option) => option.name)).toEqual([
      "title",
      "content",
      "content_file",
      "channel",
      "link",
      "image",
      "mention_everyone"
    ]);
  });

  it("creates a purple Discord embed", () => {
    const embed = announcementEmbed({
      title: "Season 2 Update",
      content: "New community tasks are now available.",
      link: "https://example.com/tasks",
      imageUrl: "https://example.com/update.png"
    }).toJSON();

    expect(embed.color).toBe(ANNOUNCEMENT_COLOR);
    expect(embed.title).toBe("Season 2 Update");
    expect(embed.description).toBe("New community tasks are now available.");
    expect(embed.url).toBe("https://example.com/tasks");
    expect(embed.image?.url).toBe("https://example.com/update.png");
  });

  it("turns markdown headings into structured embed fields", () => {
    const content = [
      "Season 2 is now live.",
      "",
      "## 📅 Duration",
      "August 10 – September 30",
      "",
      "## 🏆 Rewards",
      "Top contributors receive season rewards."
    ].join("\n");
    const parsed = parseAnnouncementMarkdown(content);
    const embed = announcementEmbed({
      title: "Season 2 Update",
      content
    }).toJSON();

    expect(parsed.summary).toBe("Season 2 is now live.");
    expect(embed.fields?.map((field) => field.name)).toEqual([
      "📅 Duration",
      "🏆 Rewards"
    ]);
  });
});
