import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Copy, KeyRound, LoaderCircle, Mail, Plus, RefreshCw, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import type { AuthUser, VerificationBinding, VerificationCodeCenterPayload, VerificationMailbox, VerificationRequest } from "./api";
import {
  createVerificationRequest,
  deleteVerificationBinding,
  deleteVerificationMailbox,
  fetchVerificationCodeCenter,
  refreshVerificationRequest,
  revealVerificationCode,
  saveVerificationBinding,
  saveVerificationMailbox,
  testVerificationMailbox,
} from "./api";
import "./verification-code-center.css";

type MailboxDraft = {
  id: string;
  label: string;
  address: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  enabled: boolean;
};

type BindingDraft = {
  id: string;
  mailboxId: string;
  platform: string;
  shopName: string;
  shopKey: string;
  senderPatterns: string;
  subjectKeywords: string;
  allowedUserIds: string[];
  enabled: boolean;
};

const emptyMailbox: MailboxDraft = { id: "", label: "", address: "", host: "", port: "993", secure: true, username: "", password: "", enabled: true };
const emptyBinding: BindingDraft = { id: "", mailboxId: "", platform: "", shopName: "", shopKey: "", senderPatterns: "", subjectKeywords: "", allowedUserIds: [], enabled: true };

function formatTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function latestRequest(bindingId: string, requests: VerificationRequest[]) {
  return requests.find((item) => item.bindingId === bindingId);
}

