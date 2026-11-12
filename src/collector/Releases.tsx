import React from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Pause, RefreshCw, Rocket, X } from "lucide-react";
import { fetchCollectorReleases, updateCollectorRollout, type CollectorReleaseNode, type CollectorReleasePayload, type CollectorRolloutMode } from "../api";

function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const NODE_STATUS: Record<CollectorReleaseNode["status"], [string, string]> = {
  current: ["已是目标版本", "good"],
  waiting: ["等待更新", "info"],
  updating: ["更新中", "info"],
  confirming: ["确认中", "info"],
  held: ["暂不更新", "muted"],
  failed: ["更新失败，已回退", "bad"],
  manual: ["需手动安装", "warning"],
};

export function Releases({ canEdit = true }: { canEdit?: boolean }) {
  const [data, setData] = React.useState<CollectorReleasePayload | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setData(await fetchCollectorReleases());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取版本信息失败");
    }
  }, []);

  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function change(key: string, patch: Parameters<typeof updateCollectorRollout>[0], message: string) {
    setBusy(key);
    setNotice("");
    try {
      setData(await updateCollectorRollout(patch));
      setNotice(message);
      setError("");
    } catch (actError) {
      setError(actError instanceof Error ? actError.message : "操作失败");
    } finally {
      setBusy("");
    }
  }

  const rollout = data?.rollout;
  const latest = data?.releases[0];
  const target = data?.releases.find((release) => release.version === rollout?.version) || null;
  const activeNodes = data?.nodes.filter((node) => !node.disabled) || [];
  const onTarget = activeNodes.filter((node) => rollout?.version && node.current === rollout.version).length;
  const canaryNames = data?.nodes.filter((node) => node.canary).map((node) => node.name).join("、") || "";
  const setMode = (mode: CollectorRolloutMode, message: string) => change(mode, { mode }, message);
  const toggleCanary = (node: CollectorReleaseNode) => {
    const current = rollout?.canaryNodeIds || [];
    const next = current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id];
    change(`canary:${node.id}`, { canaryNodeIds: next }, next.includes(node.id) ? `「${node.name}」已设为试跑节点，新版本会先推给它。` : `「${node.name}」不再是试跑节点。`);
  };

  return (
    <div className="mr">
      <div className="dq-summary mr-summary">
        <div className={`dq-card ${target ? "verified" : ""}`}>
          <strong>{rollout?.version || "—"}</strong>
          <span>目标版本</span>
          <small>{target ? `${formatTime(target.uploadedAt)} 上传 · ${(target.size / 1024).toFixed(0)} KB` : "还没有发布过更新包"}</small>
        </div>
        <div className={`dq-card ${rollout?.mode === "all" ? "verified" : rollout?.mode === "canary" ? "pending" : ""}`}>
          <strong>{rollout?.label || "—"}</strong>
          <span>推送状态</span>
          <small>{rollout?.updatedAt ? `${formatTime(rollout.updatedAt)} · ${rollout.updatedBy || ""}` : "—"}</small>
        </div>
        <div className={`dq-card ${rollout?.version && activeNodes.length && onTarget === activeNodes.length ? "verified" : rollout?.version ? "pending" : ""}`}>
          <strong>{onTarget}/{activeNodes.length}</strong>
          <span>已在目标版本</span>
          <small>不含已停用的节点</small>
        </div>
        <div className={`dq-card ${data?.issues.length ? "bad" : "verified"}`}>
          <strong>{data?.issues.length || 0}</strong>
          <span>需要人工处理</span>
          <small>同时进入 Hermes 异常工作台</small>
        </div>
      </div>

      {error ? <div className="cc-notice bad"><AlertTriangle size={15} />{error}</div> : null}
      {notice ? <div className="cc-notice"><CheckCircle2 size={15} />{notice}<button type="button" onClick={() => setNotice("")}><X size={13} /></button></div> : null}
      {data && !data.publicKeyConfigured ? <div className="cc-notice bad"><AlertTriangle size={15} />服务器上还没有更新公钥，无法接收更新包。请在打包电脑上执行一次 npm run update:keygen，提交公钥并发布中台。</div> : null}
      {data && data.publicKeyConfigured && !data.uploadTokenConfigured ? <div className="cc-notice bad"><AlertTriangle size={15} />服务器没有配置发版令牌 COLLECTOR_RELEASE_TOKEN（至少 24 位），发版脚本暂时不能上传更新包。</div> : null}

      {data?.issues.length ? (
        <section className="dq-manual">
          <div className="dq-manual-title"><AlertTriangle size={15} />需要人工处理</div>
          <ul className="mr-issues">
            {data.issues.map((issue) => (
              <li key={`${issue.code}-${issue.nodeId}`}>
                <strong>{issue.nodeName}：{issue.title}</strong>
                <span>{issue.action}{issue.message ? `（${issue.message}）` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="cc-panel mr-panel">
        <div className="mr-toolbar">
          <p className="cc-muted">
            新版本上传后先只推给试跑节点{canaryNames ? `（${canaryNames}）` : ""}；试跑节点更新成功并稳定运行 {rollout?.autoPromoteMinutes ?? 30} 分钟后，自动推给其余节点。节点会等采集结束再重启；新版本连不上中台会自动回退。更新包带签名，节点只接受打包电脑签过名的包。
            {latest && rollout && latest.version !== rollout.version ? ` 最新上传的是 ${latest.version}。` : ""}
          </p>
          <div className="mr-toolbar-actions">
            <button type="button" className="cc-btn" onClick={load}><RefreshCw size={14} />刷新</button>
            {canEdit && rollout?.version ? (
              <>
                <button type="button" className="cc-btn" disabled={Boolean(busy) || rollout.mode === "paused"} onClick={() => setMode("paused", "已暂停推送，还没更新的节点保持现在的版本。")}><Pause size={14} />暂停</button>
                <button type="button" className="cc-btn" disabled={Boolean(busy) || rollout.mode === "canary" || !rollout.canaryNodeIds.length} onClick={() => setMode("canary", "只推给试跑节点。")} title={rollout.canaryNodeIds.length ? "" : "先在下面勾选试跑节点"}><FlaskConical size={14} />只推试跑节点</button>
                <button type="button" className="cc-btn primary" disabled={Boolean(busy) || rollout.mode === "all"} onClick={() => setMode("all", `已推送给全部节点：${rollout.version}。`)}><Rocket size={14} />推送全部</button>
              </>
            ) : null}
          </div>
        </div>

        {data && !data.nodes.length ? <p className="cc-muted">还没有采集节点。</p> : null}
        {data?.nodes.length ? (
          <div className="cc-table-wrap">
            <table className="cc-table mr-table">
              <thead><tr><th>试跑</th><th>节点</th><th>当前版本</th><th>状态</th><th>说明</th></tr></thead>
              <tbody>
                {data.nodes.map((node) => {
                  const [label, tone] = NODE_STATUS[node.status] || [node.status, "muted"];
                  return (
                    <tr key={node.id} className={node.disabled ? "mr-off" : ""}>
                      <td><input type="checkbox" checked={node.canary} disabled={!canEdit || Boolean(busy)} onChange={() => toggleCanary(node)} aria-label={`把 ${node.name} 设为试跑节点`} /></td>
                      <td><strong>{node.name}</strong><small>{node.disabled ? "已停用" : node.online ? "在线" : "离线"}</small></td>
                      <td>{node.current || "—"}{node.shell && node.shell !== node.current ? <small>安装包 {node.shell}</small> : null}</td>
                      <td><span className={`cc-tag ${rollout?.version ? tone : "muted"}`}>{rollout?.version ? label : "—"}</span></td>
                      <td>{node.message || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="cc-panel mr-panel">
        <h4>已发布的版本</h4>
        {data?.releases.length ? (
          <div className="cc-table-wrap">
            <table className="cc-table">
              <thead><tr><th>版本</th><th>上传时间</th><th>大小</th><th>说明</th><th /></tr></thead>
              <tbody>
                {data.releases.map((release) => (
                  <tr key={release.version}>
                    <td><strong>{release.version}</strong>{release.version === rollout?.version ? <span className="cc-tag good" style={{ marginLeft: 6 }}>目标</span> : null}</td>
                    <td>{formatTime(release.uploadedAt)}</td>
                    <td>{(release.size / 1024).toFixed(0)} KB</td>
                    <td>{release.notes || "—"}</td>
                    <td>{canEdit && release.version !== rollout?.version ? <button type="button" className="cc-btn" disabled={Boolean(busy)} onClick={() => change(`v:${release.version}`, { version: release.version, mode: "paused" }, `目标版本改为 ${release.version}，推送已暂停，请确认后再推。节点只会升级，不会降级。`)}>设为目标</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="cc-muted">还没有更新包。发版时在打包电脑上执行 npm run release:update -- --publish。</p>}
      </section>
    </div>
  );
}
