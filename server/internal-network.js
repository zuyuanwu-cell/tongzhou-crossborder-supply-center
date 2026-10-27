function text(value) {
  return String(value ?? "").trim();
}

function normalizeAddress(value) {
  const address = text(value).toLowerCase();
  if (address.startsWith("::ffff:")) return address.slice(7);
  if (address === "0:0:0:0:0:0:0:1") return "::1";
  return address;
}

function ipv4Number(value) {
  const parts = normalizeAddress(value).split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result >>> 0;
}

function matchesCidr(address, entry) {
  const normalizedAddress = normalizeAddress(address);
  const [networkValue, prefixValue] = text(entry).split("/");
  const network = normalizeAddress(networkValue);
  if (!network) return false;
  if (network === "::1") return normalizedAddress === "::1" && (prefixValue === undefined || prefixValue === "128");
  const addressNumber = ipv4Number(normalizedAddress);
  const networkNumber = ipv4Number(network);
  if (addressNumber === null || networkNumber === null) return false;
  const prefix = prefixValue === undefined ? 32 : Number(prefixValue);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressNumber & mask) === (networkNumber & mask);
}

export function parseInternalApiAllowedCidrs(value) {
  return Array.from(new Set(text(value).split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)));
}

export function isInternalApiSourceAllowed(req, allowedCidrs = []) {
  const socketAddress = normalizeAddress(req?.socket?.remoteAddress);
  const proxiedAddress = socketAddress === "127.0.0.1" || socketAddress === "::1"
    ? normalizeAddress(req?.headers?.["x-real-ip"])
    : "";
  const address = proxiedAddress || socketAddress;
  if (!address || !Array.isArray(allowedCidrs) || !allowedCidrs.length) return false;
  return allowedCidrs.some((entry) => matchesCidr(address, entry));
}

export function isInternalApiPath(pathname) {
  const path = text(pathname);
  return path === "/api/internal" || path.startsWith("/api/internal/");
}
