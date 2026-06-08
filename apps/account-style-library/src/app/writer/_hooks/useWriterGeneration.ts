"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { rewriteSelection as requestRewriteSelection, saveDraft, writeCopy } from "@/lib/client";
import type {
  AccountDraftInput,
  AccountListItem,
  Draft,
  DraftInput,
  JobRecord,
  JobStartInput,
  ProjectDraftInput,
  ProjectListItem,
  WriteResult
} from "@/lib/types";

type DraftSaveBase = Omit<AccountDraftInput, "content"> | Omit<ProjectDraftInput, "content">;

type UseWriterGenerationInput = {
  activeJobs: JobRecord[];
  activeTitle?: string;
  busy: string;
  hasTaskInput: boolean;
  mode: Draft["mode"];
  normalizedPrompt: string;
  normalizedSourceText: string;
  onRevisionPreviewChange?: Dispatch<SetStateAction<RevisionPreviewSegment[]>>;
  recentJobs: JobRecord[];
  onDraftSaved?: (draft: Draft) => void;
  refresh: () => Promise<void>;
  routerPush: (href: string) => void;
  selectedAccount: AccountListItem | null;
  selectedProject: ProjectListItem | null;
  setBusy: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  startTask: (input: JobStartInput) => Promise<JobRecord>;
  targetType: "account" | "project";
  useWebResearch: boolean;
};

export type RevisionPreviewSegment = {
  text: string;
  changed: boolean;
};

