"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Copy, Eye, FileUp, Globe2, MessageSquarePlus, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { FeishuResultModal } from "./_components/FeishuResultModal";
import { WriterHistoryPanel } from "./_components/WriterHistoryPanel";
import { WriterGuideModal } from "./_components/WriterGuideModal";
import { WriterStyleModal } from "./_components/WriterStyleModal";
import { useFeishuPublish } from "./_hooks/useFeishuPublish";
import { useWriterGeneration, type RevisionPreviewSegment } from "./_hooks/useWriterGeneration";
import { useWriterReferenceDetails } from "./_hooks/useWriterReferenceDetails";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import { getDrafts, transcribeAudioUpload } from "@/lib/client";
import { buildWriterDraftHref } from "@/lib/draft-links";
import { extractRewriteSourceMaterial, normalizeRewritePrompt } from "@/lib/source-extraction";
import type { Draft } from "@/lib/types";

type WriterSource = {
  id: string;
  label: string;
  kind: "link" | "text" | "document" | "audio";
  content: string;
  fileName?: string;
};

export default function WriterPage() {
  return (
    <Suspense fallback={<WriterFallback />}>
      <WriterPageContent />
    </Suspense>
  );
}

function WriterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { library, loading, refresh } = useLibrary();
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
  const [targetType, setTargetType] = useState<"account" | "project">("account");
  const [accountId, setAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<Draft["mode"]>("topic");
  const [prompt, setPrompt] = useState("");
  const [sources, setSources] = useState<WriterSource[]>(() => [createWriterSource(1)]);
  const [useWebResearch, setUseWebResearch] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [fullDrafts, setFullDrafts] = useState<Draft[] | null>(null);
  const [revisionPreview, setRevisionPreview] = useState<RevisionPreviewSegment[]>([]);
  const [selectionRewrite, setSelectionRewrite] = useState<{
    text: string;
    start: number;
    end: number;
    instruction: string;
  } | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; end: number; query: string } | null>(null);
  const loadedDraftParamRef = useRef("");
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const selectedAccount = useMemo(() => {
    const first = library?.accounts[0];
    return library?.accounts.find((account) => account.id === accountId) || first || null;
  }, [library?.accounts, accountId]);

  const selectedProject = useMemo(() => {
    const first = library?.projects[0];
    return library?.projects.find((project) => project.id === projectId) || first || null;
  }, [library?.projects, projectId]);

  const allDrafts = useMemo(() => fullDrafts || [], [fullDrafts]);
  const historyLoading = loading || fullDrafts === null;
  const historyDrafts = useMemo(() => [...allDrafts].sort(compareCreatedAtDesc), [allDrafts]);

  const handleDraftSaved = useCallback(
    (draft: Draft) => {
      setFullDrafts((current) => mergeDraftLists(current || [], [draft]));
    },
    []
  );

  const { activeStyle, activeTitle } = useWriterReferenceDetails({
    selectedAccount,
    selectedProject,
    setNotice,
    targetType
  });
  const normalizedSourceText = useMemo(() => buildSourcesText(sources), [sources]);
  const sourceExtraction = useMemo(() => extractRewriteSourceMaterial(normalizedSourceText), [normalizedSourceText]);
  const effectiveMode: Draft["mode"] = normalizedSourceText.trim() || mode === "rewrite" ? "rewrite" : "topic";
  const normalizedPrompt = useMemo(
    () => normalizeRewritePrompt(effectiveMode, buildPromptWithMentions(prompt, sources), normalizedSourceText),
    [effectiveMode, normalizedSourceText, prompt, sources]
  );
  const hasRewriteSource = Boolean(normalizedSourceText.trim());
  const hasTaskInput = effectiveMode === "topic" ? Boolean(normalizedPrompt.trim()) : Boolean(normalizedPrompt.trim() || hasRewriteSource);
  const noticeIsError = notice.includes("失败") || notice.includes("未配置");
  const mentionSources = useMemo(() => {
    const filled = sources.filter((source) => source.content.trim());
    if (!mentionQuery) return [];
    const query = mentionQuery.query.toLowerCase();
    return filled.filter((source) => source.label.toLowerCase().includes(query));
  }, [mentionQuery, sources]);

  const {
    canGenerate,
    copyLast,
    generateProgress,
    generateStage,
    handleGenerate,
    handleOpenAssets,
    lastContent,
    lastDraftBase,
    lastDraftId,
    lastResearch,
    loadDraftResult,
    resetDraftState,
    rewriteSelection,
    updateLastContent
  } = useWriterGeneration({
    activeJobs,
    activeTitle,
    busy,
    hasTaskInput,
    mode: effectiveMode,
    normalizedPrompt,
    normalizedSourceText,
    onRevisionPreviewChange: setRevisionPreview,
    recentJobs,
    onDraftSaved: handleDraftSaved,
    refresh,
    routerPush: router.push,
    selectedAccount,
    selectedProject,
    setBusy,
    setNotice,
    startTask,
    targetType,
    useWebResearch
  });

  const { feishuResult, handlePublishFeishu, setFeishuResult } = useFeishuPublish({
    activeTitle,
    lastContent,
    setBusy,
    setNotice
  });

  useEffect(() => {
    if (!notice || isTaskProgressMessage(notice)) return;
    notify({ tone: noticeIsError ? "error" : "success", message: notice });
  }, [notice, noticeIsError, notify]);

  useEffect(() => {
    let ignore = false;
    if (loading) return;

    getDrafts()
      .then((result) => {
        if (ignore) return;
        setFullDrafts((current) => mergeDraftLists(result.drafts, current || []));
      })
      .catch((err) => {
        if (!ignore) setNotice(err instanceof Error ? err.message : "读取历史记录失败");
      });

    return () => {
      ignore = true;
    };
  }, [loading]);

  useEffect(() => {
    const target = searchParams.get("targetType");
    const nextMode = searchParams.get("mode");
    const nextPrompt = searchParams.get("prompt");
    const nextSourceText = searchParams.get("sourceText");
    const nextAccountId = searchParams.get("accountId");
    const nextProjectId = searchParams.get("projectId");
    const draftId = searchParams.get("draftId");
    const sourceDraft = draftId ? allDrafts.find((draft) => draft.id === draftId) : null;

    if (target === "project") setTargetType("project");
    if (target === "account") setTargetType("account");
    if (nextAccountId) setAccountId(nextAccountId);
    if (nextProjectId) setProjectId(nextProjectId);

    if (sourceDraft) {
      if (loadedDraftParamRef.current === sourceDraft.id) return;
      loadedDraftParamRef.current = sourceDraft.id;
      setMode(sourceDraft.mode);
      setPrompt(sourceDraft.prompt);
      setSources(sourcesFromDraftInput(sourceDraft.input || ""));
      loadDraftResult(sourceDraft);
      return;
    }

    if (draftId && historyLoading) return;
    if (!draftId) loadedDraftParamRef.current = "";

    if (nextMode === "topic" || nextMode === "rewrite") setMode(nextMode);
    if (nextPrompt !== null) setPrompt(nextPrompt);
    if (nextSourceText !== null) setSources(sourcesFromDraftInput(nextSourceText));
  }, [allDrafts, historyLoading, loadDraftResult, searchParams]);

  const handleSelectHistoryDraft = useCallback(
    (draft: Draft) => {
      loadedDraftParamRef.current = draft.id;
      setMode(draft.mode);
      setPrompt(draft.prompt);
      setSources(sourcesFromDraftInput(draft.input || ""));
      loadDraftResult(draft);
      router.replace(buildWriterDraftHref(draft), { scroll: false });
    },
    [loadDraftResult, router]
  );

  const handleNewConversation = useCallback(() => {
    loadedDraftParamRef.current = "";
    setMode("topic");
    setPrompt("");
    setSources([createWriterSource(1)]);
    setNotice("");
    setMentionQuery(null);
    setSelectionRewrite(null);
    setRevisionPreview([]);
    setFeishuResult(null);
    resetDraftState();
    router.replace("/writer", { scroll: false });
  }, [resetDraftState, router, setFeishuResult]);

  const insertMentionAtQuery = useCallback(
    (label: string) => {
      const mention = `@${label}`;
      const target = promptRef.current;
      if (!target || !mentionQuery) {
        setPrompt((current) => insertMention(current, label));
        setMentionQuery(null);
        return;
      }

      const nextPrompt = `${prompt.slice(0, mentionQuery.start)}${mention} ${prompt.slice(mentionQuery.end)}`;
      const nextCursor = mentionQuery.start + mention.length + 1;
      setPrompt(nextPrompt);
      setMentionQuery(null);
      window.requestAnimationFrame(() => {
        target.focus();
        target.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [mentionQuery, prompt]
  );

  if (!loading && !library?.accounts.length && !library?.projects.length) {
    return (
      <div className="page writer-page">
        <header className="page-header">
          <div>
            <h1 className="title-with-emoji">
              <span aria-hidden="true" className="title-emoji">
                ✍️
              </span>
              <span>对话写作</span>
            </h1>
            <p className="subtle">需要至少一个账号或项目风格作为引用。</p>
          </div>
        </header>
        <EmptyState title="还没有可参考的风格" body="先采集一个账号，或在账号库里创建项目风格卡，再来这里生成文案。" action={{ href: "/library", label: "去采集账号" }} />
      </div>
    );
  }

  return (
    <div className="page writer-page">
      <header className="page-header">
        <div>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              ✍️
            </span>
            <span>对话写作</span>
          </h1>
          <p className="subtle">选择引用风格，填写主题或原文，生成后会自动保存到历史记录，也可发布飞书或继续生成评论。</p>
        </div>
        <div className="stat-row">
          <button className="btn" onClick={handleNewConversation} type="button">
            <MessageSquarePlus aria-hidden="true" size={16} />
            新对话
          </button>
          <button className="btn" onClick={() => setGuideOpen(true)} type="button">
            <BookOpen aria-hidden="true" size={16} />
            新手指引
          </button>
          <span className="stat-pill">{library?.accounts.length || 0} 个账号</span>
          <span className="stat-pill">{library?.projects.length || 0} 个项目</span>
        </div>
      </header>

      <section className="writer-workbench">
        <section className="panel writer-main">
          <div className="writer-refbar">
            <div aria-label="选择引用类型" className="segmented" role="group">
              <button aria-pressed={targetType === "account"} className={targetType === "account" ? "active" : ""} onClick={() => setTargetType("account")} type="button">
                账号
              </button>
              <button
                aria-pressed={targetType === "project"}
                className={targetType === "project" ? "active" : ""}
                disabled={!library?.projects.length}
                onClick={() => setTargetType("project")}
                type="button"
              >
                项目
              </button>
            </div>

            {loading ? (
              <span className="stat-pill">正在读取引用</span>
            ) : targetType === "project" ? (
              <select
                aria-label="选择参考项目"
                className="writer-ref-select"
                name="projectId"
                value={selectedProject?.id || ""}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {library?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label="选择参考账号"
                className="writer-ref-select"
                name="accountId"
                value={selectedAccount?.id || ""}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {library?.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {formatPlatform(account.platform)} / {account.name}
                  </option>
                ))}
              </select>
            )}

            <button className="btn writer-style-trigger" disabled={!activeStyle} onClick={() => setStyleOpen(true)} type="button">
              <Eye aria-hidden="true" size={16} />
              查看风格卡
            </button>
          </div>

          <div className="writer-content-grid">
            <div className="writer-task">
              <div className="section-title-row">
                <h2>写作需求</h2>
                <span className="status-pill">{effectiveMode === "rewrite" ? "参考素材写作" : "主题新写"}</span>
              </div>

              <textarea
                aria-label="写作目标和要求"
                autoComplete="off"
                className="writer-textarea main"
                name="prompt"
                placeholder="写作主题、目标人群、核心观点，或输入 @素材1 @素材2 指定引用；输入“商单修改”会按输入源里的批注改稿并标红…"
                ref={promptRef}
                value={prompt}
                onBlur={() => {
                  window.setTimeout(() => setMentionQuery(null), 120);
                }}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setMentionQuery(readMentionQuery(event.target));
                }}
                onClick={(event) => setMentionQuery(readMentionQuery(event.currentTarget))}
                onKeyDown={(event) => {
                  if (!mentionQuery || !mentionSources.length) return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMentionQuery(null);
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    insertMentionAtQuery(mentionSources[0].label);
                  }
                }}
                onKeyUp={(event) => setMentionQuery(readMentionQuery(event.currentTarget))}
              />
              {mentionQuery && mentionSources.length ? (
                <div className="source-mention-popover">
                  {mentionSources.map((source) => (
                    <button key={source.id} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMentionAtQuery(source.label)} type="button">
                      @{source.label}
                      <span>{source.fileName || source.content.trim().slice(0, 34)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <SourceMentionBar
                onInsertMention={(label) => setPrompt((current) => insertMention(current, label))}
                sources={sources}
              />
              <WriterSourcePanel
                onNotice={setNotice}
                onSourcesChange={setSources}
                sources={sources}
              />
              <div className="source-detect-row" aria-live="polite">
                <span className="status-pill done">{sources.filter((source) => source.content.trim()).length} 个输入源</span>
                {sourceExtraction.linkCount ? <span className="status-pill pending">{sourceExtraction.linkCount} 个链接待转写</span> : null}
                {sourceExtraction.textMaterialCount ? <span className="status-pill">{sourceExtraction.textMaterialCount} 条文本/文档</span> : null}
              </div>

              <div className="writer-actionbar">
                <button
                  className={`btn icon-toggle ${useWebResearch ? "active" : ""}`}
                  onClick={() => setUseWebResearch((enabled) => !enabled)}
                  type="button"
                  aria-pressed={useWebResearch}
                  title="联网检索"
                >
                  <Globe2 aria-hidden="true" size={16} />
                  {useWebResearch ? "联网检索开" : "联网检索关"}
                </button>
                <button
                  className="btn primary"
                  disabled={!canGenerate}
                  onClick={handleGenerate}
                  title={canGenerate ? "按当前引用风格生成文案" : normalizedSourceText.trim() ? "填写改写要求或粘贴原文素材后可生成" : "填写写作主题后可生成"}
                  type="button"
                >
                  <Send aria-hidden="true" size={16} />
                  {busy === "generate" ? "正在生成" : "生成文案"}
                </button>
              </div>
            </div>

            <div className="writer-result">
              <div className="section-title-row">
                <h2>生成结果</h2>
                {lastContent ? (
                  <div className="button-row">
                    <button className="btn" onClick={copyLast} type="button">
                      <Copy aria-hidden="true" size={16} />
                      复制
                    </button>
                    <button className="btn" disabled={busy === "feishu"} onClick={handlePublishFeishu} type="button">
                      <FileUp aria-hidden="true" size={16} />
                      {busy === "feishu" ? "发布中…" : "飞书文档"}
                    </button>
                    <button className="btn" disabled={!lastDraftBase || busy === "assets"} onClick={handleOpenAssets} type="button">
                      <MessageSquarePlus size={16} />
                      {busy === "assets" ? "正在准备" : "生成评论"}
                    </button>
                    <button className="btn" disabled={!canGenerate} onClick={handleGenerate} type="button">
                      <RotateCcw aria-hidden="true" size={16} />
                      重写
                    </button>
                  </div>
                ) : (
                  <span className="status-pill pending" data-busy={busy === "generate" ? "true" : undefined}>{busy === "generate" ? "正在生成" : "等待输入"}</span>
                )}
              </div>
              {busy === "generate" ? (
                <div className="project-progress" role="status" aria-live="polite" style={{ marginBottom: 16 }}>
                  <div className="project-progress-copy">
                    <span>{generateStage || "正在生成文案"}</span>
                    <strong>{generateProgress}%</strong>
                  </div>
                  <div className="progress-track" aria-hidden="true">
                    <div className="progress-fill" style={{ width: `${generateProgress}%` }} />
                  </div>
                </div>
              ) : null}
              <div className="writer-result-shell">
                {lastContent ? (
                  <>
                    <textarea
                      aria-label="生成结果，可选中片段进行局部改写"
                      className="result-box result-editor"
                      value={lastContent}
                      onChange={(event) => updateLastContent(event.target.value)}
                      onSelect={(event) => {
                        const target = event.currentTarget;
                        const start = target.selectionStart;
                        const end = target.selectionEnd;
                        const selected = target.value.slice(start, end).trim();
                        if (!selected || end <= start) return;
                        setSelectionRewrite({
                          text: target.value.slice(start, end),
                          start,
                          end,
                          instruction: ""
                        });
                      }}
                    />
                    {revisionPreview.length ? (
                      <div className="revision-preview" aria-label="商单修改标红预览">
                        <div className="revision-preview-title">
                          <strong>标红预览</strong>
                          <span>红色为本次按批注修改的部分</span>
                        </div>
                        <div className="revision-preview-body">
                          {revisionPreview.map((segment, index) => (
                            <span className={segment.changed ? "revision-changed" : undefined} key={`${index}-${segment.changed}`}>
                              {segment.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {selectionRewrite ? (
                      <div className="selection-rewrite-panel">
                        <div>
                          <strong>改写选中片段</strong>
                          <span>{selectionRewrite.text.trim().slice(0, 42)}</span>
                        </div>
                        <input
                          autoComplete="off"
                          value={selectionRewrite.instruction}
                          onChange={(event) =>
                            setSelectionRewrite((current) =>
                              current ? { ...current, instruction: event.target.value } : current
                            )
                          }
                          placeholder="例如：更短、更口语、加冲突感、按素材2做开头…"
                        />
                        <div className="button-row">
                          <button
                            className="btn primary"
                            disabled={busy === "revise"}
                            onClick={async () => {
                              if (!selectionRewrite) return;
                              await rewriteSelection({
                                selectedText: selectionRewrite.text,
                                instruction: selectionRewrite.instruction,
                                start: selectionRewrite.start,
                                end: selectionRewrite.end
                              });
                              setSelectionRewrite(null);
                            }}
                            type="button"
                          >
                            {busy === "revise" ? "改写中" : "替换这段"}
                          </button>
                          <button className="btn" onClick={() => setSelectionRewrite(null)} type="button">
                            取消
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="result-box empty">
                    {busy === "generate" ? "正在等待首段内容，通常几秒内会开始输出。" : "生成后会在这里显示成稿。"}
                  </div>
                )}
              </div>
              {lastResearch ? (
                <details className="style-reference" style={{ marginTop: 16 }}>
                  <summary>
                    <span className="style-reference-heading">
                      <span className="style-reference-title">联网资料</span>
                      <small>本次生成使用的研究摘要</small>
                    </span>
                  </summary>
                  <div>
                    <pre className="result-box" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                      {lastResearch}
                    </pre>
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </section>

        <WriterHistoryPanel
          drafts={historyDrafts}
          loading={historyLoading}
          selectedDraftId={lastDraftId}
          onSelectDraft={handleSelectHistoryDraft}
        />
      </section>

      {styleOpen ? (
        <WriterStyleModal activeStyle={activeStyle} activeTitle={activeTitle} onClose={() => setStyleOpen(false)} />
      ) : null}

      {guideOpen ? <WriterGuideModal onClose={() => setGuideOpen(false)} /> : null}

      {feishuResult ? (
        <FeishuResultModal result={feishuResult} onClose={() => setFeishuResult(null)} />
      ) : null}
    </div>
  );
}

function mergeDraftLists(...groups: Draft[][]) {
  const byId = new Map<string, Draft>();

  for (const group of groups) {
    for (const draft of group) {
      const current = byId.get(draft.id);
      if (!current) {
        byId.set(draft.id, draft);
        continue;
      }
      if (current.content && !draft.content) continue;
      if (!current.content && draft.content) {
        byId.set(draft.id, draft);
        continue;
      }
      if (+new Date(draft.updatedAt) > +new Date(current.updatedAt)) {
        byId.set(draft.id, draft);
      }
    }
  }

  return [...byId.values()].sort(compareCreatedAtDesc);
}

function WriterSourcePanel({
  onNotice,
  onSourcesChange,
  sources
}: {
  onNotice: (message: string) => void;
  onSourcesChange: Dispatch<SetStateAction<WriterSource[]>>;
  sources: WriterSource[];
}) {
  const nextIndex = sources.length + 1;
  const [draggingSourceId, setDraggingSourceId] = useState("");
  const [transcribingSourceId, setTranscribingSourceId] = useState("");

  function updateSource(id: string, patch: Partial<WriterSource>) {
    onSourcesChange((current) => current.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  }

  function removeSource(id: string) {
    onSourcesChange((current) => renumberSources(current.filter((source) => source.id !== id)));
  }

  async function handleSourceFile(sourceId: string, file: File) {
    const isAudio = isAudioSourceFile(file);
    const previousSource = sources.find((source) => source.id === sourceId);
    if (isAudio) {
      setTranscribingSourceId(sourceId);
      updateSource(sourceId, {
        kind: "audio",
        content: `正在上传并转写 ${file.name}，稍等一下...`,
        fileName: file.name
      });
    }

    const loaded = await readSourceFile(file).catch((error) => {
      onNotice(error instanceof Error ? error.message : isAudio ? "音频转写失败" : "读取文档失败");
      return null;
    });

    if (isAudio) setTranscribingSourceId("");
    if (!loaded) {
      if (isAudio && previousSource) {
        updateSource(sourceId, {
          kind: previousSource.kind,
          content: previousSource.content,
          fileName: previousSource.fileName
        });
      }
      return;
    }
    updateSource(sourceId, {
      kind: loaded.kind,
      content: loaded.content,
      fileName: loaded.fileName
    });
    if (loaded.kind === "audio") onNotice(`${loaded.fileName || "音频"} 已转写完成`);
  }

  return (
    <div className="writer-source-panel">
      <div className="writer-source-toolbar">
        <h3>输入源</h3>
        <button
          className="btn"
          onClick={() => onSourcesChange((current) => [...current, createWriterSource(nextIndex)])}
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
          添加素材
        </button>
      </div>
      <div className="writer-source-list">
        {sources.map((source, index) => {
          const transcribing = transcribingSourceId === source.id;
          return (
            <div
              className={`writer-source-card ${draggingSourceId === source.id ? "dragging" : ""}`}
              key={source.id}
              onDragLeave={() => setDraggingSourceId("")}
              onDragOver={(event) => {
                event.preventDefault();
                setDraggingSourceId(source.id);
              }}
              onDrop={async (event) => {
                event.preventDefault();
                setDraggingSourceId("");
                const file = event.dataTransfer.files[0];
                if (!file) return;
                await handleSourceFile(source.id, file);
              }}
            >
              <div className="writer-source-card-header">
                <strong>{source.label}</strong>
                <span>{source.fileName || sourceKindLabel(source.kind)}</span>
                <button
                  aria-label={`删除${source.label}`}
                  className="btn icon-btn icon-only"
                  disabled={sources.length <= 1}
                  onClick={() => removeSource(source.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
              <div className="writer-source-import-row">
                <label className={`btn compact ${transcribing ? "disabled" : ""}`}>
                  <FileUp aria-hidden="true" size={14} />
                  {transcribing ? "转写中..." : "导入文件 / MP3"}
                  <input
                    accept=".txt,.md,.docx,.mp3,.m4a,.wav,.aac,.flac,.ogg,.opus,audio/*"
                    disabled={transcribing}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (!file) return;
                      await handleSourceFile(source.id, file);
                    }}
                    type="file"
                  />
                </label>
                <span>{transcribing ? "硅基流动转写中，完成后会自动填入下方。" : "支持 Word / TXT / MD / MP3"}</span>
              </div>
              <textarea
                aria-label={`${source.label} 内容`}
                className="writer-textarea source"
                disabled={transcribing}
                onChange={(event) => updateSource(source.id, { content: event.target.value, kind: detectSourceKind(event.target.value) })}
                placeholder={sourcePlaceholder(source.kind)}
                value={source.content}
              />
              <div className="writer-source-footer">
                <span>{source.fileName || `${source.label} ${index === 0 ? "默认主参考" : "默认辅参考"}`}</span>
                <span>拖入 Word / TXT / MD / MP3</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceMentionBar({
  onInsertMention,
  sources
}: {
  onInsertMention: (label: string) => void;
  sources: WriterSource[];
}) {
  const filledSources = sources.filter((source) => source.content.trim());
  if (!filledSources.length) return null;

  return (
    <div className="source-mention-bar" aria-label="可引用素材">
      <span>引用素材</span>
      {filledSources.map((source) => (
        <button className="source-mention" key={source.id} onClick={() => onInsertMention(source.label)} type="button">
          @{source.label}
        </button>
      ))}
    </div>
  );
}

function buildSourcesText(sources: WriterSource[]) {
  return sources
    .filter((source) => source.content.trim())
    .map((source) => {
      const lines = [`【${source.label}】`];
      if (source.fileName) lines.push(`文件: ${source.fileName}`);
      lines.push(source.kind === "link" ? `来源链接: ${source.content.trim()}` : source.content.trim());
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

function buildPromptWithMentions(prompt: string, sources: WriterSource[]) {
  const mentioned = sources
    .filter((source) => new RegExp(`@${source.label}\\b`).test(prompt))
    .map((source) => `- @${source.label} 指向下面参考素材里的【${source.label}】`);
  if (!mentioned.length) return prompt;
  return [
    prompt.trim(),
    "",
    "素材引用说明：",
    ...mentioned,
    "这些引用只用于理解用户要求，不要在成稿里输出素材编号、引用清单或解释。"
  ].join("\n");
}

function createWriterSource(index: number, content = ""): WriterSource {
  return {
    id: `source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: `素材${index}`,
    kind: detectSourceKind(content),
    content
  };
}

function renumberSources(sources: WriterSource[]) {
  return sources.map((source, index) => ({
    ...source,
    label: `素材${index + 1}`
  }));
}

function sourcesFromDraftInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return [createWriterSource(1)];

  const explicitBlocks = splitExplicitSourceBlocks(trimmed);
  if (explicitBlocks.length > 1) {
    return explicitBlocks.map((block, index) => createWriterSource(index + 1, stripSourceBlockHeader(block)));
  }

  return [createWriterSource(1, stripSourceBlockHeader(trimmed))];
}

function splitExplicitSourceBlocks(input: string) {
  const blocks = input
    .split(/\n\s*---\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) return blocks;

  const materialBlockCount = blocks.filter((block) => isExplicitSourceBlock(block)).length;
  return materialBlockCount >= 2 ? blocks : [input];
}

function stripSourceBlockHeader(input: string) {
  return input
    .replace(/^【素材\d+】\s*\n?/, "")
    .replace(/^素材\s*\d+\s*[：:]\s*\n?/, "")
    .trim();
}

function isExplicitSourceBlock(input: string) {
  return /^(【\s*素材\s*\d+\s*】|素材\s*\d+\s*[：:]|Material\s+\d+\s*:)/i.test(input.trim());
}

function detectSourceKind(content: string): WriterSource["kind"] {
  if (/https?:\/\//i.test(content)) return "link";
  return "text";
}

function sourcePlaceholder(kind: WriterSource["kind"]) {
  if (kind === "link") return "粘贴一条或多条抖音/B站链接";
  if (kind === "document") return "拖入 Word/TXT 文档，也可直接粘贴文档正文；输入“商单修改”时会读取 Word 批注";
  if (kind === "audio") return "上传 MP3 后会自动转写到这里，也可以直接粘贴音频转写稿";
  return "粘贴原文、观点、开头、结尾或参考表达";
}

function sourceKindLabel(kind: WriterSource["kind"]) {
  if (kind === "link") return "链接";
  if (kind === "document") return "文档";
  if (kind === "audio") return "音频转写";
  return "文本";
}

function insertMention(prompt: string, label: string) {
  const mention = `@${label}`;
  if (!prompt.trim()) return `${mention} `;
  if (prompt.includes(mention)) return prompt;
  return `${prompt.trimEnd()} ${mention} `;
}

function readMentionQuery(target: HTMLTextAreaElement) {
  const cursor = target.selectionStart;
  const prefix = target.value.slice(0, cursor);
  const match = prefix.match(/(?:^|\s)@([\u4e00-\u9fa5\w-]*)$/);
  if (!match) return null;
  const query = match[1] || "";
  const atIndex = cursor - query.length - 1;
  return { start: atIndex, end: cursor, query };
}

async function readSourceFile(file: File): Promise<Pick<WriterSource, "kind" | "content" | "fileName">> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (isAudioSourceFile(file)) {
    const result = await transcribeAudioUpload(file);
    return { kind: "audio", content: result.transcript, fileName: result.fileName || file.name };
  }
  if (extension === "txt" || extension === "md") {
    return { kind: "document", content: await file.text(), fileName: file.name };
  }
  if (extension === "docx") {
    return { kind: "document", content: await readDocxText(file), fileName: file.name };
  }
  throw new Error("暂只支持 TXT、Markdown、Word .docx 和 MP3 等音频文件。");
}

function isAudioSourceFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return file.type.startsWith("audio/") || ["mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "mpeg", "mpga"].includes(extension);
}

async function readDocxText(file: File) {
  const mammoth = await import("mammoth/mammoth.browser").catch(() => null);
  if (!mammoth) throw new Error("当前缺少 Word 解析依赖 mammoth，请先安装后再导入 .docx。");
  const arrayBuffer = await file.arrayBuffer();
  const [result, comments] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer }),
    readDocxComments(arrayBuffer)
  ]);
  const body = result.value.trim();
  if (!comments.length) return body;
  return [
    "文档正文：",
    body || "（未读取到正文）",
    "",
    "客户批注：",
    ...comments.map((comment, index) => `${index + 1}. ${comment}`)
  ].join("\n");
}

async function readDocxComments(arrayBuffer: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const commentsXml = await zip.file("word/comments.xml")?.async("text");
  if (!commentsXml) return [];
  const document = new DOMParser().parseFromString(commentsXml, "application/xml");
  const comments = Array.from(document.getElementsByTagNameNS("*", "comment"));
  return comments
    .map((comment) =>
      Array.from(comment.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

function compareCreatedAtDesc(left: { createdAt: string }, right: { createdAt: string }) {
  return +new Date(right.createdAt) - +new Date(left.createdAt);
}

function WriterFallback() {
  return (
    <div className="page writer-page">
      <header className="page-header">
        <div>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              ✍️
            </span>
            <span>对话写作</span>
          </h1>
          <p className="subtle">正在读取写作台引用和历史记录。</p>
        </div>
      </header>
      <section className="panel">
        <div className="panel-inner">
          <p className="subtle">正在准备写作台…</p>
        </div>
      </section>
    </div>
  );
}