function splitList(value: string) {
  return value.split(/[\n,，;；]+/).map((item) => item.trim()).filter(Boolean);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export function VerificationCodeCenter({ currentUser }: { currentUser: AuthUser }) {
  const [payload, setPayload] = useState<VerificationCodeCenterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"codes" | "settings">("codes");
  const [revealed, setRevealed] = useState<Record<string, { code: string; expiresAt: string }>>({});
  const [mailboxDraft, setMailboxDraft] = useState<MailboxDraft>(emptyMailbox);
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>(emptyBinding);
  const canManage = currentUser.permissions?.includes("verification_code_manage") || currentUser.role === "admin";

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await fetchVerificationCodeCenter();
      setPayload(next);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "验证码中心读取失败。");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!payload?.requests.some((item) => item.status === "pending")) return undefined;
    const timer = window.setInterval(() => { void load(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [payload?.requests, load]);

  const activeBindings = useMemo(() => (payload?.bindings || []).filter((item) => item.enabled !== false), [payload?.bindings]);

  async function execute(key: string, task: () => Promise<unknown>, success: string) {
    setWorking(key);
    setError("");
    setNotice("");
    try {
      await task();
      setNotice(success);
      await load(true);
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败。");
      return false;
    } finally {
      setWorking("");
    }
  }

  async function requestCode(binding: VerificationBinding) {
    setWorking(`request:${binding.id}`);
    setError("");
    try {
      const result = await createVerificationRequest(binding.id);
      setPayload(result.payload);
      setNotice(result.request.status === "ready" ? "已找到最新登录验证码。" : "已开始等待验证码邮件，收到后页面会自动更新。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "验证码请求失败。");
    } finally {
      setWorking("");
    }
  }

  async function reveal(request: VerificationRequest, purpose: "view" | "copy") {
    setWorking(`${purpose}:${request.id}`);
    setError("");
    try {
      const result = await revealVerificationCode(request.id, purpose);
      setRevealed((current) => ({ ...current, [request.id]: { code: result.code, expiresAt: result.expiresAt } }));
      if (purpose === "copy") {
        await copyText(result.code);
        setNotice("验证码已复制；本次复制已写入操作日志。");
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "验证码读取失败。");
    } finally {
      setWorking("");
    }
  }

  function editMailbox(mailbox: VerificationMailbox) {
    setMailboxDraft({
      id: mailbox.id,
      label: mailbox.label,
      address: mailbox.address,
      host: mailbox.host,
      port: String(mailbox.port || 993),
      secure: mailbox.secure !== false,
      username: mailbox.username,
      password: "",
      enabled: mailbox.enabled !== false,
    });
  }

  function editBinding(binding: VerificationBinding) {
    setBindingDraft({
      id: binding.id,
      mailboxId: binding.mailboxId,
      platform: binding.platform,
      shopName: binding.shopName,
      shopKey: binding.shopKey,
      senderPatterns: binding.senderPatterns.join("\n"),
      subjectKeywords: binding.subjectKeywords.join("\n"),
      allowedUserIds: binding.allowedUserIds,
      enabled: binding.enabled !== false,
    });
  }

  if (loading && !payload) return <div className="verification-loading"><LoaderCircle className="spinning" size={24} />正在打开验证码中心…</div>;

  return (
    <div className="verification-center">
      <section className="verification-hero">
        <div>
          <span className="verification-eyebrow">SECURE CODE DESK</span>
          <h1>店铺验证码中心</h1>
          <p>运营只看自己被授权的店铺；验证码短时保存，每次查看和复制都会留下审计记录。</p>
        </div>
        <div className="verification-hero-badge"><ShieldCheck size={22} /><span><strong>邮件只读</strong><small>不保存正文和附件</small></span></div>
      </section>

      <div className="verification-tabs">
        <button className={tab === "codes" ? "active" : ""} type="button" onClick={() => setTab("codes")}><KeyRound size={17} />我的验证码</button>
        {canManage ? <button className={tab === "settings" ? "active" : ""} type="button" onClick={() => setTab("settings")}><Settings size={17} />邮箱与店铺配置</button> : null}
        <button className="verification-refresh" type="button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
      </div>

      {error ? <div className="verification-message danger">{error}<button type="button" onClick={() => setError("")}><X size={15} /></button></div> : null}
      {notice ? <div className="verification-message success"><Check size={16} />{notice}<button type="button" onClick={() => setNotice("")}><X size={15} /></button></div> : null}
      {!payload?.configured ? <div className="verification-message warning">服务端尚未配置验证码加密密钥。管理员可以查看页面，但暂不能保存邮箱密码。</div> : null}

      {tab === "codes" ? (
        <section className="verification-code-panel">
          <div className="verification-section-heading">
            <div><span>AUTHORIZED SHOPS</span><h2>我可以获取的店铺验证码</h2></div>
            <small>{activeBindings.length} 个授权店铺</small>
          </div>
          {!activeBindings.length ? (
            <div className="verification-empty"><Mail size={34} /><strong>暂时没有授权店铺</strong><span>请管理员在“邮箱与店铺配置”中将对应店铺授权给你。</span></div>
          ) : (
            <div className="verification-shop-grid">
              {activeBindings.map((binding) => {
                const request = latestRequest(binding.id, payload?.requests || []);
                const visible = request ? revealed[request.id] : null;
                const pending = request?.status === "pending";
                const ready = request?.status === "ready";
                return (
                  <article className="verification-shop-card" key={binding.id}>
                    <div className="verification-shop-top">
                      <div className="verification-shop-icon">{binding.shopName.slice(0, 1)}</div>
                      <div><small>{binding.platform}</small><h3>{binding.shopName}</h3><span>{binding.mailboxAddress}</span></div>
                      <span className={`verification-status ${ready ? "ready" : pending ? "pending" : "idle"}`}>{ready ? "已收到" : pending ? "等待邮件" : "未请求"}</span>
                    </div>
                    {ready && request ? (
                      <div className="verification-code-box">
                        <div><small>登录验证码</small><strong>{visible?.code || request.maskedCode || "••••••"}</strong></div>
                        <span>收到于 {formatTime(request.codeReceivedAt)}</span>
                      </div>
                    ) : pending && request ? (
                      <div className="verification-waiting"><LoaderCircle className="spinning" size={19} /><div><strong>正在等待验证码邮件</strong><span>页面每 5 秒自动检查一次</span></div></div>
                    ) : (
                      <div className="verification-hint">在店铺登录页发送验证码后，立即回到这里点击获取。</div>
                    )}
                    {request?.lastError ? <div className="verification-inline-error">{request.lastError}</div> : null}
                    <div className="verification-card-actions">
                      {ready && request ? <button type="button" onClick={() => void reveal(request, "view")} disabled={Boolean(working)}><KeyRound size={15} />{visible ? "重新查看" : "查看"}</button> : null}
                      {ready && request ? <button className="primary" type="button" onClick={() => void reveal(request, "copy")} disabled={Boolean(working)}><Copy size={15} />复制验证码</button> : null}
                      {pending && request ? <button className="primary" type="button" onClick={() => void execute(`refresh:${request.id}`, () => refreshVerificationRequest(request.id), "已检查最新邮件。") } disabled={Boolean(working)}><RefreshCw className={working ? "spinning" : ""} size={15} />立即检查</button> : null}
                      {!pending && !ready ? <button className="primary full" type="button" onClick={() => void requestCode(binding)} disabled={Boolean(working)}><Mail size={15} />获取验证码</button> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === "settings" && canManage ? (
        <div className="verification-admin-grid">
          <section className="verification-admin-panel">
            <div className="verification-section-heading"><div><span>MAILBOXES</span><h2>只读邮箱</h2></div><button type="button" onClick={() => setMailboxDraft(emptyMailbox)}><Plus size={15} />新增</button></div>
            <form className="verification-form" onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                const saved = await execute("mailbox-save", () => saveVerificationMailbox({ ...mailboxDraft, port: Number(mailboxDraft.port) }, mailboxDraft.id), mailboxDraft.id ? "邮箱配置已更新。" : "邮箱配置已创建。");
                if (saved) setMailboxDraft(emptyMailbox);
              })();
            }}>
              <label><span>显示名称</span><input required value={mailboxDraft.label} onChange={(event) => setMailboxDraft({ ...mailboxDraft, label: event.target.value })} placeholder="例如：俄罗斯店铺邮箱" /></label>
              <label><span>邮箱地址</span><input required type="email" value={mailboxDraft.address} onChange={(event) => setMailboxDraft({ ...mailboxDraft, address: event.target.value })} placeholder="store@example.com" /></label>
              <label><span>IMAP 主机</span><input required value={mailboxDraft.host} onChange={(event) => setMailboxDraft({ ...mailboxDraft, host: event.target.value })} placeholder="imap.example.com" /></label>
              <label><span>端口</span><input required type="number" min="1" max="65535" value={mailboxDraft.port} onChange={(event) => setMailboxDraft({ ...mailboxDraft, port: event.target.value })} /></label>
              <label><span>登录账号</span><input required value={mailboxDraft.username} onChange={(event) => setMailboxDraft({ ...mailboxDraft, username: event.target.value })} /></label>
              <label><span>{mailboxDraft.id ? "新密码（不改可留空）" : "IMAP 专用密码/授权码"}</span><input required={!mailboxDraft.id} type="password" autoComplete="new-password" value={mailboxDraft.password} onChange={(event) => setMailboxDraft({ ...mailboxDraft, password: event.target.value })} /></label>
              <label className="verification-check"><input type="checkbox" checked={mailboxDraft.secure} onChange={(event) => setMailboxDraft({ ...mailboxDraft, secure: event.target.checked })} />TLS 安全连接</label>
              <label className="verification-check"><input type="checkbox" checked={mailboxDraft.enabled} onChange={(event) => setMailboxDraft({ ...mailboxDraft, enabled: event.target.checked })} />启用邮箱</label>
              <div className="verification-form-actions"><button type="button" onClick={() => setMailboxDraft(emptyMailbox)}>清空</button><button className="primary" type="submit" disabled={Boolean(working)}>保存邮箱</button></div>
            </form>
            <div className="verification-record-list">
              {(payload?.mailboxes || []).map((mailbox) => <div className="verification-record" key={mailbox.id}>
                <div><strong>{mailbox.label}</strong><span>{mailbox.address} · {mailbox.host}:{mailbox.port}</span><small>{mailbox.lastSuccessAt ? `最近成功 ${formatTime(mailbox.lastSuccessAt)}` : "尚未测试"}{mailbox.lastError ? ` · ${mailbox.lastError}` : ""}</small></div>
                <div><button type="button" onClick={() => editMailbox(mailbox)}>编辑</button><button type="button" onClick={() => void execute(`test:${mailbox.id}`, () => testVerificationMailbox(mailbox.id), "邮箱连接测试成功。")}>测试</button><button className="danger" type="button" onClick={() => { if (window.confirm(`确认删除邮箱“${mailbox.label}”？`)) void execute(`delete:${mailbox.id}`, () => deleteVerificationMailbox(mailbox.id), "邮箱已删除。"); }}><Trash2 size={14} /></button></div>
              </div>)}
            </div>
          </section>

          <section className="verification-admin-panel">
            <div className="verification-section-heading"><div><span>SHOP ACCESS</span><h2>店铺与运营授权</h2></div><button type="button" onClick={() => setBindingDraft(emptyBinding)}><Plus size={15} />新增</button></div>
            <form className="verification-form" onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                const saved = await execute("binding-save", () => saveVerificationBinding({ ...bindingDraft, senderPatterns: splitList(bindingDraft.senderPatterns), subjectKeywords: splitList(bindingDraft.subjectKeywords) }, bindingDraft.id), bindingDraft.id ? "店铺授权已更新。" : "店铺授权已创建。");
                if (saved) setBindingDraft(emptyBinding);
              })();
            }}>
              <label><span>接收邮箱</span><select required value={bindingDraft.mailboxId} onChange={(event) => setBindingDraft({ ...bindingDraft, mailboxId: event.target.value })}><option value="">请选择邮箱</option>{(payload?.mailboxes || []).map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.label} · {mailbox.address}</option>)}</select></label>
              <label><span>平台</span><input required value={bindingDraft.platform} onChange={(event) => setBindingDraft({ ...bindingDraft, platform: event.target.value })} placeholder="例如 Ozon / TikTok Shop" /></label>
              <label><span>店铺名称</span><input required value={bindingDraft.shopName} onChange={(event) => setBindingDraft({ ...bindingDraft, shopName: event.target.value })} /></label>
              <label><span>店铺唯一标识</span><input required value={bindingDraft.shopKey} onChange={(event) => setBindingDraft({ ...bindingDraft, shopKey: event.target.value })} placeholder="内部店铺编号，不可重复" /></label>
              <label className="wide"><span>验证码邮件发件人/域名（每行一个）</span><textarea required rows={3} value={bindingDraft.senderPatterns} onChange={(event) => setBindingDraft({ ...bindingDraft, senderPatterns: event.target.value })} placeholder="no-reply@platform.com&#10;@platform.com" /></label>
              <label className="wide"><span>邮件主题关键词（每行一个）</span><textarea required rows={3} value={bindingDraft.subjectKeywords} onChange={(event) => setBindingDraft({ ...bindingDraft, subjectKeywords: event.target.value })} placeholder="登录验证码&#10;verification code" /></label>
              <fieldset className="verification-user-picker"><legend>允许查看的运营</legend>{(payload?.users || []).filter((user) => user.status !== "disabled" && ["direct", "admin"].includes(user.role)).map((user) => <label key={user.id}><input type="checkbox" checked={bindingDraft.allowedUserIds.includes(user.id)} onChange={(event) => setBindingDraft({ ...bindingDraft, allowedUserIds: event.target.checked ? [...bindingDraft.allowedUserIds, user.id] : bindingDraft.allowedUserIds.filter((id) => id !== user.id) })} /><span>{user.displayName || user.username}</span><small>{user.username}</small></label>)}</fieldset>
              <label className="verification-check"><input type="checkbox" checked={bindingDraft.enabled} onChange={(event) => setBindingDraft({ ...bindingDraft, enabled: event.target.checked })} />启用店铺授权</label>
              <div className="verification-form-actions"><button type="button" onClick={() => setBindingDraft(emptyBinding)}>清空</button><button className="primary" type="submit" disabled={Boolean(working)}>保存授权</button></div>
            </form>
            <div className="verification-record-list">
              {(payload?.bindings || []).map((binding) => <div className="verification-record" key={binding.id}>
                <div><strong>{binding.shopName}</strong><span>{binding.platform} · {binding.mailboxAddress}</span><small>已授权 {binding.allowedUserIds.length} 人 · {binding.enabled ? "启用" : "停用"}</small></div>
                <div><button type="button" onClick={() => editBinding(binding)}>编辑</button><button className="danger" type="button" onClick={() => { if (window.confirm(`确认删除店铺绑定“${binding.shopName}”？`)) void execute(`delete-binding:${binding.id}`, () => deleteVerificationBinding(binding.id), "店铺授权已删除。"); }}><Trash2 size={14} /></button></div>
              </div>)}
            </div>
          </section>
        </div>
      ) : null}

      <section className="verification-security-note"><Clipboard size={18} /><div><strong>使用边界</strong><span>本功能只识别登录验证码；密码重置、付款、提现、银行卡和安全设置类邮件不会进入验证码中心。验证码默认 15 分钟过期。</span></div></section>
    </div>
  );
}
