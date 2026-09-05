import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { parseCsvImport } from "@/lib/csv-import";
import type { NormalizedImportEpisode, ParsedImportFeed } from "@/lib/online-import-types";

function text(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function germanDate(value: string): string | null {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return match ? validDate(`${match[3]}-${match[2]}-${match[1]}`) : null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim()) && Number(value) > 0) return Number(value);
  return null;
}

function safeHttpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function uniqueLinks(links: Array<{ label: string; url: string }>): Array<{ label: string; url: string }> {
  return links.filter((link, index) => links.findIndex((item) => item.url === link.url) === index);
}

export function normalizeTitle(value: string): string {
  return text(value)
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(die drei \?\?\?|tkkg)\s*[-–:]?\s*/i, "")
    .replace(/[^a-z0-9äöüß]+/gi, " ")
    .trim();
}

export function stableEpisodeKey(externalId: string, title: string): string {
  const slug = normalizeTitle(title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55) || "folge";
  return `${slug}-${createHash("sha256").update(externalId).digest("hex").slice(0, 12)}`;
}

export function parseDreiFragezeichenPage(html: string, pageUrl: string): ParsedImportFeed {
  const $ = cheerio.load(html);
  const episodes: NormalizedImportEpisode[] = [];
  const issues: ParsedImportFeed["issues"] = [];
  $(".card-expandable").each((index, element) => {
    const card = $(element);
    const detailAnchor = card.find('a[href*="/produktwelt/details/"]').first();
    const canonicalUrl = safeHttpUrl(detailAnchor.attr("href"), pageUrl);
    const title = text(detailAnchor.attr("aria-label") || card.find(".card-title").first().text());
    if (!canonicalUrl || !title) {
      if (card.find(".card-title").length) issues.push({ item: `Karte ${index + 1}`, message: "Titel oder stabile Detail-URL fehlt." });
      return;
    }
    const metadata = text(card.find(".card-expander-content-title").text());
    const numberText = text(card.find(".card-content span, .card > span").first().text() || card.find(".card-expander-content-title .d-block").first().text());
    const number = numberText.match(/^Folge\s+(\d+[a-z]?)$/i)?.[1] || null;
    const releaseDate = germanDate(metadata);
    const links: Array<{ label: string; url: string }> = [{ label: "Mehr Infos", url: canonicalUrl }];
    card.find('.social-row a[href^="http"]').each((_, link) => {
      const url = safeHttpUrl($(link).attr("href"));
      if (!url) return;
      const style = ($(link).attr("style") || "").toLowerCase();
      const label = style.includes("spotify") ? "Spotify" : style.includes("audible") ? "Audible" : style.includes("amazon") ? "Amazon Music" : "Anhören";
      links.push({ label, url });
    });
    episodes.push({
      externalId: canonicalUrl,
      title,
      numberLabel: number,
      sortOrder: positiveInteger(number),
      releaseDate,
      durationMinutes: null,
      priorityOnRelease: Boolean(releaseDate),
      links: uniqueLinks(links),
      canonicalUrl,
    });
  });
  return { episodes, issues, warnings: [] };
}

export function parseTkkgPage(html: string, pageUrl: string): ParsedImportFeed {
  const $ = cheerio.load(html);
  const episodes: NormalizedImportEpisode[] = [];
  const issues: ParsedImportFeed["issues"] = [];
  $('a.modal-trigger[href*="/produkte/details/"]').each((index, element) => {
    const anchor = $(element);
    const canonicalUrl = safeHttpUrl(anchor.attr("href"), pageUrl);
    const card = anchor.closest(".teaser");
    const title = text(card.find(".teaser-headline h3").first().text());
    const target = anchor.attr("data-modal") || "";
    const detail = target.startsWith("#") ? $(target) : cheerio.load("")("body");
    const metadata = text(detail.find("h4").first().text());
    const number = metadata.match(/Hörspiel-Folge\s+(\d+[a-z]?)/i)?.[1] || null;
    const listenUrl = safeHttpUrl(detail.find('a[href*="lnk.to"]').first().attr("href"));
    if (!canonicalUrl || !title) {
      issues.push({ item: `Karte ${index + 1}`, message: "Titel oder stabile Detail-URL fehlt." });
      return;
    }
    const links = [{ label: "Mehr Infos", url: canonicalUrl }];
    if (listenUrl) links.unshift({ label: "Anhören", url: listenUrl });
    episodes.push({
      externalId: canonicalUrl,
      title,
      numberLabel: number,
      sortOrder: positiveInteger(number),
      releaseDate: null,
      durationMinutes: null,
      priorityOnRelease: false,
      links,
      canonicalUrl,
    });
  });
  return { episodes, issues, warnings: [] };
}

