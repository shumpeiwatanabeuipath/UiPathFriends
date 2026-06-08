import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const articlesPath = path.join(siteRoot, "articles.json");

const OFFICIAL_SOURCES = [
  {
    label: "UiPath公式ブログ",
    url: "https://www.uipath.com/ja/blog",
  },
  {
    label: "UiPath Community Blog",
    url: "https://www.uipath.com/ja/community-blog",
  },
];

const SOURCES = [
  { label: "Qiita", url: "https://qiita.com/search?q=UiPath" },
  { label: "note", url: "https://note.com/hashtag/UiPath" },
  ...OFFICIAL_SOURCES,
];

const now = new Date();
const since = new Date(now);
since.setMonth(since.getMonth() - 6);

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  const japanese = text.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (japanese) {
    const [, year, month, day] = japanese;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatDate(parsed);
}

function isWithinWindow(article) {
  if (!article.publishedAt) return false;
  return new Date(`${article.publishedAt}T00:00:00Z`) >= since;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function makeId(article) {
  return `${slugify(article.platform)}-${slugify(article.url || article.title)}-${article.publishedAt || "unknown"}`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "UiPathBlogCollectionBot/1.0 (+https://github.com/actions; static community link collection)",
      accept: "text/html,application/xhtml+xml,application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "UiPathBlogCollectionBot/1.0 (+https://github.com/actions; static community link collection)",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

function meta(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return stripTags(match[1]);
    }
  }

  return "";
}

function jsonLdValues(html) {
  const values = [];
  const pattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(stripTags(match[1]));
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Ignore malformed embedded JSON-LD.
    }
  }
  return values;
}

function firstJsonLdValue(html, field) {
  for (const item of jsonLdValues(html)) {
    const value = item?.[field];
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value === "object" && value.name) return value.name;
  }
  return "";
}

function pageTitle(html) {
  return (
    meta(html, ["og:title", "twitter:title"]) ||
    firstJsonLdValue(html, "headline") ||
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  ).replace(/\s*\|\s*UiPath.*$/i, "");
}

function pageSummary(html) {
  return (
    meta(html, ["description", "og:description", "twitter:description"]) ||
    firstJsonLdValue(html, "description") ||
    ""
  ).slice(0, 140);
}

function pageDate(html) {
  return normalizeDate(
    meta(html, ["article:published_time", "date", "publish_date"]) ||
      firstJsonLdValue(html, "datePublished") ||
      html.match(/datetime=["']([^"']+)["']/i)?.[1] ||
      html.match(/(20\d{2}年\d{1,2}月\d{1,2}日)/)?.[1],
  );
}

function pageAuthor(html, fallback) {
  return (
    meta(html, ["author", "article:author"]) ||
    firstJsonLdValue(html, "author") ||
    fallback
  );
}

function absoluteUrl(url, base) {
  try {
    return new URL(url, base).toString().split("#")[0];
  } catch {
    return "";
  }
}

function extractLinks(html, base, predicate) {
  const links = new Set();
  const pattern = /<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const url = absoluteUrl(decodeEntities(match[1]), base);
    if (url && predicate(url)) links.add(url);
  }
  return [...links];
}

