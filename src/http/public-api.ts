import { createServer, type Server, type ServerResponse } from "node:http";
import type { Client } from "discord.js";
import { config } from "../config.js";
import { db } from "../db/database.js";
import { PointsService } from "../services/points-service.js";
import { TaskService } from "../services/task-service.js";

export type PublicApiDependencies = {
  client: Pick<Client, "isReady" | "users">;
  tasks: TaskService;
  points: PointsService;
};

export type PublicApiOptions = {
  seasonId?: string;
  corsOrigin?: string;
  cacheSeconds?: number;
};

type PublicSeason = {
  id: string;
  name: string;
  endsAt?: string;
};

const responseHeaders = (
  corsOrigin: string,
  cacheSeconds: number
): Record<string, string> => ({
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": corsOrigin,
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  vary: "Origin"
});

const json = (
  response: ServerResponse,
  status: number,
  value: unknown,
  corsOrigin: string,
  cacheSeconds: number,
  headOnly = false
): void => {
  response.writeHead(status, responseHeaders(corsOrigin, cacheSeconds));
  response.end(headOnly ? undefined : JSON.stringify(value));
};

const publicSeason = (seasonId: string): PublicSeason => {
  const row = db
    .prepare(
      `SELECT id, name, ends_at AS endsAt
       FROM seasons WHERE id = ?`
    )
    .get(seasonId) as PublicSeason | undefined;
  return (
    row ?? {
      id: seasonId,
      name: "SpoonOS Community Contribution Program · Season 2"
    }
  );
};

const publicTasks = (tasks: TaskService, seasonId: string) =>
  tasks.listPublished(seasonId).map((task) => ({
    id: task.id,
    title: task.config.title,
    type: task.config.type,
    difficulty: task.config.difficulty,
    description: task.config.description,
    points: task.config.basePoints,
    minPoints: task.config.minPoints,
    maxPoints: task.config.maxPoints,
    claimRequired: task.config.claimRequired,
    limits: task.config.limits,
    requirements: task.config.requirements,
    closesAt: task.config.closesAt
  }));

const publicLeaderboard = async (
  { client, points }: PublicApiDependencies,
  seasonId: string
) => {
  const board = points.leaderboard(seasonId, 10);
  return Promise.all(
    board.map(async (entry) => {
      const profile = points.profile(seasonId, entry.userId);
      const publicProfile = db.prepare(
        `SELECT display_name AS displayName, avatar_url AS avatarUrl
         FROM public_profiles WHERE season_id = ? AND user_id = ?`
      ).get(seasonId, entry.userId) as
        | { displayName: string; avatarUrl: string | null }
        | undefined;
      let name = publicProfile?.displayName ?? `Member ${entry.userId.slice(-4)}`;
      let avatarUrl = publicProfile?.avatarUrl ?? undefined;
      if (!publicProfile && client.isReady()) {
        try {
          const user = await client.users.fetch(entry.userId);
          name = user.globalName ?? user.username;
          avatarUrl = user.displayAvatarURL({ extension: "png", size: 128 });
        } catch {
          // Discord lookup failure must not hide the points leaderboard.
        }
      }
      return {
        rank: entry.rank,
        userId: entry.userId,
        name,
        avatarUrl,
        points: entry.points,
        level: profile.level,
        role: profile.title,
        currentLevelStart: profile.currentLevelStart,
        nextLevelAt: profile.nextAt ?? profile.total,
        remaining: profile.remaining
      };
    })
  );
};

export function createPublicApiServer(
  dependencies: PublicApiDependencies,
  options: PublicApiOptions = {}
): Server {
  const seasonId = options.seasonId ?? config.defaultSeasonId;
  const corsOrigin = options.corsOrigin ?? config.portalCorsOrigin;
  const cacheSeconds = options.cacheSeconds ?? 30;

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "OPTIONS") {
      response.writeHead(204, responseHeaders(corsOrigin, cacheSeconds));
      response.end();
      return;
    }
    const headOnly = request.method === "HEAD";
    if (request.method !== "GET" && !headOnly) {
      json(
        response,
        405,
        { error: "method_not_allowed" },
        corsOrigin,
        cacheSeconds
      );
      return;
    }

    try {
      if (url.pathname === "/health") {
        json(
          response,
          200,
          { ok: true, service: "spoonos-community-api" },
          corsOrigin,
          0,
          headOnly
        );
        return;
      }
      if (
        !["/api/portal", "/api/tasks", "/api/leaderboard"].includes(
          url.pathname
        )
      ) {
        json(
          response,
          404,
          { error: "not_found" },
          corsOrigin,
          cacheSeconds,
          headOnly
        );
        return;
      }

      const base = {
        source: "live" as const,
        updatedAt: new Date().toISOString(),
        season: publicSeason(seasonId)
      };
      if (url.pathname === "/api/tasks") {
        json(
          response,
          200,
          { ...base, tasks: publicTasks(dependencies.tasks, seasonId) },
          corsOrigin,
          cacheSeconds,
          headOnly
        );
        return;
      }
      if (url.pathname === "/api/leaderboard") {
        json(
          response,
          200,
          {
            ...base,
            leaderboard: await publicLeaderboard(dependencies, seasonId)
          },
          corsOrigin,
          cacheSeconds,
          headOnly
        );
        return;
      }
      json(
        response,
        200,
        {
          ...base,
          tasks: publicTasks(dependencies.tasks, seasonId),
          leaderboard: await publicLeaderboard(dependencies, seasonId)
        },
        corsOrigin,
        cacheSeconds,
        headOnly
      );
    } catch (error) {
      console.error("Public API request failed", error);
      json(
        response,
        500,
        { error: "internal_server_error" },
        corsOrigin,
        0,
        headOnly
      );
    }
  });
}

export function startPublicApi(
  dependencies: PublicApiDependencies
): Server {
  const server = createPublicApiServer(dependencies);
  server.listen(config.publicApiPort, config.publicApiHost, () => {
    console.log(
      `Public portal API listening on ${config.publicApiHost}:${config.publicApiPort}`
    );
  });
  return server;
}
