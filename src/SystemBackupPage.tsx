import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileArchive,
  HardDriveDownload,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Server,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  SystemBackupJob,
  SystemBackupStatus,
  applySystemBackupImport,
  createSystemBackupExport,
  createSystemBackupImport,
  downloadSystemBackup,
  fetchSystemBackupJob,
  fetchSystemBackupStatus,
  uploadSystemBackupFile,
} from "./api";
import "./system-backup.css";

const ACTIVE_STATUSES = new Set([
  "queued",
  "snapshotting",
  "exporting",
  "awaiting_upload",
  "uploading",
  "validating",
  "preparing_restore",
  "queued_restore",
  "restoring",
]);

const statusLabels: Record<string, string> = {
  queued: "排队中",
  snapshotting: "创建快照",
  exporting: "加密打包",
  completed: "已完成",
  awaiting_upload: "等待上传",
  uploading: "上传中",
  validating: "校验中",
  validated: "校验通过",
  preparing_restore: "准备恢复",
  queued_restore: "等待切换",
  restoring: "恢复中",
  rolled_back: "已回滚",
  failed: "失败",
};

const auditLabels: Record<string, string> = {
  export_started: "开始创建备份",
  export_completed: "备份包生成完成",
  export_failed: "备份导出失败",
  download_ticket_created: "领取下载票据",
  backup_downloaded: "下载备份包",
  import_created: "创建导入校验",
  import_validated: "导入包校验通过",
  import_validation_failed: "导入包校验失败",
  import_upload_failed: "导入包上传失败",
  restore_confirmed: "确认执行恢复",
  restore_queued: "恢复任务已排队",
  restore_started: "恢复代理开始切换",
  restore_completed: "系统恢复完成",
  restore_rolled_back: "恢复失败并已回滚",
  restore_failed: "恢复失败",
};

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function JobProgress({ job, uploadProgress }: { job: SystemBackupJob | null; uploadProgress?: number }) {
  if (!job) return null;
  const progress = job.status === "uploading" && uploadProgress !== undefined ? Math.round(uploadProgress * 0.35) : Number(job.progress || 0);
  const tone = job.status === "failed" ? "danger" : job.status === "rolled_back" ? "warning" : ["completed", "validated"].includes(job.status) ? "success" : "running";
  return (
    <div className={`sb-job sb-job-${tone}`} role="status">
      <div className="sb-job-heading">
        <span>{tone === "running" ? <LoaderCircle className="sb-spin" size={16} /> : tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{statusLabels[job.status] || job.status}</span>
        <strong>{Math.max(0, Math.min(100, progress))}%</strong>
      </div>
      <div className="sb-progress" aria-label={`任务进度 ${progress}%`}><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>
      <p>{job.message}</p>
      {job.currentPath ? <small>正在处理：{job.currentPath}</small> : null}
      {job.error ? <div className="sb-inline-error">{job.error}</div> : null}
    </div>
  );
}

export function SystemBackupPage() {
  const [status, setStatus] = useState<SystemBackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportJob, setExportJob] = useState<SystemBackupJob | null>(null);
  const [importJob, setImportJob] = useState<SystemBackupJob | null>(null);
  const [exportReauth, setExportReauth] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordAgain, setExportPasswordAgain] = useState("");
  const [importReauth, setImportReauth] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [envMode, setEnvMode] = useState<"migration" | "full">("migration");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [applyReauth, setApplyReauth] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"" | "export" | "import" | "download" | "apply">("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const payload = await fetchSystemBackupStatus();
      setStatus(payload);
      setExportJob((current) => current || payload.jobs.find((job) => job.type === "export") || null);
      setImportJob((current) => current || payload.jobs.find((job) => job.type === "import") || null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "系统备份状态读取失败。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const jobs = [exportJob, importJob].filter((job): job is SystemBackupJob => Boolean(job && ACTIVE_STATUSES.has(job.status)));
    if (!jobs.length) return undefined;
    const timer = window.setInterval(() => {
      void Promise.all(jobs.map(async (job) => {
        try {
          const response = await fetchSystemBackupJob(job.id);
          if (job.type === "export") setExportJob(response.job);
          else setImportJob(response.job);
          if (!ACTIVE_STATUSES.has(response.job.status)) void refresh(true);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "任务状态读取失败。");
        }
      }));
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [exportJob?.id, exportJob?.status, importJob?.id, importJob?.status]);

  const activeTask = useMemo(
    () => [exportJob, importJob].some((job) => job && ACTIVE_STATUSES.has(job.status)),
    [exportJob, importJob],
  );

  const startExport = async () => {
    setError("");
    setNotice("");
    if (exportPassword.length < 12) return setError("备份包密码至少需要 12 个字符。");
    if (exportPassword !== exportPasswordAgain) return setError("两次输入的备份包密码不一致。");
    if (!exportReauth) return setError("请输入当前管理员账户密码完成二次验证。");
    setBusy("export");
    try {
      const response = await createSystemBackupExport({ reauthPassword: exportReauth, packagePassword: exportPassword });
      setExportJob(response.job);
      setNotice("备份任务已创建。数据快照完成后系统会立即恢复正常写入，压缩加密将在后台继续。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建备份任务失败。");
    } finally {
      setExportReauth("");
      setExportPassword("");
      setExportPasswordAgain("");
      setBusy("");
    }
  };

  const startImport = async () => {
    setError("");
    setNotice("");
    if (!selectedFile) return setError("请选择 .tzbak 备份文件。");
    if (!selectedFile.name.toLowerCase().endsWith(".tzbak")) return setError("只支持 .tzbak 加密备份包。");
    if (status && selectedFile.size > status.maxUploadBytes) return setError(`备份文件不能超过 ${formatBytes(status.maxUploadBytes)}。`);
    if (importPassword.length < 12) return setError("请输入创建该备份包时使用的密码。");
    if (!importReauth) return setError("请输入当前管理员账户密码完成二次验证。");
    setBusy("import");
    setUploadProgress(0);
    try {
      const created = await createSystemBackupImport({
        reauthPassword: importReauth,
        packagePassword: importPassword,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        envMode,
      });
      setImportJob(created.job);
      setImportReauth("");
      setImportPassword("");
      const uploaded = await uploadSystemBackupFile(created.job.id, created.uploadToken, selectedFile, setUploadProgress);
      setImportJob(uploaded);
      setNotice("文件上传完成。系统正在隔离目录中解密、核对摘要并检查版本，不会修改当前数据。");
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传并校验备份包失败。");
    } finally {
      setImportReauth("");
      setImportPassword("");
      setBusy("");
    }
  };

  const download = async () => {
    if (!exportJob) return;
    setBusy("download");
    setError("");
    try {
      const blob = await downloadSystemBackup(exportJob.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportJob.downloadName || `tongzhou-backup-${exportJob.id}.tzbak`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice("备份包已下载。服务器端的一次性文件将在本次下载完成后删除，请妥善保存密码和文件。");
      void refresh(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "备份包下载失败。");
    } finally {
      setBusy("");
    }
  };

  const applyImport = async () => {
    if (!importJob) return;
    setError("");
    setNotice("");
    if (confirmation.trim() !== "确认恢复") return setError("请输入“确认恢复”完成最终确认。");
    if (!applyReauth) return setError("请再次输入当前管理员账户密码。");
    setBusy("apply");
    try {
      const response = await applySystemBackupImport(importJob.id, { reauthPassword: applyReauth, confirmation });
      setImportJob(response.job);
      setNotice("恢复任务已交给独立恢复代理。主服务会短暂重启；如果健康检查失败，系统会自动回滚原数据。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "启动恢复任务失败。");
    } finally {
      setApplyReauth("");
      setConfirmation("");
      setBusy("");
    }
  };

  if (loading && !status) {
    return <section className="system-backup-page"><div className="sb-loading"><LoaderCircle className="sb-spin" size={24} />正在读取备份服务状态…</div></section>;
  }

  return (
    <section className="system-backup-page">
      <header className="sb-hero">
        <div className="sb-hero-title">
          <span className="sb-hero-icon"><ArchiveRestore size={25} /></span>
          <div><p>ADMINISTRATOR RECOVERY</p><h2>系统备份与迁移</h2><span>加密导出主应用数据，在同一版本中校验、迁移与可回滚恢复</span></div>
        </div>
        <button className="sb-button" type="button" onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw className={refreshing ? "sb-spin" : ""} size={16} />刷新状态</button>
      </header>

      {error ? <div className="sb-notice danger" role="alert"><AlertTriangle size={17} /><span>{error}</span></div> : null}
      {notice ? <div className="sb-notice success" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div> : null}

      <div className="sb-status-grid">
        <article><span><Database size={17} />当前数据</span><strong>{formatBytes(status?.data.bytes)}</strong><small>{status?.data.files || 0} 个文件 · {status?.data.envPresent ? ".env 已纳入" : "无 .env 文件"}</small></article>
        <article><span><ShieldCheck size={17} />运行版本</span><strong className="sb-code">{status?.gitSha?.slice(0, 12) || "未知"}</strong><small>导入包必须精确匹配此 Git SHA</small></article>
        <article className={status?.restoreAgent.healthy ? "healthy" : "warning"}><span><Server size={17} />恢复代理</span><strong>{status?.restoreAgent.healthy ? "在线" : "不可用"}</strong><small>{status?.restoreAgent.message}</small></article>
        <article className={status?.importEnabled ? "healthy" : "warning"}><span><KeyRound size={17} />恢复开关</span><strong>{status?.importEnabled ? "已启用" : "仅校验"}</strong><small>{status?.importEnabled ? "可执行最终数据切换" : "需设置 ALLOW_SYSTEM_IMPORT=1"}</small></article>
      </div>

      <div className="sb-scope-banner">
        <div><ShieldCheck size={19} /><strong>备份范围清晰可核对</strong></div>
        <p><b>包含：</b>{status?.scope.included.join("、")}</p>
        <p><b>不包含：</b>{status?.scope.excluded.join("、")}</p>
      </div>

      <div className="sb-workspace">
        <article className="sb-panel">
          <header><div className="sb-panel-icon export"><HardDriveDownload size={20} /></div><div><h3>导出加密备份</h3><p>短时排空写入并创建稳定快照，随后在后台压缩加密。</p></div></header>
          <div className="sb-form-grid">
            <label><span>管理员账户密码</span><input type="password" autoComplete="current-password" value={exportReauth} onChange={(event) => setExportReauth(event.target.value)} placeholder="用于本次二次验证" /></label>
            <label><span>备份包密码</span><input type="password" autoComplete="new-password" value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} placeholder="至少 12 个字符" /></label>
            <label><span>再次输入备份包密码</span><input type="password" autoComplete="new-password" value={exportPasswordAgain} onChange={(event) => setExportPasswordAgain(event.target.value)} placeholder="请务必离线保存" /></label>
          </div>
          <div className="sb-security-note"><ShieldCheck size={15} />缓存、数据库、附件、清单和 .env 会整体使用 AES-256-GCM 加密，服务器不会保存包密码。</div>
          <button className="sb-button primary" type="button" disabled={busy !== "" || activeTask} onClick={() => void startExport()}>{busy === "export" ? <LoaderCircle className="sb-spin" size={17} /> : <FileArchive size={17} />}{busy === "export" ? "正在创建任务" : "创建加密备份"}</button>
          <JobProgress job={exportJob} />
          {exportJob?.status === "completed" && !exportJob.artifactRemoved ? (
            <button className="sb-download" type="button" disabled={busy !== ""} onClick={() => void download()}><Download size={17} />{busy === "download" ? "正在下载" : `下载 ${formatBytes(exportJob.packageBytes)}`}</button>
          ) : null}
        </article>

        <article className="sb-panel">
          <header><div className="sb-panel-icon import"><Upload size={20} /></div><div><h3>导入并验证</h3><p>先上传到隔离目录完成解密、摘要和版本检查，不会立即覆盖数据。</p></div></header>
          <div className="sb-file-picker">
            <input ref={fileRef} type="file" accept=".tzbak,application/octet-stream" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
            <Upload size={19} /><div><strong>{selectedFile?.name || "选择 .tzbak 备份包"}</strong><span>{selectedFile ? formatBytes(selectedFile.size) : `最大 ${formatBytes(status?.maxUploadBytes)}`}</span></div>
          </div>
          <div className="sb-form-grid sb-form-grid-two">
            <label><span>管理员账户密码</span><input type="password" autoComplete="current-password" value={importReauth} onChange={(event) => setImportReauth(event.target.value)} placeholder="用于本次二次验证" /></label>
            <label><span>备份包密码</span><input type="password" autoComplete="new-password" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} placeholder="创建备份时设置的密码" /></label>
          </div>
          <fieldset className="sb-mode-picker">
            <legend>环境变量处理</legend>
            <label className={envMode === "migration" ? "active" : ""}><input type="radio" name="env-mode" checked={envMode === "migration"} onChange={() => setEnvMode("migration")} /><span><strong>迁移模式（推荐）</strong><small>保留目标服务器端口、路径、数据库与存储地址</small></span></label>
            <label className={envMode === "full" ? "active dangerous" : ""}><input type="radio" name="env-mode" checked={envMode === "full"} onChange={() => setEnvMode("full")} /><span><strong>完整恢复</strong><small>覆盖全部 .env，仅用于同机灾备</small></span></label>
          </fieldset>
          <button className="sb-button primary" type="button" disabled={busy !== "" || activeTask} onClick={() => void startImport()}>{busy === "import" ? <LoaderCircle className="sb-spin" size={17} /> : <Upload size={17} />}{busy === "import" ? `正在上传 ${uploadProgress}%` : "上传并校验"}</button>
          <JobProgress job={importJob} uploadProgress={uploadProgress} />
        </article>
      </div>

      {importJob?.status === "validated" && importJob.preview ? (
        <section className="sb-validation">
          <header><div><CheckCircle2 size={21} /><span><strong>备份包校验通过</strong><small>校验通过不代表已应用；当前业务数据尚未修改。</small></span></div><span className="sb-version">SHA {importJob.preview.gitSha.slice(0, 12)}</span></header>
          <div className="sb-validation-grid">
            <div><span>备份创建时间</span><strong>{formatTime(importJob.preview.createdAt)}</strong></div>
            <div><span>业务数据</span><strong>{formatBytes(importJob.preview.totalBytes)}</strong><small>{importJob.preview.fileCount} 个文件</small></div>
            <div><span>环境策略</span><strong>{importJob.preview.envMode === "migration" ? "迁移模式" : "完整恢复"}</strong><small>{importJob.preview.preservedEnvKeys.length} 个目标配置已保留</small></div>
            <div><span>协同系统</span><strong>{importJob.preview.collaborationIncluded ? "已包含" : "未包含"}</strong><small>请按范围提示单独备份</small></div>
          </div>
          {importJob.preview.preservedEnvKeys.length ? <p className="sb-key-list"><b>保留目标配置：</b>{importJob.preview.preservedEnvKeys.join("、")}</p> : null}
          {importJob.preview.warnings.map((warning) => <div className="sb-notice warning" key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>)}
          <div className="sb-apply-box">
            <div><ArchiveRestore size={20} /><span><strong>最终恢复会短暂重启主服务</strong><small>恢复代理会保留旧数据并进行健康检查；失败时自动回滚。</small></span></div>
            {!status?.importEnabled ? <p>当前服务器只允许导入校验。请先由运维设置 <code>ALLOW_SYSTEM_IMPORT=1</code> 并确认恢复代理在线。</p> : null}
            <div className="sb-apply-fields">
              <label><span>再次输入管理员密码</span><input type="password" autoComplete="current-password" value={applyReauth} onChange={(event) => setApplyReauth(event.target.value)} /></label>
              <label><span>输入“确认恢复”</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="确认恢复" /></label>
              <button className="sb-button danger" type="button" disabled={busy !== "" || !status?.importEnabled || !status.restoreAgent.healthy} onClick={() => void applyImport()}>{busy === "apply" ? <LoaderCircle className="sb-spin" size={17} /> : <ArchiveRestore size={17} />}{busy === "apply" ? "正在提交" : "执行可回滚恢复"}</button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="sb-history">
        <header><div><Clock3 size={18} /><span><h3>备份与恢复审计</h3><p>记录保存在业务缓存之外，不随导入包回滚。</p></span></div><small>最近 {status?.audit.length || 0} 条</small></header>
        <div className="sb-table-wrap">
          <table><thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>任务</th><th>结果摘要</th></tr></thead><tbody>
            {status?.audit.length ? status.audit.map((entry, index) => (
              <tr key={entry.id || `${entry.createdAt}-${index}`}><td>{formatTime(entry.createdAt)}</td><td>{auditLabels[entry.action] || entry.action}</td><td>{entry.actorName || entry.actorId}</td><td className="sb-code">{String(entry.details?.jobId || "—").slice(0, 12)}</td><td>{String(entry.details?.message || entry.details?.envMode || "—")}</td></tr>
            )) : <tr><td colSpan={5} className="sb-empty">暂无备份与恢复记录</td></tr>}
          </tbody></table>
        </div>
      </section>
    </section>
  );
}
