import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createCopySourceProject,
  deleteCopySources,
  getCopySources,
  resolveCopySource,
  saveCopySource,
  updateCopySourceMaterialAnalysis
} from "@/lib/storage";
import { isFeishuDocumentUrl, readFeishuDocument } from "@/lib/feishu";
import { chatComplete } from "@/lib/ai";
import { extractRewriteSourceMaterial } from "@/lib/source-extraction";
import { resolveLinkSourceMedia, transcribeLinkSource } from "@/lib/transcription";
import { analyzeCopySourceMaterial, extractCopySourceThumbnail } from "@/lib/material-analysis";
import { clampText } from "@/lib/utils";
import type { CopySource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const transcribeSchema = z.object({
  action: z.literal("transcribe").optional(),
  url: z.string().url(),
  titleHint: z.string().optional(),
  analyzeVideo: z.boolean().optional()
});

const projectSchema = z.object({
  action: z.literal("create_project"),
  name: z.string().min(1),
  description: z.string().optional(),
  sourceMaterialIds: z.array(z.string().min(1)).min(1)
});

const ingestSchema = z.object({
  action: z.literal("ingest"),
  input: z.string().min(1),
  analyzeVideo: z.boolean().optional()
});

const deleteSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1)
});

const reanalyzeSchema = z.object({
  action: z.literal("reanalyze"),
  sourceId: z.string().min(1)
});