export function useWriterGeneration({
  activeJobs,
  activeTitle,
  busy,
  hasTaskInput,
  mode,
  normalizedPrompt,
  normalizedSourceText,
  onRevisionPreviewChange,
  recentJobs,
  onDraftSaved,
  refresh,
  routerPush,
  selectedAccount,
  selectedProject,
  setBusy,
  setNotice,
  startTask,
  targetType,
  useWebResearch
}: UseWriterGenerationInput) {
  const [lastContent, setLastContent] = useState("");
  const [lastResearch, setLastResearch] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [lastDraftBase, setLastDraftBase] = useState<DraftSaveBase | null>(null);
  const [lastDraftId, setLastDraftId] = useState("");
  const [generateStage, setGenerateStage] = useState("");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [activeWriteJobId, setActiveWriteJobId] = useState("");
  const activeWriteJobIdRef = useRef("");
  const ignoredWriteJobIdsRef = useRef<Set<string>>(new Set());
  const handledWriteJobsRef = useRef<Set<string>>(new Set());

  const activeWriteJob = useMemo(() => {
    const candidates = [...activeJobs, ...recentJobs].filter((job) => job.kind === "write-copy");
    return activeWriteJobId ? candidates.find((job) => job.id === activeWriteJobId) || null : null;
  }, [activeJobs, activeWriteJobId, recentJobs]);
  const isGenerating = Boolean(activeWriteJob && (activeWriteJob.status === "queued" || activeWriteJob.status === "running"));
  const canGenerate = Boolean(hasTaskInput && !busy && !isGenerating && (targetType === "project" ? selectedProject : selectedAccount));
  const isBusinessRevision = normalizedPrompt.includes("商单修改");

  const clearActiveWriteJob = useCallback(() => {
    activeWriteJobIdRef.current = "";
    setActiveWriteJobId("");
  }, []);

  const detachActiveWriteJob = useCallback(() => {
    const activeId = activeWriteJobIdRef.current;
    if (activeId) ignoredWriteJobIdsRef.current.add(activeId);
    clearActiveWriteJob();
  }, [clearActiveWriteJob]);

  useEffect(() => {
    if (!activeWriteJob) return;
    if (ignoredWriteJobIdsRef.current.has(activeWriteJob.id)) {
      clearActiveWriteJob();
      return;
    }
    activeWriteJobIdRef.current = activeWriteJob.id;
    setActiveWriteJobId(activeWriteJob.id);
    setGenerateStage(activeWriteJob.message || "正在生成文案");
    setGenerateProgress(activeWriteJob.progress || 0);

    if (activeWriteJob.status === "running" || activeWriteJob.status === "queued") {
      if (activeWriteJob.partialText) setLastContent(activeWriteJob.partialText);
      setBusy("generate");
      return;
    }

    if (handledWriteJobsRef.current.has(activeWriteJob.id)) return;
    handledWriteJobsRef.current.add(activeWriteJob.id);
    setBusy("");

    if (activeWriteJob.status === "completed") {
      const result = activeWriteJob.result as WriteResult | undefined;
      if (result) {
        setLastContent(result.content);
        setLastResearch(result.research || "");
        setLastSavedContent(result.draft ? result.content : "");
        setLastDraftId(result.draft?.id || "");
        setLastDraftBase(result.draft ? draftToSaveBase(result.draft) : null);
        if (result.draft) {
          onDraftSaved?.(result.draft);
          void refresh();
        }
        setNotice(
          `${result.fallback ? result.fallbackReason || "模型暂不可用，已用本地模板生成，可继续编辑。" : `已调用 ${result.usedModel}${useWebResearch ? "，已启用联网检索" : ""}。`}已自动保存到历史记录。`
        );
      } else {
        setNotice("文案生成完成。");
      }
      setGenerateStage("生成完成");
      setGenerateProgress(100);
      clearActiveWriteJob();
      return;
    }

    if (activeWriteJob.status === "failed") {
      setNotice(activeWriteJob.error || "生成失败，请检查模型配置、代理或输入内容后重试。");
      setGenerateStage("生成失败");
      setGenerateProgress(100);
      clearActiveWriteJob();
    }
  }, [activeWriteJob, clearActiveWriteJob, onDraftSaved, refresh, setBusy, setNotice, useWebResearch]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setBusy("generate");
    setNotice("");
    setGenerateStage("准备写作任务");
    setGenerateProgress(6);
    setLastResearch("");
    onRevisionPreviewChange?.([]);

    if (isBusinessRevision) {
      if (!lastContent.trim()) {
        setNotice("请先在右侧生成结果里准备好要修改的文案，再输入“商单修改”并放入带批注的 Word 或飞书链接。");
        setBusy("");
        setGenerateStage("");
        setGenerateProgress(0);
        return;
      }
      if (!normalizedSourceText.trim()) {
        setNotice("请在输入源里拖入带批注的 Word，或粘贴飞书文档链接后再进行商单修改。");
        setBusy("");
        setGenerateStage("");
        setGenerateProgress(0);
        return;
      }

      try {
        setGenerateStage("正在按客户批注修改");
        setGenerateProgress(28);
        const result = await writeCopy({
          targetType,
          platform: targetType === "account" ? selectedAccount?.platform : undefined,
          accountId: targetType === "account" ? selectedAccount?.id : undefined,
          projectId: targetType === "project" ? selectedProject?.id : undefined,
          mode: "rewrite",
          prompt: buildBusinessRevisionPrompt(normalizedPrompt),
          sourceText: buildBusinessRevisionSourceText(lastContent, normalizedSourceText),
          save: false,
          useWebResearch: false
        });
        const parsed = parseRevisionMarkers(result.content);
        const cleanContent = parsed.cleanText.trim() || result.content.trim();
        detachActiveWriteJob();
        setLastContent(cleanContent);
        setLastResearch("");
        setLastSavedContent("");
        setLastDraftId("");
        setLastDraftBase(null);
        onRevisionPreviewChange?.(parsed.segments.length ? parsed.segments : [{ text: cleanContent, changed: false }]);
        setGenerateStage("商单修改完成");
        setGenerateProgress(100);
        setNotice("已按“商单修改”处理，右侧结果可继续手动编辑，标红预览用于核对改动。");
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "商单修改失败，请检查文档批注、飞书链接或模型配置后重试。");
        setGenerateStage("商单修改失败");
        setGenerateProgress(100);
      } finally {
        setBusy("");
      }
      return;
    }

    detachActiveWriteJob();
    setLastContent("");

    try {
      const job = await startTask({
        kind: "write-copy",
        title: mode === "topic" ? "生成主题文案" : "改写文案",
        inputSummary: activeTitle ? `${activeTitle} · ${mode === "topic" ? "主题写作" : "文案改写"}` : undefined,
        href: "/writer",
        input: {
          targetType,
          platform: targetType === "account" ? selectedAccount?.platform : undefined,
          accountId: targetType === "account" ? selectedAccount?.id : undefined,
          projectId: targetType === "project" ? selectedProject?.id : undefined,
          mode,
          prompt: normalizedPrompt,
          sourceText: normalizedSourceText,
          save: true,
          useWebResearch
        }
      });
      activeWriteJobIdRef.current = job.id;
      setActiveWriteJobId(job.id);
      setGenerateStage(job.message);
      setGenerateProgress(job.progress);
      setNotice("文案生成已在后台开始，可以切换到其他模块。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成失败，请检查模型配置、代理或输入内容后重试。");
    }
  }, [
    activeTitle,
    canGenerate,
    detachActiveWriteJob,
    mode,
    normalizedPrompt,
    normalizedSourceText,
    isBusinessRevision,
    lastContent,
    onRevisionPreviewChange,
    selectedAccount,
    selectedProject,
    setBusy,
    setNotice,
    startTask,
    targetType,
    useWebResearch
  ]);

  const handleOpenAssets = useCallback(async () => {
    if (!lastContent || !lastDraftBase) return;
    setBusy("assets");
    setNotice("");
    try {
      let draftId = lastDraftId;
      if (!draftId || lastSavedContent !== lastContent) {
        const payload: DraftInput =
          lastDraftBase.targetType === "project"
            ? {
                ...lastDraftBase,
                content: lastContent
              }
            : {
                ...lastDraftBase,
                content: lastContent
              };
        const draft = await saveDraft(payload);
        draftId = draft.id;
        setLastDraftId(draft.id);
        setLastSavedContent(lastContent);
        onDraftSaved?.(draft);
        await refresh();
      }
      routerPush(`/assets?draftId=${encodeURIComponent(draftId)}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "打开评论生成失败，请先保存当前结果后重试。");
    } finally {
      setBusy("");
    }
  }, [lastContent, lastDraftBase, lastDraftId, lastSavedContent, onDraftSaved, refresh, routerPush, setBusy, setNotice]);

  const copyLast = useCallback(async () => {
    if (!lastContent) return;
    await navigator.clipboard.writeText(lastContent);
    setNotice("生成结果已复制到剪贴板。");
  }, [lastContent, setNotice]);

  const updateLastContent = useCallback((content: string) => {
    detachActiveWriteJob();
    setLastContent(content);
    onRevisionPreviewChange?.([]);
  }, [detachActiveWriteJob, onRevisionPreviewChange]);

  const loadDraftResult = useCallback((draft: Draft) => {
    detachActiveWriteJob();
    setLastContent(draft.content);
    setLastResearch("");
    setLastSavedContent(draft.content);
    setLastDraftId(draft.id);
    setLastDraftBase(draftToSaveBase(draft));
    setGenerateStage("");
    setGenerateProgress(100);
    onRevisionPreviewChange?.([]);
  }, [detachActiveWriteJob, onRevisionPreviewChange]);

  const resetDraftState = useCallback(() => {
    setLastContent("");
    setLastResearch("");
    setLastSavedContent("");
    setLastDraftBase(null);
    setLastDraftId("");
    setGenerateStage("");
    setGenerateProgress(0);
    detachActiveWriteJob();
    onRevisionPreviewChange?.([]);
  }, [detachActiveWriteJob, onRevisionPreviewChange]);

  const rewriteSelection = useCallback(
    async (input: { selectedText: string; instruction: string; start: number; end: number }) => {
      if (!lastContent || !input.selectedText.trim() || !canGenerate) return;
      detachActiveWriteJob();
      const before = lastContent.slice(0, input.start);
      const selected = lastContent.slice(input.start, input.end);
      const after = lastContent.slice(input.end);
      if (selected !== input.selectedText) {
        setNotice("选区已变化，请重新选中需要改写的段落。");
        return;
      }

      setBusy("revise");
      setNotice("");
      try {
        const result = await requestRewriteSelection({
          fullText: lastContent,
          selectedText: selected,
          instruction: input.instruction
        });
        const replacement = cleanSelectionReplacement(result.content, selected);
        if (!replacement) {
          setNotice("局部改写没有返回可用内容，请换一个要求重试。");
          return;
        }
        detachActiveWriteJob();
        setLastContent(`${before}${replacement}${after}`);
        setLastSavedContent("");
        setLastDraftId("");
        onRevisionPreviewChange?.([]);
        setNotice("选中段落已替换，当前结果尚未重新保存。");
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "局部改写失败，请稍后重试。");
      } finally {
        setBusy("");
      }
    },
    [
      canGenerate,
      detachActiveWriteJob,
      lastContent,
      onRevisionPreviewChange,
      setBusy,
      setNotice,
    ]
  );

  return {
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
  };
}

function buildBusinessRevisionPrompt(prompt: string) {
  return [
    "商单修改模式：请根据客户批注/修改意见修改已有文案。",
    "只返回修改后的完整文案，不要输出解释、修改清单、分析过程、Markdown 表格或引用说明。",
    "请尽量保留原文结构和账号/项目风格，只改客户批注明确要求改的地方；批注不明确时做最小必要调整。",
    "凡是本次被你改动或新增的文字，必须用 [[RED]] 和 [[/RED]] 包起来；未改动文字不要加标记。",
    "如果输入源里只有飞书链接但没有可读取的批注正文，请优先根据用户在写作需求里的补充要求修改，不要编造客户批注。",
    "",
    "用户补充要求：",
    prompt.replace(/商单修改/g, "").trim() || "按客户批注内容修改。"
  ].join("\n");
}

function buildBusinessRevisionSourceText(currentDraft: string, sourceText: string) {
  return [
    "素材1：当前需要修改的文案",
    currentDraft,
    "",
    "---",
    "",
    "素材2：客户批注文档/修改资料",
    sourceText
  ].join("\n");
}

function parseRevisionMarkers(content: string): { cleanText: string; segments: RevisionPreviewSegment[] } {
  const segments: RevisionPreviewSegment[] = [];
  let cleanText = "";
  let cursor = 0;
  const markerPattern = /\[\[RED\]\]([\s\S]*?)\[\[\/RED\]\]/g;

  for (const match of content.matchAll(markerPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      const text = content.slice(cursor, index);
      cleanText += text;
      segments.push({ text, changed: false });
    }
    const changedText = match[1] || "";
    cleanText += changedText;
    segments.push({ text: changedText, changed: true });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    const text = content.slice(cursor);
    cleanText += text;
    segments.push({ text, changed: false });
  }

  return {
    cleanText,
    segments: mergeAdjacentRevisionSegments(segments.filter((segment) => segment.text))
  };
}

function mergeAdjacentRevisionSegments(segments: RevisionPreviewSegment[]) {
  return segments.reduce<RevisionPreviewSegment[]>((merged, segment) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.changed === segment.changed) {
      previous.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
    return merged;
  }, []);
}

function draftToSaveBase(draft: Draft): DraftSaveBase {
  if (draft.targetType === "project") {
    return {
      targetType: "project",
      projectId: draft.projectId,
      projectName: draft.projectName,
      title: draft.title,
      mode: draft.mode,
      prompt: draft.prompt,
      input: draft.input,
      styleRef: draft.styleRef
    };
  }

  return {
    platform: draft.platform,
    accountId: draft.accountId,
    accountName: draft.accountName,
    title: draft.title,
    mode: draft.mode,
    prompt: draft.prompt,
    input: draft.input,
    styleRef: draft.styleRef
  };
}

function cleanSelectionReplacement(text: string, fallback: string) {
  let value = String(text || "").trim();
  value = value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\s*|```/g, ""))
    .trim();
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  while (lines.length > 1 && /^(?:分析|解释|说明|修改|改写|方案|标题|替换文本|结果|以下是|我会|建议)[:：]/i.test(lines[0])) {
    lines.shift();
  }
  value = lines.join("\n").trim();
  value = value
    .replace(/^(?:替换文本|改写结果|修改后|结果|输出)[:：]\s*/i, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
  return value || fallback;
}
