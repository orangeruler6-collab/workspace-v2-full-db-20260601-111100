"use client";

import { useRef, type KeyboardEvent } from "react";
import { FileUp, LinkIcon, X } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";
import { formatJob, type LinkJob, type MaterialIngestStats } from "./project-workbench-utils";

type SourceAddModalProps = {
  busy: string;
  jobs: LinkJob[];
  linkAnalyzeVideo: boolean;
  linkInput: string;
  parsedMaterialStats: MaterialIngestStats;
  onClose: () => void;
  onLinkAnalyzeVideoChange: (enabled: boolean) => void;
  onLinkInputChange: (value: string) => void;
  onNotice: (message: string) => void;
  onTranscribeLinks: () => void;
};

export function SourceAddModal({
  busy,
  jobs,
  linkAnalyzeVideo,
  linkInput,
  parsedMaterialStats,
  onClose,
  onLinkAnalyzeVideoChange,
  onLinkInputChange,
  onNotice,
  onTranscribeLinks
}: SourceAddModalProps) {
  const locked = busy === "links";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSubmit = Boolean(linkInput.trim());

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !locked) onClose();
  }

  async function importFiles(files: FileList | File[]) {
    const loaded: string[] = [];
    const currentInput = linkInput.trim();
    const normalizedCurrentInput = currentInput && !hasExplicitMaterialHeader(currentInput) ? `【素材 1】\n${currentInput}` : currentInput;
    const startIndex = normalizedCurrentInput ? countExplicitMaterialBlocks(normalizedCurrentInput) + 1 : 1;
    for (const [index, file] of Array.from(files).entries()) {
      try {
        loaded.push(await readSourceFile(file, startIndex + index));
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "读取文档失败");
      }
    }
    if (!loaded.length) return;
    const nextText = [normalizedCurrentInput, ...loaded].filter(Boolean).join("\n\n---\n\n");
    onLinkInputChange(nextText);
    onNotice(`已导入 ${loaded.length} 份文档。`);
  }

  return (
    <div
      className="modal-backdrop"
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (!locked && isBackdropEvent(event)) onClose();
      }}
    >
      <div aria-labelledby="source-add-title" aria-modal="true" className="modal-panel project-source-add-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="source-add-title">添加素材</h2>
            <p className="pane-subtitle">粘贴纯文字、飞书链接、B站 / 抖音链接，或导入文档后加入当前项目素材池。</p>
          </div>
          <button className="btn icon-btn" aria-label="关闭添加素材弹窗" disabled={locked} onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="project-source-add-body">
          <label className="field">
            <span>素材输入</span>
            <textarea
              autoComplete="off"
              className="project-workbench-linkbox source-add-linkbox"
              disabled={locked}
              value={linkInput}
              onChange={(event) => onLinkInputChange(event.target.value)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!locked && event.dataTransfer.files.length) void importFiles(event.dataTransfer.files);
              }}
              placeholder="可粘贴 BF、纯文字、飞书文档链接、B站 / 抖音链接；多份素材可用 --- 分隔"
            />
          </label>

          <div className="source-add-actions">
            <span>支持 TXT / MD / Word .docx</span>
            <input
              ref={fileInputRef}
              hidden
              multiple
              accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (files?.length) void importFiles(files);
                event.currentTarget.value = "";
              }}
              type="file"
            />
            <button className="btn" disabled={locked} onClick={() => fileInputRef.current?.click()} type="button">
              <FileUp aria-hidden="true" size={16} />
              导入文档
            </button>
          </div>

          <label className={`source-analysis-option ${linkAnalyzeVideo ? "active" : ""}`}>
            <input checked={linkAnalyzeVideo} disabled={locked} onChange={(event) => onLinkAnalyzeVideoChange(event.target.checked)} type="checkbox" />
            <span>
              <strong>视频素材生成画面描述</strong>
              <small>遇到 B站 / 抖音链接时转写并抽关键帧；纯文本、飞书和文档会保存正文与批注线索。</small>
            </span>
          </label>

          <div className="source-add-actions">
            <span>
              识别 {parsedMaterialStats.materialCount} 份 / {parsedMaterialStats.linkCount} 条链接 / {parsedMaterialStats.textMaterialCount} 段文本
            </span>
            <button className="btn primary" disabled={!canSubmit || locked} onClick={onTranscribeLinks} type="button">
              <LinkIcon aria-hidden="true" size={16} />
              {locked ? "解析中" : "解析并加入"}
            </button>
          </div>

          {jobs.length ? <ProjectLinkJobList jobs={jobs} /> : null}
        </div>
      </div>
    </div>
  );
}

async function readSourceFile(file: File, index: number) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (extension === "txt" || extension === "md") {
    return formatImportedDocument(index, file.name, await file.text());
  }
  if (extension === "docx") {
    return formatImportedDocument(index, file.name, await readDocxText(file));
  }
  throw new Error("暂只支持 TXT、Markdown 和 Word .docx 文档。");
}

function formatImportedDocument(index: number, fileName: string, content: string) {
  return [`【素材 ${index}】`, `文件: ${fileName}`, content.trim()].filter(Boolean).join("\n");
}

function hasExplicitMaterialHeader(input: string) {
  return /^(【\s*素材\s*\d+\s*】|素材\s*\d+\s*[：:]|Material\s+\d+\s*:)/i.test(input.trim());
}

function countExplicitMaterialBlocks(input: string) {
  return input
    .split(/\n\s*---\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter(hasExplicitMaterialHeader).length || 1;
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

function ProjectLinkJobList({ jobs }: { jobs: LinkJob[] }) {
  return (
    <div className="project-workbench-job-list">
      {jobs.map((job) => (
        <div className={`project-workbench-job ${job.status}`} key={job.url}>
          <span className={`status-pill ${job.status === "completed" ? "done" : job.status === "failed" ? "failed" : "pending"}`}>{formatJob(job.status)}</span>
          <span>{job.message || job.url}</span>
        </div>
      ))}
    </div>
  );
}
