import { PointsRepository } from "../db/points-repository.js";

const levels = [
  { level: 10, min: 3200, title: "Expert" },
  { level: 9, min: 2400, title: "Contributor" },
  { level: 8, min: 1800, title: "Contributor" },
  { level: 7, min: 1300, title: "Contributor" },
  { level: 6, min: 1000, title: "Supporter" },
  { level: 5, min: 700, title: "Supporter" },
  { level: 4, min: 450, title: "Supporter" },
  { level: 3, min: 250, title: "Explorer" },
  { level: 2, min: 100, title: "Explorer" },
  { level: 1, min: 0, title: "Explorer" }
];

export class PointsService {
  constructor(private readonly points = new PointsRepository()) {}

  profile(seasonId: string, userId: string) {
    const total = this.points.total(seasonId, userId);
    const current = levels.find((item) => total >= item.min)!;
    const next = [...levels].reverse().find((item) => item.min > total);
    return {
      total,
      level: current.level,
      title: current.title,
      currentLevelStart: current.min,
      nextLevel: next?.level,
      nextAt: next?.min,
      remaining: next ? next.min - total : 0
    };
  }

  leaderboard(seasonId: string, limit = 10) {
    return this.points.leaderboard(seasonId, limit);
  }

  leaderboardAll(seasonId: string) {
    return this.points.leaderboard(seasonId, null);
  }

  adjust(
    seasonId: string,
    userId: string,
    points: number,
    reason: string,
    operatorId: string,
    taskId?: string
  ) {
    return this.points.add({
      seasonId,
      userId,
      taskId,
      basePoints: points,
      multiplier: 1,
      points,
      reason,
      operatorId
    });
  }
}