async function collectQiita() {
  const queries = ["title:UiPath", "tag:UiPath"];
  const byId = new Map();

  for (const rawQuery of queries) {
    const query = encodeURIComponent(rawQuery);
    const url = `https://qiita.com/api/v2/items?page=1&per_page=100&query=${query}`;
    const items = await fetchJson(url);
    for (const item of items) {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()]
    .map((item) => ({
      id: `qiita-${item.id}`,
      title: item.title,
      author: item.user?.id || item.user?.name || "Qiita user",
      platform: "Qiita",
      url: item.url,
      publishedAt: normalizeDate(item.created_at),
      tags: ["UiPath", ...(item.tags || []).map((tag) => tag.name)].slice(0, 5),
      summary: `Qiitaに投稿されたUiPath関連記事。${(item.tags || [])
        .map((tag) => tag.name)
        .slice(0, 3)
        .join(" / ")}`,
    }))
    .filter(qiitaMatchesTitleOrTag)
    .filter(isWithinWindow);
}

function qiitaMatchesTitleOrTag(article) {
  if (article.platform !== "Qiita") return true;
  const titleMatches = /uipath/i.test(article.title || "");
  const tagMatches = (article.tags || []).some((tag) => /^uipath$/i.test(tag));
  return titleMatches || tagMatches;
}

async function collectNote() {
  const hashtagUrl = "https://note.com/hashtag/UiPath";
  const html = await fetchText(hashtagUrl);
  const links = extractLinks(
    html,
    hashtagUrl,
    (url) => /^https:\/\/note\.com\/[^/]+\/n\/n[a-z0-9]+/i.test(url),
  ).slice(0, 50);

  const articles = [];
  for (const url of links) {
    try {
      const articleHtml = await fetchText(url);
      const authorFromUrl = new URL(url).pathname.split("/").filter(Boolean)[0];
      const article = {
        title: pageTitle(articleHtml),
        author: pageAuthor(articleHtml, authorFromUrl),
        platform: "note",
        url,
        publishedAt: pageDate(articleHtml),
        tags: ["UiPath", "note"],
        summary: pageSummary(articleHtml),
      };
      article.id = makeId(article);
      if (article.title && isWithinWindow(article)) articles.push(article);
    } catch (error) {
      console.warn(`Skipping note article ${url}: ${error.message}`);
    }
  }

  return articles;
}

async function collectOfficial() {
  const articleLinks = new Set();

  for (const source of OFFICIAL_SOURCES) {
    const html = await fetchText(source.url);
    const links = extractLinks(html, source.url, (url) => {
      return (
        url.startsWith("https://www.uipath.com/ja/blog/") ||
        url.startsWith("https://www.uipath.com/ja/community-blog/")
      );
    });
    links.forEach((link) => articleLinks.add(link));
  }

  const articles = [];
  for (const url of [...articleLinks].slice(0, 80)) {
    try {
      const html = await fetchText(url);
      const title = pageTitle(html);
      const publishedAt = pageDate(html);
      if (!title || !publishedAt) continue;

      const isCommunity = url.includes("/ja/community-blog/");
      const article = {
        title,
        author: pageAuthor(
          html,
          isCommunity ? "UiPath Community Blog" : "UiPath",
        ),
        platform: "UiPath公式",
        url,
        publishedAt,
        tags: [isCommunity ? "Community Blog" : "公式ブログ", "UiPath"],
        summary: pageSummary(html),
      };
      article.id = makeId(article);

      if (isWithinWindow(article) || isCommunity) articles.push(article);
    } catch (error) {
      console.warn(`Skipping UiPath article ${url}: ${error.message}`);
    }
  }

  return articles;
}

async function readExisting() {
  try {
    const raw = await fs.readFile(articlesPath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : data.articles || [];
  } catch {
    return [];
  }
}

function mergeArticles(existing, fetched) {
  const byUrl = new Map();
  for (const article of existing) {
    if (article.url) byUrl.set(article.url, article);
  }

  for (const article of fetched) {
    const previous = byUrl.get(article.url) || {};
    byUrl.set(article.url, {
      ...article,
      summary: previous.summary || article.summary,
      tags: [...new Set([...(article.tags || []), ...(previous.tags || [])])].slice(
        0,
        6,
      ),
    });
  }

  return [...byUrl.values()]
    .filter(qiitaMatchesTitleOrTag)
    .filter((article) => article.title && article.url && article.publishedAt)
    .sort(
      (a, b) =>
        new Date(`${b.publishedAt}T00:00:00Z`).getTime() -
        new Date(`${a.publishedAt}T00:00:00Z`).getTime(),
    );
}

async function main() {
  const existing = await readExisting();
  const fetched = [];

  for (const collector of [collectQiita, collectNote, collectOfficial]) {
    try {
      const result = await collector();
      fetched.push(...result);
      console.log(`${collector.name}: ${result.length} articles`);
    } catch (error) {
      console.warn(`${collector.name} failed: ${error.message}`);
    }
  }

  const articles = mergeArticles(existing, fetched);
  const payload = {
    generatedAt: formatDate(now),
    searchWindow: `Qiita / note: ${formatDate(since)} - ${formatDate(now)}; UiPath official: listed pages as of ${formatDate(now)}`,
    sources: SOURCES,
    articles,
  };

  await fs.writeFile(articlesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${articles.length} articles to ${articlesPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
