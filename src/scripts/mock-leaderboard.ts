import { db, migrate } from "../db/database.js";
import { seed } from "./seed.js";

const seasonId = "season-2";

const members = [
  { userId: "990000000000000001", name: "NovaByte", points: 2680, colors: ["#3B82F6", "#8B5CF6"] },
  { userId: "990000000000000002", name: "AgentMira", points: 2140, colors: ["#06B6D4", "#3B82F6"] },
  { userId: "990000000000000003", name: "ChainFox", points: 1720, colors: ["#F97316", "#EF4444"] },
  { userId: "990000000000000004", name: "PixelPilot", points: 1290, colors: ["#8B5CF6", "#EC4899"] },
  { userId: "990000000000000005", name: "LunaStack", points: 1050, colors: ["#6366F1", "#0EA5E9"] },
  { userId: "990000000000000006", name: "EchoBuild", points: 840, colors: ["#10B981", "#06B6D4"] },
  { userId: "990000000000000007", name: "DataNomad", points: 620, colors: ["#0EA5E9", "#2563EB"] },
  { userId: "990000000000000008", name: "PromptSmith", points: 460, colors: ["#F59E0B", "#F97316"] },
  { userId: "990000000000000009", name: "OrbitDev", points: 310, colors: ["#14B8A6", "#22C55E"] },
  { userId: "990000000000000010", name: "BlueSpoon", points: 220, colors: ["#2563EB", "#7C3AED"] }
] as const;

const avatar = (name: string, colors: readonly [string, string]): string => {
  const initials = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="128" height="128" rx="64" fill="url(#g)"/><circle cx="96" cy="30" r="22" fill="white" opacity=".12"/><text x="64" y="72" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="Arial,sans-serif" font-size="38" font-weight="700">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

migrate();
seed();

if (process.argv.includes("--clear")) {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM point_ledger WHERE id LIKE 'mock_lb_%'").run();
    db.prepare(
      "DELETE FROM public_profiles WHERE season_id = ? AND is_test = 1"
    ).run(seasonId);
  });
  transaction();
  console.log("Mock leaderboard users removed.");
  process.exit(0);
}

const transaction = db.transaction(() => {
  const upsertProfile = db.prepare(
    `INSERT INTO public_profiles
      (season_id, user_id, display_name, avatar_url, is_test, updated_at)
     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(season_id, user_id) DO UPDATE SET
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       is_test = 1,
       updated_at = CURRENT_TIMESTAMP`
  );
  const upsertPoints = db.prepare(
    `INSERT INTO point_ledger
      (id, season_id, user_id, task_id, submission_id, base_points,
       multiplier, points, reason, operator_id)
     VALUES (?, ?, ?, NULL, NULL, ?, 1, ?, 'Mock leaderboard fixture', 'test-seed')
     ON CONFLICT(id) DO UPDATE SET
       base_points = excluded.base_points,
       points = excluded.points`
  );
  for (const [index, member] of members.entries()) {
    upsertProfile.run(
      seasonId,
      member.userId,
      member.name,
      avatar(member.name, member.colors)
    );
    upsertPoints.run(
      `mock_lb_${String(index + 1).padStart(2, "0")}`,
      seasonId,
      member.userId,
      member.points,
      member.points
    );
  }
});
transaction();

console.log(`Mock leaderboard ready with ${members.length} users.`);