export async function GET() {
  try {
    return NextResponse.json({ sources: await getCopySources() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取文案素材失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectInput = projectSchema.safeParse(body);
    if (projectInput.success) {
      return NextResponse.json({
        project: await createCopySourceProject(projectInput.data)
      });
    }

    const reanalyzeInput = reanalyzeSchema.safeParse(body);
    if (reanalyzeInput.success) {
      const source = await resolveCopySource(reanalyzeInput.data.sourceId);
      const media = await resolveLinkSourceMedia({
        url: source.url,
        resolvedUrl: source.resolvedUrl,
        platform: source.platform
      });
      const materialAnalysis = await analyzeCopySourceMaterial({
        mediaUrls: media.mediaUrls,
        platform: media.platform,
        title: media.title || source.title,
        transcript: source.transcript,
        url: media.resolvedUrl || source.resolvedUrl || source.url
      });
      const updated = await updateCopySourceMaterialAnalysis(source.id, materialAnalysis);
      return NextResponse.json({ source: updated });
    }

    const ingestInput = ingestSchema.safeParse(body);
    if (ingestInput.success) {
      return NextResponse.json(await ingestCopySources(ingestInput.data));
    }

    const input = transcribeSchema.parse(body);
    const result = await transcribeLinkSource({
      url: input.url,
      titleHint: input.titleHint,
      analyzeVideo: Boolean(input.analyzeVideo)
    });
    const materialAnalysis = input.analyzeVideo
      ? await analyzeCopySourceMaterial({
          mediaUrls: result.mediaUrls || [],
          platform: result.platform,
          title: result.title,
          transcript: result.text,
          url: result.resolvedUrl || result.url
        })
      : undefined;
    const thumbnailBytes = await extractCopySourceThumbnail(result.mediaUrls || []).catch(() => null);
    const source = await saveCopySource({
      title: result.title,
      platform: result.platform,
      url: result.url,
      resolvedUrl: result.resolvedUrl,
      transcript: result.text,
      thumbnailBytes: thumbnailBytes || undefined,
      source: result.source,
      fallback: result.fallback,
      fallbackReason: result.fallbackReason,
      materialAnalysis
    });

    return NextResponse.json({ source, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "链接转写失败" },
      { status: 400 }
    );
  }
}

async function ingestCopySources(input: z.infer<typeof ingestSchema>) {
  const extraction = extractRewriteSourceMaterial(input.input);
  const sources: CopySource[] = [];
  const failed: Array<{ label: string; error: string }> = [];

  for (const material of extraction.materials) {
    const label = `素材 ${material.index}`;
    if (!material.urls.length) {
      try {
        sources.push(await saveManualCopySource({
          label,
          text: material.text || material.raw
        }));
      } catch (error) {
        failed.push({ label, error: describeError(error, "纯文本素材入库失败") });
      }
      continue;
    }

    for (const url of material.urls) {
      try {
        if (isFeishuDocumentUrl(url)) {
          sources.push(await saveFeishuCopySource(url, material.text));
          continue;
        }
        sources.push(await saveTranscribedLinkCopySource({
          url,
          titleHint: material.text || undefined,
          supplementText: material.text,
          analyzeVideo: Boolean(input.analyzeVideo)
        }));
      } catch (error) {
        failed.push({ label: url, error: describeError(error, "素材解析失败") });
      }
    }
  }

  if (!sources.length && failed.length) {
    throw new Error(failed.map((item) => `${item.label}: ${item.error}`).join("\n"));
  }

  return {
    sources,
    failed,
    extraction: {
      materialCount: extraction.materials.length,
      linkCount: extraction.linkCount,
      textMaterialCount: extraction.textMaterialCount
    }
  };
}

async function saveManualCopySource(input: { label: string; text: string }) {
  const rawText = input.text.trim();
  if (!rawText) throw new Error("素材内容为空");
  const url = manualSourceUrl(input.label);
  const summarized = await summarizeBfMaterial({
    rawText,
    titleHint: input.label,
    sourceLabel: "用户输入素材"
  });
  const transcript = summarized.text;
  const title = firstLineTitle(transcript, input.label);
  const materialAnalysis = await analyzeCopySourceMaterial({
    mediaUrls: [],
    platform: "unknown",
    title,
    transcript,
    url
  });
  return saveCopySource({
    title,
    platform: "unknown",
    url,
    transcript,
    source: "manual",
    fallback: summarized.fallback || undefined,
    fallbackReason: summarized.fallbackReason,
    materialAnalysis
  });
}

async function saveFeishuCopySource(url: string, supplementText?: string) {
  const result = await readFeishuDocument({ url, includeComments: true });
  const rawText = [
    supplementText?.trim() ? `补充说明：\n${supplementText.trim()}` : "",
    `飞书文档正文：\n${result.text}`,
    result.comments.length ? `飞书批注 / 客户意见：\n${result.comments.join("\n\n")}` : "",
    !result.comments.length && result.commentError ? `批注读取说明：${result.commentError}` : ""
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const summarized = await summarizeBfMaterial({
    rawText,
    titleHint: result.title,
    sourceLabel: "飞书文档素材"
  });
  const transcript = summarized.text;
  const title = firstLineTitle(transcript, result.title);
  const materialAnalysis = await analyzeCopySourceMaterial({
    mediaUrls: [],
    platform: "unknown",
    title,
    transcript,
    url
  });
  return saveCopySource({
    title,
    platform: "unknown",
    url,
    resolvedUrl: url,
    transcript,
    source: "manual",
    fallback: summarized.fallback || undefined,
    fallbackReason: summarized.fallbackReason,
    materialAnalysis
  });
}

async function saveTranscribedLinkCopySource(input: {
  url: string;
  titleHint?: string;
  supplementText?: string;
  analyzeVideo: boolean;
}) {
  const result = await transcribeLinkSource({
    url: input.url,
    titleHint: input.titleHint,
    analyzeVideo: input.analyzeVideo
  });
  const transcript = input.supplementText?.trim()
    ? `补充说明：\n${input.supplementText.trim()}\n\n视频转写：\n${result.text}`
    : result.text;
  const materialAnalysis = input.analyzeVideo
    ? await analyzeCopySourceMaterial({
        mediaUrls: result.mediaUrls || [],
        platform: result.platform,
        title: result.title,
        transcript,
        url: result.resolvedUrl || result.url
      })
    : undefined;
  const thumbnailBytes = await extractCopySourceThumbnail(result.mediaUrls || []).catch(() => null);
  return saveCopySource({
    title: result.title || input.titleHint,
    platform: result.platform,
    url: result.url,
    resolvedUrl: result.resolvedUrl,
    transcript,
    thumbnailBytes: thumbnailBytes || undefined,
    source: result.source,
    fallback: result.fallback,
    fallbackReason: result.fallbackReason,
    materialAnalysis
  });
}

async function summarizeBfMaterial(input: {
  rawText: string;
  titleHint?: string;
  sourceLabel: string;
}): Promise<{ text: string; fallback: boolean; fallbackReason?: string }> {
  const rawText = input.rawText.trim();
  const localSummary = buildLocalBfSummary(rawText, input.titleHint, input.sourceLabel);
  if (!rawText) return { text: localSummary, fallback: true, fallbackReason: "素材内容为空，已生成空素材摘要。" };

  const result = await chatComplete([
    {
      role: "system",
      content: [
        "你是项目素材入库助手，负责把用户给的 BF/brief/需求文档/飞书正文整理成可用于后续项目风格学习和文案创作的素材摘要。",
        "必须只基于原文，不要补充没有出现的信息；不确定的信息写入待确认。",
        "输出中文 Markdown。第一行必须是一个可读标题，格式为“# 标题”，标题不要超过 24 个字。",
        "不要输出完整原文，不要写寒暄。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `素材来源：${input.sourceLabel}`,
        input.titleHint?.trim() ? `标题线索：${input.titleHint.trim()}` : "",
        "请按下面结构总结后再入库：",
        "## 核心需求",
        "## 必须保留的信息",
        "## 禁止/注意事项",
        "## 可用卖点/素材线索",
        "## 写作/画面方向",
        "## 待确认问题",
        "",
        "原始素材：",
        clampText(rawText, 7000)
      ]
        .filter(Boolean)
        .join("\n")
    }
  ], "low");

  const modelSummary = normalizeBfSummary(result.text);
  if (modelSummary) {
    return {
      text: modelSummary,
      fallback: result.fallback,
      fallbackReason: result.fallback ? result.fallbackReason || "模型未返回可用摘要，已使用本地摘要。" : undefined
    };
  }

  return {
    text: localSummary,
    fallback: true,
    fallbackReason: result.fallbackReason || "模型未返回可用摘要，已使用本地摘要。"
  };
}

function buildLocalBfSummary(rawText: string, titleHint?: string, sourceLabel?: string) {
  const normalized = rawText.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const title = cleanSummaryTitle(titleHint || firstMeaningfulLine(normalized) || sourceLabel || "BF素材摘要");
  const lines = collectMeaningfulLines(normalized);
  const keyLines = lines.slice(0, 8);
  const attentionLines = lines
    .filter((line) => /不要|禁止|必须|需要|注意|要求|保留|避开|不能|务必|客户|批注|修改/.test(line))
    .slice(0, 6);
  const sellingLines = lines
    .filter((line) => /卖点|优势|亮点|痛点|场景|人群|价格|权益|活动|功能|效果|案例/.test(line))
    .slice(0, 6);

  return [
    `# ${title}`,
    "",
    "## 核心需求",
    bulletLines(keyLines, "原始素材较短或结构不明确，请结合后续项目信息确认核心需求。"),
    "",
    "## 必须保留的信息",
    bulletLines(attentionLines.length ? attentionLines : keyLines.slice(0, 4), "原文未明确列出必须保留的信息。"),
    "",
    "## 禁止/注意事项",
    bulletLines(attentionLines, "原文未明确列出禁止项或特殊注意事项。"),
    "",
    "## 可用卖点/素材线索",
    bulletLines(sellingLines.length ? sellingLines : keyLines.slice(0, 5), "原文未明确列出卖点线索。"),
    "",
    "## 写作/画面方向",
    "- 依据上述需求和线索生成内容，避免扩写原文没有提供的事实。",
    "",
    "## 待确认问题",
    "- 核心目标、投放/发布平台、目标人群、交付形式如原文未写明，需要继续确认。"
  ].join("\n");
}

function normalizeBfSummary(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const withoutFence = trimmed
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!withoutFence) return "";
  return withoutFence.startsWith("# ") ? withoutFence : `# ${cleanSummaryTitle(firstMeaningfulLine(withoutFence) || "BF素材摘要")}\n\n${withoutFence}`;
}

function bulletLines(lines: string[], fallback: string) {
  const uniqueLines = [...new Set(lines.map((line) => clampText(line.trim(), 180)).filter(Boolean))];
  return uniqueLines.length ? uniqueLines.map((line) => `- ${line}`).join("\n") : `- ${fallback}`;
}

function collectMeaningfulLines(text: string) {
  return text
    .split(/\n|[。！？!?]\s*/g)
    .map((line) => line.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter((line) => line.length >= 4)
    .slice(0, 40);
}

function firstMeaningfulLine(text: string) {
  return collectMeaningfulLines(text)[0] || "";
}

function manualSourceUrl(label: string) {
  return `manual://project-workbench/${encodeURIComponent(label)}-${Date.now()}`;
}

function firstLineTitle(text: string, fallback: string) {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return cleanSummaryTitle(firstLine || fallback).slice(0, 80) || fallback;
}

function cleanSummaryTitle(input: string) {
  return input
    .replace(/^#+\s*/, "")
    .replace(/^标题[：:]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function describeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    return NextResponse.json(await deleteCopySources(input.sourceIds));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除文案素材失败" },
      { status: 400 }
    );
  }
}
