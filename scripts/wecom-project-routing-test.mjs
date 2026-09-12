import assert from "node:assert/strict";
import {
  normalizeWecomProjectTeams,
  resolveNotificationRouteSnapshot,
  resolveProgressNotificationRoute,
  withWecomMentions,
} from "../server/wecom-project-routing.js";

const teams = normalizeWecomProjectTeams([
  { id: "team-a", name: "项目 A", robotIds: ["robot-a", "robot-a"], mentionUserIds: ["lead-a", "bad id"] },
  { id: "team-b", name: "项目 B", robotIds: ["robot-b"], enabled: false },
  { id: "TEAM-A", name: "重复项目", robotIds: ["robot-x"] },
]);
assert.equal(teams.length, 2);
assert.deepEqual(teams[0].robotIds, ["robot-a"]);
assert.deepEqual(teams[0].mentionUserIds, ["lead-a"]);

const snapshot = resolveNotificationRouteSnapshot({
  actor: { id: "user-1", displayName: "小舟", notificationTeamId: "team-a", wecomUserId: "zhou_01", mentionOnProgress: true },
  projectTeams: teams,
  now: "2026-09-12T00:00:00.000Z",
});
assert.equal(snapshot.teamId, "team-a");
assert.equal(snapshot.submitterWecomUserId, "zhou_01");

const temporarySnapshot = resolveNotificationRouteSnapshot({
  actor: { id: "user-1", notificationTeamId: "team-a" },
  requestedTeamId: "team-b",
  projectTeams: teams,
});
assert.equal(temporarySnapshot.teamId, "team-a", "停用团队不能覆盖用户默认团队");

const globalSnapshot = resolveNotificationRouteSnapshot({
  actor: { id: "user-1", notificationTeamId: "team-a" },
  requestedTeamId: "__global__",
  projectTeams: teams,
});
assert.equal(globalSnapshot.teamId, "", "明确选择全局群时不能再套用用户默认团队");

const route = resolveProgressNotificationRoute({ ticket: { notificationRoute: snapshot }, projectTeams: teams, globalRobotIds: ["global"] });
assert.deepEqual(route.robotIds, ["robot-a"]);
assert.deepEqual(route.mentionUserIds, ["lead-a", "zhou_01"]);
assert.equal(route.fallback, false);

const fallback = resolveProgressNotificationRoute({ ticket: { notificationRoute: { ...snapshot, teamId: "deleted-team", teamName: "旧项目" } }, projectTeams: teams, globalRobotIds: ["global"] });
assert.deepEqual(fallback.robotIds, ["global"]);
assert.equal(fallback.fallback, true);
assert.equal(fallback.routeLabel, "全局运营群");

const legacy = resolveProgressNotificationRoute({ ticket: {}, projectTeams: teams, globalRobotIds: ["global"] });
assert.deepEqual(legacy.robotIds, ["global"]);

const mentioned = withWecomMentions("### 工单有更新", ["zhou_01", "zhou_01", "lead-a", "bad id"]);
assert.match(mentioned, /^请关注：<@zhou_01> <@lead-a>/);
assert.ok(Buffer.byteLength(mentioned, "utf8") <= 4096);

const longChineseMessage = withWecomMentions("进".repeat(5000), ["zhou_01"]);
assert.ok(Buffer.byteLength(longChineseMessage, "utf8") <= 4096, "企业微信按 UTF-8 字节限制消息长度");

console.log("wecom project routing test passed");
