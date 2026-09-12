function cleanText(value, maxLength = 128) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeWecomUserId(value) {
  const userId = cleanText(value);
  return /^[A-Za-z0-9._@-]{1,128}$/.test(userId) ? userId : "";
}

function uniqueTextList(value, normalizer = (item) => cleanText(item)) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizer).filter(Boolean))];
}

function truncateUtf8(value, maxBytes) {
  const input = String(value || "");
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input;
  let output = "";
  let byteLength = 0;
  for (const character of input) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + characterBytes > maxBytes) break;
    output += character;
    byteLength += characterBytes;
  }
  return output;
}

export function normalizeWecomProjectTeams(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((team) => {
    const rawId = cleanText(team?.id, 64).toLowerCase();
    const id = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(rawId) ? rawId : "";
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      name: cleanText(team?.name, 60),
      enabled: team?.enabled !== false,
      robotIds: uniqueTextList(team?.robotIds, (item) => cleanText(item, 128)),
      mentionUserIds: uniqueTextList(team?.mentionUserIds, normalizeWecomUserId),
    };
  }).filter((team) => team?.name);
}

export function normalizeNotificationRouteSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const teamId = cleanText(value.teamId, 64).toLowerCase();
  return {
    teamId: /^[a-z0-9][a-z0-9_-]{0,63}$/.test(teamId) ? teamId : "",
    teamName: cleanText(value.teamName, 60),
    submitterUserId: cleanText(value.submitterUserId, 128),
    submitterName: cleanText(value.submitterName, 80),
    submitterWecomUserId: normalizeWecomUserId(value.submitterWecomUserId),
    mentionSubmitter: value.mentionSubmitter !== false,
    resolvedAt: cleanText(value.resolvedAt, 40),
  };
}

export function resolveNotificationRouteSnapshot({ actor = {}, requestedTeamId = "", projectTeams = [], now = new Date().toISOString() } = {}) {
  const teams = normalizeWecomProjectTeams(projectTeams);
  const requested = cleanText(requestedTeamId, 64).toLowerCase();
  const defaultTeamId = cleanText(actor.notificationTeamId, 64).toLowerCase();
  const forceGlobal = requested === "__global__";
  const team = forceGlobal ? null : teams.find((item) => item.enabled && item.id === requested)
    || teams.find((item) => item.enabled && item.id === defaultTeamId)
    || null;
  return {
    teamId: team?.id || "",
    teamName: team?.name || "",
    submitterUserId: cleanText(actor.id, 128),
    submitterName: cleanText(actor.displayName || actor.username, 80),
    submitterWecomUserId: normalizeWecomUserId(actor.wecomUserId),
    mentionSubmitter: actor.mentionOnProgress !== false,
    resolvedAt: cleanText(now, 40),
  };
}

export function resolveProgressNotificationRoute({ ticket = {}, projectTeams = [], globalRobotIds = [] } = {}) {
  const snapshot = normalizeNotificationRouteSnapshot(ticket.notificationRoute);
  const teams = normalizeWecomProjectTeams(projectTeams);
  const team = snapshot?.teamId ? teams.find((item) => item.id === snapshot.teamId && item.enabled) : null;
  const teamRobotIds = uniqueTextList(team?.robotIds, (item) => cleanText(item, 128));
  const useTeam = Boolean(team && teamRobotIds.length);
  const mentionUserIds = uniqueTextList([
    ...(useTeam ? team.mentionUserIds : []),
    ...(snapshot?.mentionSubmitter && snapshot.submitterWecomUserId ? [snapshot.submitterWecomUserId] : []),
  ], normalizeWecomUserId);
  return {
    robotIds: useTeam ? teamRobotIds : uniqueTextList(globalRobotIds, (item) => cleanText(item, 128)),
    mentionUserIds,
    teamId: useTeam ? team.id : snapshot?.teamId || "",
    teamName: useTeam ? team.name : snapshot?.teamName || "",
    routeLabel: useTeam ? `项目群：${team.name}` : "全局运营群",
    fallback: !useTeam,
  };
}

export function withWecomMentions(content, mentionUserIds = []) {
  const ids = uniqueTextList(mentionUserIds, normalizeWecomUserId);
  const body = String(content || "").trim();
  if (!ids.length) return truncateUtf8(body, 4096);
  const mentionLine = `请关注：${ids.map((id) => `<@${id}>`).join(" ")}`;
  const separator = "\n\n";
  const maxBodyBytes = Math.max(0, 4096 - Buffer.byteLength(mentionLine + separator, "utf8"));
  return `${mentionLine}${separator}${truncateUtf8(body, maxBodyBytes)}`;
}
