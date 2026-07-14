import { extractFirstLinkFromInput, normalizeLinkInput } from "./platform-links";
import type { CollectOrder, Platform, Video } from "./types";
import { shortHash } from "./utils";

export type CollectTarget = {
  lookupName: string;
  uidOrUrl: string;
  displayNameFallback: string;
};

export function resolveCollectTarget(platform: Platform, input: string): CollectTarget {
  const lookupName = input.trim();
  const inlineReference = extractInlineAccountReference(platform, lookupName);
  const inlineLabel = inlineReference ? removeInlineReferenceLabel(lookupName) : "";
  return {
    lookupName,
    uidOrUrl: inlineReference,
    displayNameFallback: inlineReference
      ? inlineLabel || fallbackAccountName(platform, inlineReference)
      : lookupName
  };
}

export function isValidAccountUid(platform: Platform, value: string) {
  const token = value.trim();
  return platform === "bilibili"
    ? /^\d{4,}$/.test(token)
    : /^MS4wLjAB[0-9A-Za-z_.-]{20,}$/.test(token);
}

export function accountSourceUrl(platform: Platform, uid: string) {
  return platform === "bilibili"
    ? `https://space.bilibili.com/${encodeURIComponent(uid)}`
    : `https://www.douyin.com/user/${encodeURIComponent(uid)}`;
}

export function selectCollectedVideos(videos: Video[], limit: number, order: CollectOrder, fromDate?: string, toDate?: string) {
  const from = parseBoundaryDate(fromDate, "start");
  const to = parseBoundaryDate(toDate, "end");
  const filtered = from || to
    ? videos.filter((video) => {
        const publishedAt = parsePublishedAt(video.publishedAt);
        if (!publishedAt) return false;
        if (from && publishedAt < from) return false;
        if (to && publishedAt > to) return false;
        return true;
      })
    : videos;
  return [...filtered].sort((left, right) => compareVideos(right, left, order)).slice(0, limit);
}

function extractInlineAccountReference(platform: Platform, input: string) {
  const link = extractFirstLinkFromInput(input, { kind: "account" });
  if (link && isPlatformAccountProfileUrl(platform, link)) {
    return normalizeLinkInput(link, { kind: "account" });
  }
  return isValidAccountUid(platform, input) ? input.trim() : "";
}

function isPlatformAccountProfileUrl(platform: Platform, input: string) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const host = parsed.hostname.toLowerCase();
    if (platform === "bilibili") return host.endsWith("bilibili.com") && /^\/\d+/.test(parsed.pathname);
    if (!/(^|\.)douyin\.com$/.test(host) && !/(^|\.)iesdouyin\.com$/.test(host)) return false;
    return /\/(?:user|share\/user)\//i.test(parsed.pathname) || parsed.searchParams.has("sec_uid");
  } catch {
    return false;
  }
}

function removeInlineReferenceLabel(input: string) {
  const link = extractFirstLinkFromInput(input, { kind: "account" });
  if (!link) return "";
  return input.replace(link, "").replace(/https?:\/\/\S+/i, "").replace(/\s+/g, " ").trim();
}

function fallbackAccountName(platform: Platform, uidOrUrl: string) {
  return `${platform === "bilibili" ? "B站账号" : "抖音账号"} ${shortHash(uidOrUrl)}`;
}

function compareVideos(left: Video, right: Video, order: CollectOrder) {
  if (order === "pubdate") return dateValue(left.publishedAt) - dateValue(right.publishedAt);
  return statValue(left, order) - statValue(right, order)
    || left.stats.views - right.stats.views
    || left.stats.likes - right.stats.likes
    || dateValue(left.publishedAt) - dateValue(right.publishedAt);
}

function statValue(video: Video, order: Exclude<CollectOrder, "pubdate">) {
  if (order === "views") return video.stats.views;
  if (order === "likes") return video.stats.likes;
  if (order === "favorites") return video.stats.favorites;
  return video.stats.comments;
}

function parseBoundaryDate(value: string | undefined, boundary: "start" | "end") {
  if (!value) return null;
  const date = new Date(`${value}T${boundary === "start" ? "00:00:00" : "23:59:59"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePublishedAt(value?: string) {
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateValue(value?: string) {
  return parsePublishedAt(value)?.getTime() || 0;
}
