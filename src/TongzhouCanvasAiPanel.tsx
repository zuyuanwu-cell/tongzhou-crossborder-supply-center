import React from "react";
import {
  Bot,
  Check,
  Coins,
  Download,
  Image,
  KeyRound,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Video,
  Workflow,
} from "lucide-react";
import {
  AiConfigPayload,
  AiJob,
  AiModelCatalogItem,
  AuthUser,
  fetchAiJob,
  refreshAiConfig,
  submitAiJob,
  updateAiConfig,
} from "./api";

type TabId = "text" | "image" | "video" | "workflow";
type BusyState = "config" | "refresh" | "text" | "image" | "video" | "workflow" | "";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function modelOptions(config: AiConfigPayload | null, category: AiModelCatalogItem["category"]) {
  return (config?.catalog.models || []).filter((model) => model.category === category);
}

function outputUrls(job: AiJob | null) {
  if (!job?.output) return [];
  return Array.from(new Set([
    typeof job.output.url === "string" ? job.output.url : "",
    ...(Array.isArray(job.output.urls) ? job.output.urls.filter((item): item is string => typeof item === "string") : []),
  ].filter(Boolean)));
}

function isVideoUrl(url: string, job: AiJob | null) {
  return job?.category === "video" || job?.output?.type === "video" || /\.(mp4|webm|mov)(?:\?|$)/i.test(url);
}

function isImageUrl(url: string, job: AiJob | null) {
  return job?.category === "image" || job?.output?.type === "image" || /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(url);
}

function jobStatusLabel(status: string) {
  return ({
    submitting: "正在提交",
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
  } as Record<string, string>)[status] || status;
}

function ModelSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: AiModelCatalogItem[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="canvas-model-field">
      <span>{label}</span>
      <select value={value} disabled={disabled || !options.length} onChange={(event) => onChange(event.target.value)}>
        {!options.length ? <option value="">保存 API Key 后加载模型</option> : null}
        {options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}{model.estimatedCredits ? ` · 约 ${model.estimatedCredits} 点` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function JobProgress({ job }: { job: AiJob | null }) {
  if (!job) return null;
  const progress = Math.max(0, Math.min(100, Number(job.progress) || (job.status === "succeeded" ? 100 : 0)));
  return (
    <div className={`canvas-job-progress ${job.status}`}>
      <div>
        <strong>{jobStatusLabel(job.status)}</strong>
        <span>{job.workflowName || job.model || "同舟画布任务"}</span>
        <em>任务号 {job.id.slice(0, 8)}</em>
      </div>
      <div className="canvas-progress-track"><i style={{ width: `${progress}%` }} /></div>
      <small>
        {progress ? `${progress}%` : "已进入异步队列"}
        {job.chargedCredits !== null ? ` · 消耗 ${job.chargedCredits} 点` : job.estimatedCredits ? ` · 预计 ${job.estimatedCredits} 点` : ""}
      </small>
      {job.error?.message ? <p>{job.error.message}</p> : null}
    </div>
  );
}

function JobOutput({ job }: { job: AiJob | null }) {
  const urls = outputUrls(job);
  if (!job || (job.status !== "succeeded" && !job.output)) return null;
  return (
    <div className="canvas-output">
      {job.output?.text ? <div className="ai-result-text">{job.output.text}</div> : null}
      {urls.length ? (
        <div className="ai-image-results">
          {urls.map((url, index) => (
            <figure className="ai-image-card" key={url}>
              {isVideoUrl(url, job) ? <video className="ai-video-result" src={url} controls playsInline /> : null}
              {isImageUrl(url, job) ? <img src={url} alt={`生成结果 ${index + 1}`} /> : null}
              {!isVideoUrl(url, job) && !isImageUrl(url, job) ? <a href={url} target="_blank" rel="noreferrer">打开生成结果 {index + 1}</a> : null}
              <figcaption>
                <span>结果 {index + 1}</span>
                <a className="ghost-button compact-button" href={url} target="_blank" rel="noreferrer" download>
                  <Download size={14} /> 下载
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {!job.output?.text && !urls.length && job.output ? (
        <pre className="canvas-json-output">{JSON.stringify(job.output, null, 2)}</pre>
      ) : null}
    </div>
  );
}

export function TongzhouCanvasAiPanel({
  aiConfig,
  currentUser,
  onRefreshConfig,
}: {
  aiConfig: AiConfigPayload | null;
  currentUser: AuthUser;
  onRefreshConfig: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = React.useState<TabId>("text");
  const [busy, setBusy] = React.useState<BusyState>("");
  const [message, setMessage] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [selectedModels, setSelectedModels] = React.useState({ text: "", image: "", video: "" });
  const [selectedWorkflows, setSelectedWorkflows] = React.useState({ image: "", video: "" });
  const [textPrompt, setTextPrompt] = React.useState("");
  const [textSystem, setTextSystem] = React.useState("你是跨境电商商品内容编辑，请基于用户提供的事实写作，不虚构参数、功效或认证。");
  const [textJob, setTextJob] = React.useState<AiJob | null>(null);
  const [imagePrompt, setImagePrompt] = React.useState("");
  const [imageRefs, setImageRefs] = React.useState("");
  const [imageParams, setImageParams] = React.useState({ aspectRatio: "1:1", resolution: "1024x1024", seed: "" });
  const [imageJob, setImageJob] = React.useState<AiJob | null>(null);
  const [videoPrompt, setVideoPrompt] = React.useState("");
  const [videoRefs, setVideoRefs] = React.useState("");
  const [videoParams, setVideoParams] = React.useState({ aspectRatio: "16:9", resolution: "720p", duration: "5", seed: "" });
  const [videoJob, setVideoJob] = React.useState<AiJob | null>(null);
  const [workflowId, setWorkflowId] = React.useState("");
  const [workflowInputs, setWorkflowInputs] = React.useState('{\n  "prompt": "请描述要生成的画面或视频",\n  "image": "https://..."\n}');
  const [workflowJob, setWorkflowJob] = React.useState<AiJob | null>(null);
  const aiLocked = currentUser.role === "guest" || !currentUser.permissions?.includes("tongzhou_ai");

  const textModels = modelOptions(aiConfig, "chat");
  const imageModels = modelOptions(aiConfig, "image");
  const videoModels = modelOptions(aiConfig, "video");
  const workflows = aiConfig?.catalog.workflows || [];
  const currentWorkflow = workflows.find((workflow) => workflow.id === workflowId) || null;

  React.useEffect(() => {
    if (!aiConfig) return;
    setSelectedModels({
      text: aiConfig.models.text || textModels[0]?.id || "",
      image: aiConfig.models.image || imageModels[0]?.id || "",
      video: aiConfig.models.video || videoModels[0]?.id || "",
    });
    setSelectedWorkflows(aiConfig.workflows || { image: "", video: "" });
    setWorkflowId((current) => current || aiConfig.workflows.video || aiConfig.workflows.image || workflows[0]?.id || "");
  }, [aiConfig?.updatedAt, aiConfig?.catalog.checkedAt]);

  async function pollUntilComplete(initial: AiJob, onUpdate: (job: AiJob) => void) {
    let current = initial;
    onUpdate(current);
    const deadline = Date.now() + 8 * 60 * 1000;
    while (!TERMINAL_STATUSES.has(current.status)) {
      if (Date.now() > deadline) throw new Error("任务仍在画布中处理，可稍后在最近任务里继续查看。");
      await delay(5000);
      const result = await fetchAiJob(current.id);
      current = result.job;
      onUpdate(current);
    }
    if (current.status !== "succeeded") throw new Error(current.error?.message || `任务${jobStatusLabel(current.status)}。`);
    return current;
  }

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    setBusy("config");
    setMessage("");
    try {
      await updateAiConfig({
        apiKey: apiKey.trim() || undefined,
        models: selectedModels,
        workflows: selectedWorkflows,
      });
      setApiKey("");
      void onRefreshConfig();
      setMessage("你的同舟画布密钥和默认模型已安全保存。密钥不会展示给其他用户。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存同舟画布配置失败。");
    } finally {
      setBusy("");
    }
  }

  async function refreshCatalog() {
    setBusy("refresh");
    setMessage("");
    try {
      await refreshAiConfig();
      void onRefreshConfig();
      setMessage("模型、余额和工作流已刷新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新画布能力失败。");
    } finally {
      setBusy("");
    }
  }

  async function clearConfig() {
    if (!window.confirm("确认清除你自己的同舟画布 API Key？这不会影响其他用户。")) return;
    setBusy("config");
    setMessage("");
    try {
      await updateAiConfig({ clearKey: true });
      void onRefreshConfig();
      setMessage("你的同舟画布 API Key 已清除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清除密钥失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitText(event: React.FormEvent) {
    event.preventDefault();
    if (!textPrompt.trim()) return setMessage("请先输入标题、卖点或文案需求。");
    setBusy("text");
    setMessage("");
    setTextJob(null);
    try {
      const result = await submitAiJob({
        category: "chat",
        model: selectedModels.text,
        messages: [
          ...(textSystem.trim() ? [{ role: "system" as const, content: textSystem.trim() }] : []),
          { role: "user" as const, content: textPrompt.trim() },
        ],
        params: { temperature: 0.6, max_tokens: 2400 },
      });
      await pollUntilComplete(result.job, setTextJob);
      setMessage("文字内容已生成，请人工核对后使用。");
      void onRefreshConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文字生成失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitImage(event: React.FormEvent) {
    event.preventDefault();
    if (!imagePrompt.trim()) return setMessage("请先描述要生成的图片。");
    setBusy("image");
    setMessage("");
    setImageJob(null);
    try {
      const result = await submitAiJob({
        category: "image",
        model: selectedModels.image,
        prompt: imagePrompt.trim(),
        images: imageRefs.split(/\s+/).filter(Boolean),
        params: {
          aspectRatio: imageParams.aspectRatio,
          resolution: imageParams.resolution,
          ...(imageParams.seed ? { seed: Number(imageParams.seed) } : {}),
        },
      });
      await pollUntilComplete(result.job, setImageJob);
      setMessage("图片已生成，请及时下载保存。");
      void onRefreshConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片生成失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitVideo(event: React.FormEvent) {
    event.preventDefault();
    if (!videoPrompt.trim()) return setMessage("请先描述要生成的视频。");
    setBusy("video");
    setMessage("");
    setVideoJob(null);
    try {
      const result = await submitAiJob({
        category: "video",
        model: selectedModels.video,
        prompt: videoPrompt.trim(),
        images: videoRefs.split(/\s+/).filter(Boolean),
        params: {
          aspectRatio: videoParams.aspectRatio,
          resolution: videoParams.resolution,
          duration: Number(videoParams.duration),
          ...(videoParams.seed ? { seed: Number(videoParams.seed) } : {}),
        },
      });
      await pollUntilComplete(result.job, setVideoJob);
      setMessage("视频已生成，请及时下载保存。");
      void onRefreshConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视频生成失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitWorkflow(event: React.FormEvent) {
    event.preventDefault();
    if (!workflowId) return setMessage("请先选择已发布的工作流。");
    setBusy("workflow");
    setMessage("");
    setWorkflowJob(null);
    try {
      const inputs = JSON.parse(workflowInputs);
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new Error("工作流输入必须是 JSON 对象。");
      const result = await submitAiJob({ kind: "workflow", workflowId, inputs });
      await pollUntilComplete(result.job, setWorkflowJob);
      setMessage("工作流已运行完成，请及时保存生成结果。");
      void onRefreshConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "工作流运行失败。");
    } finally {
      setBusy("");
    }
  }

  async function resumeJob(job: AiJob) {
    const tab: TabId = job.kind === "workflow" ? "workflow" : job.category === "image" ? "image" : job.category === "video" ? "video" : "text";
    const update = tab === "workflow" ? setWorkflowJob : tab === "image" ? setImageJob : tab === "video" ? setVideoJob : setTextJob;
    setActiveTab(tab);
    update(job);
    if (TERMINAL_STATUSES.has(job.status)) return;
    setBusy(tab);
    setMessage("");
    try {
      await pollUntilComplete(job, update);
      setMessage("任务已完成，请及时保存生成结果。");
      void onRefreshConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "继续查询任务失败。");
    } finally {
      setBusy("");
    }
  }

  const tabs = [
    { id: "text" as const, label: "标题与文案", icon: Bot, count: textModels.length },
    { id: "image" as const, label: "AI 生图", icon: Image, count: imageModels.length },
    { id: "video" as const, label: "AI 视频", icon: Video, count: videoModels.length },
    { id: "workflow" as const, label: "画布工作流", icon: Workflow, count: workflows.length },
  ];

  return (
    <main className="movement-page ai-page canvas-ai-page">
      <section className="library-hero ai-hero canvas-ai-hero">
        <div>
          <p className="eyebrow">Tongzhou Canvas AI</p>
          <h2>同舟 AI 创作台</h2>
          <p>文字、商品图、视频与画布工作流统一接入；每位用户只使用并管理自己的密钥。</p>
          <div className="source-row">
            <span className={`status-pill ${aiConfig?.configured ? "good" : "warning"}`}>
              {aiConfig?.configured ? <><Check size={13} /> 我的密钥已配置</> : "等待配置我的 API Key"}
            </span>
            <span>{aiConfig?.apiKeyMasked || "密钥仅加密保存在服务端"}</span>
          </div>
        </div>
        <div className="canvas-balance-card">
          <Coins size={20} />
          <span>画布余额</span>
          <strong>{aiConfig?.catalog.balance ? aiConfig.catalog.balance.balance.toLocaleString("zh-CN") : "--"}</strong>
          <small>{aiConfig?.catalog.balance?.currency || "保存密钥后读取"}</small>
        </div>
      </section>

      {aiLocked ? <div className="notice warning">当前账号没有同舟 AI 权限，请联系管理员开通。</div> : null}
      {message ? <div className={`notice ${/失败|错误|请先|不可用|超时/.test(message) ? "warning" : ""}`}>{message}</div> : null}

      <section className="panel ai-config-panel canvas-config-panel">
        <div className="canvas-section-head">
          <div><KeyRound size={19} /><div><h3>我的画布连接</h3><p>API Key 按账号隔离并加密保存，不写入浏览器，也不会共享给管理员或其他同事。</p></div></div>
          <button className="ghost-button" type="button" onClick={refreshCatalog} disabled={!aiConfig?.configured || Boolean(busy)}>
            <RefreshCw size={15} className={busy === "refresh" ? "spin" : ""} /> 刷新能力
          </button>
        </div>
        <form className="canvas-config-form" onSubmit={saveConfig}>
          <label className="canvas-key-field"><span>同舟画布 API Key</span><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={aiConfig?.configured ? `已保存 ${aiConfig.apiKeyMasked}；留空表示不更换` : "tz_live_..."} /></label>
          <ModelSelect label="默认文字模型" value={selectedModels.text} options={textModels} disabled={aiLocked} onChange={(text) => setSelectedModels((current) => ({ ...current, text }))} />
          <ModelSelect label="默认图片模型" value={selectedModels.image} options={imageModels} disabled={aiLocked} onChange={(image) => setSelectedModels((current) => ({ ...current, image }))} />
          <ModelSelect label="默认视频模型" value={selectedModels.video} options={videoModels} disabled={aiLocked} onChange={(video) => setSelectedModels((current) => ({ ...current, video }))} />
          <label><span>默认生图工作流</span><select value={selectedWorkflows.image} disabled={!workflows.length} onChange={(event) => setSelectedWorkflows((current) => ({ ...current, image: event.target.value }))}><option value="">不指定</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name} · r{workflow.revision}</option>)}</select></label>
          <label><span>默认视频工作流</span><select value={selectedWorkflows.video} disabled={!workflows.length} onChange={(event) => setSelectedWorkflows((current) => ({ ...current, video: event.target.value }))}><option value="">不指定</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name} · r{workflow.revision}</option>)}</select></label>
          <div className="canvas-config-actions">
            {aiConfig?.configured ? <button className="ghost-button danger" type="button" onClick={clearConfig} disabled={Boolean(busy)}><Trash2 size={14} /> 清除我的密钥</button> : null}
            <button className="sync-button" type="submit" disabled={aiLocked || Boolean(busy) || (!apiKey.trim() && !aiConfig?.configured)}><Settings size={15} />{busy === "config" ? "验证并保存中" : aiConfig?.configured ? "保存我的设置" : "验证密钥并加载模型"}</button>
          </div>
        </form>
      </section>

      <section className="panel ai-workbench">
        <div className="ai-tabs canvas-ai-tabs" role="tablist" aria-label="同舟画布能力切换">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}><Icon size={17} /><span>{tab.label}</span><small>{tab.count}</small></button>;
          })}
        </div>

        {activeTab === "text" ? (
          <form className="ai-tool-card ai-tool-tab" onSubmit={submitText}>
            <div className="ai-tool-head"><Bot size={20} /><div><p className="eyebrow">Copywriting</p><h3>标题与商品文案</h3></div></div>
            <ModelSelect label="本次使用模型" value={selectedModels.text} options={textModels} onChange={(text) => setSelectedModels((current) => ({ ...current, text }))} />
            <div className="canvas-prompt-presets">
              {["为 TikTok 印尼站写 5 个合规商品标题", "提炼 5 条不夸大功效的商品卖点", "把下面的中文详情改写成自然的印尼语商品详情"].map((preset) => <button key={preset} type="button" onClick={() => setTextPrompt(`${preset}\n\n产品资料：\n`)}><Sparkles size={13} />{preset}</button>)}
            </div>
            <textarea value={textPrompt} onChange={(event) => setTextPrompt(event.target.value)} placeholder="输入产品资料和写作要求。请不要在这里填写成本、供应商等敏感信息。" />
            <details className="canvas-advanced"><summary>系统要求（高级）</summary><textarea value={textSystem} onChange={(event) => setTextSystem(event.target.value)} /></details>
            <div className="ai-action-row"><button className="sync-button" type="submit" disabled={!aiConfig?.configured || busy === "text"}><Play size={14} />{busy === "text" ? "画布生成中" : "开始生成"}</button></div>
            <JobProgress job={textJob} /><JobOutput job={textJob} />
          </form>
        ) : null}

        {activeTab === "image" ? (
          <form className="ai-tool-card ai-tool-tab" onSubmit={submitImage}>
            <div className="ai-tool-head"><Image size={20} /><div><p className="eyebrow">Image Generation</p><h3>AI 商品图</h3></div></div>
            <ModelSelect label="本次使用模型" value={selectedModels.image} options={imageModels} onChange={(image) => setSelectedModels((current) => ({ ...current, image }))} />
            <textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="例如：保留产品包装与文字，生成干净的浴室台面场景图，柔和晨光，电商主图质感" />
            <div className="ai-parameter-grid canvas-parameter-grid">
              <label><span>画面比例</span><select value={imageParams.aspectRatio} onChange={(event) => setImageParams((current) => ({ ...current, aspectRatio: event.target.value }))}><option>1:1</option><option>3:4</option><option>9:16</option><option>16:9</option></select></label>
              <label><span>分辨率</span><select value={imageParams.resolution} onChange={(event) => setImageParams((current) => ({ ...current, resolution: event.target.value }))}><option>1024x1024</option><option>1024x1536</option><option>1536x1024</option></select></label>
              <label><span>Seed（可选）</span><input inputMode="numeric" value={imageParams.seed} onChange={(event) => setImageParams((current) => ({ ...current, seed: event.target.value }))} /></label>
            </div>
            <label className="ai-wide-field"><span>参考图公网 HTTPS 地址（每行一个，最多 8 张）</span><textarea value={imageRefs} onChange={(event) => setImageRefs(event.target.value)} placeholder="https://..." /></label>
            <div className="ai-action-row"><button className="sync-button" type="submit" disabled={!aiConfig?.configured || busy === "image"}><Sparkles size={14} />{busy === "image" ? "画布生图中" : "生成图片"}</button></div>
            <JobProgress job={imageJob} /><JobOutput job={imageJob} />
          </form>
        ) : null}

        {activeTab === "video" ? (
          <form className="ai-tool-card ai-tool-tab" onSubmit={submitVideo}>
            <div className="ai-tool-head"><Video size={20} /><div><p className="eyebrow">Video Generation</p><h3>AI 商品视频</h3></div></div>
            <ModelSelect label="本次使用模型" value={selectedModels.video} options={videoModels} onChange={(video) => setSelectedModels((current) => ({ ...current, video }))} />
            <textarea value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} placeholder="描述镜头、运动、时长和氛围，例如：产品缓慢旋转，镜头轻微推进，背景保持干净" />
            <div className="ai-parameter-grid canvas-parameter-grid">
              <label><span>比例</span><select value={videoParams.aspectRatio} onChange={(event) => setVideoParams((current) => ({ ...current, aspectRatio: event.target.value }))}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
              <label><span>清晰度</span><select value={videoParams.resolution} onChange={(event) => setVideoParams((current) => ({ ...current, resolution: event.target.value }))}><option>720p</option><option>1080p</option></select></label>
              <label><span>时长（秒）</span><input type="number" min="1" max="30" value={videoParams.duration} onChange={(event) => setVideoParams((current) => ({ ...current, duration: event.target.value }))} /></label>
              <label><span>Seed（可选）</span><input inputMode="numeric" value={videoParams.seed} onChange={(event) => setVideoParams((current) => ({ ...current, seed: event.target.value }))} /></label>
            </div>
            <label className="ai-wide-field"><span>首帧或参考图公网 HTTPS 地址（每行一个，最多 8 张）</span><textarea value={videoRefs} onChange={(event) => setVideoRefs(event.target.value)} placeholder="https://..." /></label>
            <div className="ai-action-row"><button className="sync-button" type="submit" disabled={!aiConfig?.configured || busy === "video"}><Play size={14} />{busy === "video" ? "画布生成中" : "生成视频"}</button></div>
            <JobProgress job={videoJob} /><JobOutput job={videoJob} />
          </form>
        ) : null}

        {activeTab === "workflow" ? (
          <form className="ai-tool-card ai-tool-tab" onSubmit={submitWorkflow}>
            <div className="ai-tool-head"><Workflow size={20} /><div><p className="eyebrow">Hosted Workflow</p><h3>画布工作流</h3></div></div>
            <label className="canvas-model-field"><span>已发布工作流</span><select value={workflowId} disabled={!workflows.length} onChange={(event) => setWorkflowId(event.target.value)}><option value="">{workflows.length ? "请选择工作流" : "当前密钥没有可用工作流"}</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name} · r{workflow.revision}</option>)}</select></label>
            {currentWorkflow ? <div className="canvas-contract"><strong>工作流输入说明</strong><pre>{JSON.stringify(currentWorkflow.contract, null, 2)}</pre></div> : null}
            <label className="ai-wide-field"><span>运行输入（JSON）</span><textarea className="canvas-json-editor" value={workflowInputs} onChange={(event) => setWorkflowInputs(event.target.value)} /></label>
            <p className="muted-text">工作流可用于生图或生视频，具体字段以右侧输入说明为准。提交后会自动跟踪运行状态。</p>
            <div className="ai-action-row"><button className="sync-button" type="submit" disabled={!aiConfig?.configured || !workflowId || busy === "workflow"}><Play size={14} />{busy === "workflow" ? "工作流运行中" : "运行工作流"}</button></div>
            <JobProgress job={workflowJob} /><JobOutput job={workflowJob} />
          </form>
        ) : null}
      </section>

      {aiConfig?.recentJobs?.length ? (
        <section className="panel canvas-recent-jobs">
          <div className="canvas-section-head"><div><RefreshCw size={18} /><div><h3>最近任务</h3><p>仅显示当前账号提交的画布任务。</p></div></div></div>
          <div>{aiConfig.recentJobs.slice(0, 8).map((job) => <span key={job.id}><b>{job.workflowName || job.model || "画布任务"}</b><em>{jobStatusLabel(job.status)}</em><small>{new Date(job.updatedAt).toLocaleString("zh-CN", { hour12: false })}</small><button className="ghost-button compact-button" type="button" onClick={() => void resumeJob(job)} disabled={Boolean(busy)}>{TERMINAL_STATUSES.has(job.status) ? "查看" : "继续跟踪"}</button></span>)}</div>
        </section>
      ) : null}
    </main>
  );
}