function parsedJsonEpisode(value: unknown, index: number): { episode?: NormalizedImportEpisode; issue?: string } {
  if (!value || typeof value !== "object") return { issue: `Episode ${index + 1} ist kein Objekt.` };
  const item = value as Record<string, unknown>;
  if (typeof item.external_id !== "string" || !item.external_id.trim()) return { issue: `Episode ${index + 1}: external_id fehlt.` };
  if (typeof item.title !== "string" || !item.title.trim()) return { issue: `Episode ${index + 1}: title fehlt.` };
  const rawLinks = Array.isArray(item.links) ? item.links : [];
  const links: Array<{ label: string; url: string }> = [];
  for (const rawLink of rawLinks) {
    if (!rawLink || typeof rawLink !== "object") continue;
    const link = rawLink as Record<string, unknown>;
    const url = safeHttpUrl(link.url);
    if (url && typeof link.label === "string" && link.label.trim()) links.push({ label: text(link.label), url });
  }
  const releaseDate = item.release_date == null ? null : validDate(item.release_date);
  if (item.release_date != null && !releaseDate) return { issue: `Episode ${index + 1}: release_date ist ungültig.` };
  return { episode: {
    externalId: item.external_id.trim(),
    title: text(item.title),
    numberLabel: typeof item.number_label === "string" && item.number_label.trim() ? text(item.number_label) : null,
    sortOrder: positiveInteger(item.sort_order),
    releaseDate,
    durationMinutes: positiveInteger(item.duration_minutes),
    priorityOnRelease: item.priority_on_release === true,
    links: uniqueLinks(links),
    canonicalUrl: safeHttpUrl(item.canonical_url),
  } };
}

export function parseJsonFeed(input: string): ParsedImportFeed {
  let document: unknown;
  try { document = JSON.parse(input); } catch { return { episodes: [], issues: [{ item: "JSON", message: "Ungültiges JSON." }], warnings: [] }; }
  if (!document || typeof document !== "object") return { episodes: [], issues: [{ item: "JSON", message: "Das Dokument muss ein Objekt sein." }], warnings: [] };
  const root = document as Record<string, unknown>;
  if (root.version !== 1 && root.version !== "1") return { episodes: [], issues: [{ item: "version", message: "Unterstützt wird version 1." }], warnings: [] };
  if (!Array.isArray(root.episodes)) return { episodes: [], issues: [{ item: "episodes", message: "episodes[] fehlt." }], warnings: [] };
  const episodes: NormalizedImportEpisode[] = [];
  const issues: ParsedImportFeed["issues"] = [];
  root.episodes.forEach((item, index) => {
    const parsed = parsedJsonEpisode(item, index);
    if (parsed.episode) episodes.push(parsed.episode);
    if (parsed.issue) issues.push({ item: String(index + 1), message: parsed.issue });
  });
  return { episodes, issues, warnings: [] };
}

export function parseCsvFeed(input: string, today: string): ParsedImportFeed {
  const preview = parseCsvImport(input, today);
  return {
    episodes: preview.episodes.map((episode) => ({
      externalId: episode.episodeKey,
      title: episode.title,
      numberLabel: episode.numberLabel,
      sortOrder: episode.sortOrder,
      releaseDate: episode.releaseDate,
      durationMinutes: episode.durationMinutes,
      priorityOnRelease: episode.priorityOnRelease,
      links: episode.links,
      canonicalUrl: null,
    })),
    issues: [
      ...preview.issues.map((issue) => ({ item: `Zeile ${issue.row}`, message: issue.message })),
      ...(preview.summary.series > 1 ? [{ item: "series_key", message: "Eine Online-Quelle darf nur eine Serie enthalten." }] : []),
    ],
    warnings: [],
  };
}

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function rssText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return String((value as Record<string, unknown>)["#text"] || "");
  return "";
}

