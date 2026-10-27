import { isIP } from "node:net";

function normalizedIp(value) {
  let candidate = String(value || "").trim();
  if (!candidate) return "";
  if (candidate.startsWith("[") && candidate.includes("]")) candidate = candidate.slice(1, candidate.indexOf("]"));
  if (isIP(candidate)) return candidate;
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort && isIP(ipv4WithPort[1]) ? ipv4WithPort[1] : "";
}

export function clientIp(req) {
  const realIp = normalizedIp(req?.headers?.["x-real-ip"]);
  if (realIp) return realIp;
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",").map(normalizedIp).filter(Boolean);
  if (forwarded.length) return forwarded.at(-1);
  return normalizedIp(req?.socket?.remoteAddress);
}
