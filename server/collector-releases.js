// 同舟智数自动更新：保存发版脚本上传的更新包，按「先试跑、再全部」的节奏告诉各节点该更新到哪个版本。
// 更新包必须带 Ed25519 签名（私钥只在打包电脑上，公钥在仓库 desktop/tongzhou-zhishu/core/update-key.json）。
// 服务器在接收时校验一次，节点下载后还会再校验一次；服务器本身没有私钥，无法伪造更新。

import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_BUNDLE_BYTES = 30 * 1024 * 1024;
const KEEP_RELEASES = 5;
const DEFAULT_PROMOTE_MINUTES = 30;
const STALL_MINUTES = 30;

function text(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || "").trim());
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function emptyState() {
  return { version: 1, releases: [], rollout: { version: "", mode: "paused", canaryNodeIds: [], autoPromoteMinutes: DEFAULT_PROMOTE_MINUTES, canaryOkSince: "", updatedAt: "", updatedBy: "" } };
}

const MODE_LABEL = { paused: "已暂停", canary: "只推试跑节点", all: "推送全部节点" };

export function createCollectorReleases({ dir, publicKeyFile, releaseToken = "", now = () => Date.now() } = {}) {
  const stateFile = join(dir, "releases.json");
  let state = emptyState();
  if (existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, "utf8"));
      if (parsed && Array.isArray(parsed.releases)) state = { ...emptyState(), ...parsed, rollout: { ...emptyState().rollout, ...(parsed.rollout || {}) } };
    } catch (error) {
      console.error("[collector-releases] failed to read state, starting empty", error);
    }
  }

  const isoNow = () => new Date(now()).toISOString();

  function save() {
    mkdirSync(dir, { recursive: true });
    const temp = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, stateFile);
  }

  function publicKey() {
    try {
      return text(JSON.parse(readFileSync(publicKeyFile, "utf8")).publicKey, 400);
    } catch {
      return "";
    }
  }

  const bundleFile = (version) => join(dir, `update-${version}.bundle`);
  const releaseOf = (version) => state.releases.find((item) => item.version === version) || null;

  function publicRelease(release) {
    return release ? { version: release.version, electron: release.electron, sha256: release.sha256, size: release.size, notes: release.notes, createdAt: release.createdAt, uploadedAt: release.uploadedAt, uploadedBy: release.uploadedBy } : null;
  }

  function rolloutView() {
    return { ...state.rollout, label: MODE_LABEL[state.rollout.mode] || state.rollout.mode };
  }

  /** 节点上报的更新状态里，这台节点是否已经在目标版本上并确认可用。 */
  function nodeOnTarget(node, version) {
    return Boolean(node && node.update && node.update.enabled && node.update.current === version && !["pending", "error"].includes(node.update.state));
  }

  /** 试跑节点全部更新成功并稳定运行一段时间后，自动推给其余节点。 */
  function autoPromote(nodes) {
    const rollout = state.rollout;
    if (rollout.mode !== "canary" || !rollout.version || !rollout.canaryNodeIds.length) return false;
    const canaries = rollout.canaryNodeIds.map((id) => nodes.find((node) => node.id === id));
    const allOk = canaries.every((node) => node && node.online && nodeOnTarget(node, rollout.version));
    if (!allOk) {
      if (rollout.canaryOkSince) {
        rollout.canaryOkSince = "";
        save();
      }
      return false;
    }
    if (!rollout.canaryOkSince) {
      rollout.canaryOkSince = isoNow();
      save();
      return false;
    }
    if (!(rollout.autoPromoteMinutes > 0)) return false;
    if (now() - Date.parse(rollout.canaryOkSince) < rollout.autoPromoteMinutes * 60000) return false;
    rollout.mode = "all";
    rollout.updatedAt = isoNow();
    rollout.updatedBy = "自动（试跑节点运行正常）";
    save();
    return true;
  }

  function nodeRows(nodes) {
    const rollout = state.rollout;
    return nodes.map((node) => {
      const update = node.update || null;
      const current = update?.current || node.version || "";
      const targeted = Boolean(rollout.version) && !node.disabled && (rollout.mode === "all" || (rollout.mode === "canary" && rollout.canaryNodeIds.includes(node.id)));
      const behind = Boolean(rollout.version) && compareVersions(rollout.version, current) > 0;
      let status = "current";
      let message = "";
      if (!update) {
        status = behind ? "manual" : "current";
        if (behind) message = "这个版本还不支持自动更新，需要手动安装一次完整包";
      } else if (!update.enabled && behind) {
        status = "manual";
        message = "安装包没有配置更新公钥，需要手动安装一次完整包";
      } else if (update.state === "error" && behind) {
        status = "failed";
        message = update.lastError || "更新失败";
      } else if (update.state === "pending") {
        status = "confirming";
        message = "新版本已启动，等待确认";
      } else if (behind && targeted) {
        status = ["downloading", "staged", "restarting"].includes(update.state) ? "updating" : "waiting";
        message = update.state === "staged" ? "已下载，等采集结束后重启" : update.state === "downloading" ? "正在下载" : node.online ? "等待节点领取" : "节点离线，上线后自动更新";
      } else if (behind) {
        status = "held";
        message = rollout.mode === "paused" ? "推送已暂停" : "等试跑节点确认后再更新";
      }
      return { id: node.id, name: node.name, online: node.online, disabled: node.disabled, current, shell: update?.shell || "", targeted, canary: rollout.canaryNodeIds.includes(node.id), status, message, lastFailure: update?.lastFailure || null };
    });
  }

  function issues(nodes) {
    const rollout = state.rollout;
    const list = [];
    if (!rollout.version) return list;
    for (const row of nodeRows(nodes)) {
      if (row.disabled) continue;
      if (row.status === "failed") list.push({ code: "update_failed", nodeId: row.id, nodeName: row.name, title: `自动更新到 ${rollout.version} 失败`, action: "节点已回退到之前的版本并继续工作。查看原因后修复并发布更高的版本号；同一个包不会再重试。", message: row.message });
      else if (row.status === "manual" && row.targeted) list.push({ code: "update_manual", nodeId: row.id, nodeName: row.name, title: "需要手动安装新版同舟智数", action: "在这台电脑上解压并运行最新的完整安装包，之后就能自动更新。", message: row.message });
    }
    const since = Date.parse(rollout.updatedAt || "") || 0;
    if (rollout.mode !== "paused" && since && now() - since > STALL_MINUTES * 60000) {
      for (const row of nodeRows(nodes)) {
        if (row.targeted && row.online && !row.disabled && ["waiting", "updating", "confirming"].includes(row.status)) list.push({ code: "update_stalled", nodeId: row.id, nodeName: row.name, title: `超过 ${STALL_MINUTES} 分钟还没有更新到 ${rollout.version}`, action: "节点可能一直在采集，或下载失败。查看节点日志里的「自动更新」。", message: row.message });
      }
    }
    return list;
  }

  return {
    /** 发版脚本用的令牌是否正确（服务器环境变量 COLLECTOR_RELEASE_TOKEN，至少 24 位）。 */
    tokenValid(token) {
      const expected = String(releaseToken || "");
      const actual = String(token || "");
      if (expected.length < 24 || actual.length !== expected.length) return false;
      return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    },

    /** 接收更新包：校验大小、哈希、签名后保存。新版本默认只推给已设置的试跑节点；没有试跑节点时先暂停。 */
    upload({ manifest = {}, bundle = "" } = {}, { by = "" } = {}) {
      const version = text(manifest.version, 20);
      if (!parseVersion(version)) throw fail("版本号格式不对，应为 x.y.z。");
      const key = publicKey();
      if (!key) throw fail("服务器上没有更新公钥（desktop/tongzhou-zhishu/core/update-key.json），先生成密钥并发布。", 409);
      const buffer = Buffer.from(String(bundle || ""), "base64");
      if (!buffer.length) throw fail("更新包是空的。");
      if (buffer.length > MAX_BUNDLE_BYTES) throw fail("更新包过大。", 413);
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (sha256 !== text(manifest.sha256, 80).toLowerCase()) throw fail("更新包校验值不一致。");
      let signatureOk = false;
      try {
        signatureOk = verify(null, buffer, createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }), Buffer.from(text(manifest.signature, 400), "base64"));
      } catch {
        signatureOk = false;
      }
      if (!signatureOk) throw fail("更新包签名无效，已拒绝。", 403);
      const existing = releaseOf(version);
      if (existing && existing.sha256 !== sha256) throw fail(`版本 ${version} 已经发布过且内容不同。请提高版本号后重新发布。`, 409);
      const latest = state.releases[state.releases.length - 1];
      if (!existing && latest && compareVersions(version, latest.version) <= 0) throw fail(`版本号必须高于已发布的 ${latest.version}。`, 409);
      mkdirSync(dir, { recursive: true });
      writeFileSync(bundleFile(version), buffer, { mode: 0o600 });
      if (!existing) {
        state.releases.push({ version, electron: text(manifest.electron, 10), sha256, size: buffer.length, signature: text(manifest.signature, 400), notes: text(manifest.notes, 1000), createdAt: text(manifest.createdAt, 40), uploadedAt: isoNow(), uploadedBy: text(by, 80) });
        for (const old of state.releases.splice(0, Math.max(0, state.releases.length - KEEP_RELEASES))) rmSync(bundleFile(old.version), { force: true });
        state.rollout = { ...state.rollout, version, mode: state.rollout.canaryNodeIds.length ? "canary" : "paused", canaryOkSince: "", updatedAt: isoNow(), updatedBy: text(by, 80) };
      }
      save();
      return { release: publicRelease(releaseOf(version)), rollout: rolloutView() };
    },

    /** 心跳时告诉节点该更新到哪个版本（没有安排则返回 null）。 */
    targetFor(node, nodes = []) {
      autoPromote(nodes);
      const rollout = state.rollout;
      if (!node || node.disabled || !rollout.version || rollout.mode === "paused") return null;
      if (rollout.mode === "canary" && !rollout.canaryNodeIds.includes(node.id)) return null;
      const release = releaseOf(rollout.version);
      if (!release || !existsSync(bundleFile(release.version))) return null;
      return { version: release.version, electron: release.electron, sha256: release.sha256, size: release.size, signature: release.signature };
    },

    /** 节点下载更新包。 */
    bundle(version) {
      const release = releaseOf(text(version, 20));
      if (!release || !existsSync(bundleFile(release.version))) return null;
      return { release, buffer: readFileSync(bundleFile(release.version)) };
    },

    /** 调整推送：选版本、选试跑节点、暂停 / 只推试跑 / 推全部。 */
    setRollout({ version, mode, canaryNodeIds, autoPromoteMinutes } = {}, { by = "" } = {}) {
      const rollout = state.rollout;
      if (version !== undefined) {
        const next = text(version, 20);
        if (next && !releaseOf(next)) throw fail("没有这个版本的更新包。", 404);
        if (next !== rollout.version) rollout.canaryOkSince = "";
        rollout.version = next;
      }
      if (canaryNodeIds !== undefined) {
        const next = Array.isArray(canaryNodeIds) ? [...new Set(canaryNodeIds.map((id) => text(id, 80)).filter(Boolean))].slice(0, 20) : [];
        if (JSON.stringify(next) !== JSON.stringify(rollout.canaryNodeIds)) rollout.canaryOkSince = "";
        rollout.canaryNodeIds = next;
      }
      if (autoPromoteMinutes !== undefined) {
        const minutes = Number(autoPromoteMinutes);
        rollout.autoPromoteMinutes = Number.isFinite(minutes) ? Math.min(24 * 60, Math.max(0, Math.round(minutes))) : DEFAULT_PROMOTE_MINUTES;
      }
      if (mode !== undefined) {
        if (!MODE_LABEL[mode]) throw fail("不支持的推送方式。");
        if (mode !== "paused" && !rollout.version) throw fail("还没有可以推送的版本。", 409);
        if (mode === "canary" && !rollout.canaryNodeIds.length) throw fail("先选择至少一台试跑节点。", 409);
        if (mode !== rollout.mode) rollout.canaryOkSince = "";
        rollout.mode = mode;
      }
      rollout.updatedAt = isoNow();
      rollout.updatedBy = text(by, 80);
      save();
      return rolloutView();
    },

    view({ nodes = [] } = {}) {
      autoPromote(nodes);
      return {
        publicKeyConfigured: Boolean(publicKey()),
        uploadTokenConfigured: String(releaseToken || "").length >= 24,
        releases: state.releases.map(publicRelease).reverse(),
        rollout: rolloutView(),
        nodes: nodeRows(nodes),
        issues: issues(nodes),
        serverTime: isoNow(),
      };
    },

    issues,
  };
}