function rssDuration(value: unknown): number | null {
  const raw = rssText(value).trim();
  if (!raw) return null;
  const parts = raw.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null;
}

export function parseRssFeed(input: string): ParsedImportFeed {
  let document: Record<string, unknown>;
  try {
    if (/<!DOCTYPE/i.test(input)) throw new Error("DOCTYPE ist nicht erlaubt.");
    document = new XMLParser({ ignoreAttributes: false, processEntities: false, trimValues: true }).parse(input) as Record<string, unknown>;
  } catch (error) {
    return { episodes: [], issues: [{ item: "RSS", message: error instanceof Error ? error.message : "RSS konnte nicht gelesen werden." }], warnings: [] };
  }
  const channel = (document.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const atom = document.feed as Record<string, unknown> | undefined;
  const rawItems = channel ? array(channel.item) : atom ? array(atom.entry) : [];
  const episodes: NormalizedImportEpisode[] = [];
  const issues: ParsedImportFeed["issues"] = [];
  const warnings: string[] = [];
  rawItems.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as Record<string, unknown>;
    const title = text(rssText(item.title));
    const rawLinks = array(item.link);
    const link = rawLinks.map((candidate) => {
      if (typeof candidate === "string") return safeHttpUrl(candidate);
      if (candidate && typeof candidate === "object") return safeHttpUrl((candidate as Record<string, unknown>)["@_href"]);
      return null;
    }).find(Boolean) || null;
    const enclosureValue = item.enclosure;
    const enclosure = enclosureValue && typeof enclosureValue === "object" ? safeHttpUrl((enclosureValue as Record<string, unknown>)["@_url"]) : null;
    const guid = text(rssText(item.guid || item.id));
    const externalId = guid || link;
    if (!title || !externalId) {
      issues.push({ item: String(index + 1), message: "Titel sowie guid/id oder Link werden benötigt." });
      return;
    }
    if (!guid) warnings.push(`„${title}“ verwendet den Link als externe ID.`);
    const published = rssText(item.pubDate || item.published || item.updated);
    const parsedDate = published ? new Date(published) : null;
    const releaseDate = parsedDate && !Number.isNaN(parsedDate.valueOf()) ? parsedDate.toISOString().slice(0, 10) : null;
    const number = title.match(/^\s*(?:folge|episode)\s*#?\s*(\d+[a-z]?)\s*[:\-–]/i)?.[1] || null;
    const links: Array<{ label: string; url: string }> = [];
    if (enclosure) links.push({ label: "Audio", url: enclosure });
    if (link) links.push({ label: "Mehr Infos", url: link });
    episodes.push({
      externalId,
      title,
      numberLabel: number,
      sortOrder: positiveInteger(number),
      releaseDate,
      durationMinutes: rssDuration(item["itunes:duration"] || item.duration),
      priorityOnRelease: Boolean(releaseDate),
      links: uniqueLinks(links),
      canonicalUrl: link,
    });
  });
  return { episodes, issues, warnings };
}

export function deduplicateFeed(feed: ParsedImportFeed): ParsedImportFeed {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const episode of feed.episodes) {
    if (seen.has(episode.externalId)) duplicates.add(episode.externalId);
    seen.add(episode.externalId);
  }
  if (!duplicates.size) return feed;
  return {
    ...feed,
    issues: [...feed.issues, ...[...duplicates].map((id) => ({ item: id, message: "Externe ID kommt mehrfach vor." }))],
  };
}

export function maxPaginationPage(html: string, pageUrl: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $('a[href*="page="]').each((_, element) => {
    const href = safeHttpUrl($(element).attr("href"), pageUrl);
    if (!href) return;
    const page = Number(new URL(href).searchParams.get("page"));
    if (Number.isInteger(page) && page > max) max = page;
  });
  return Math.min(max, 50);
}
