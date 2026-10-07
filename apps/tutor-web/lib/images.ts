// Finds a real picture for a whiteboard image block.
//
// Pictures come from Wikipedia and Wikimedia Commons: free to use, mostly
// educational, no API key. The best source is the pictures inside the matching
// Wikipedia article ("Heart", "Insect morphology"), because editors chose them
// to teach exactly that topic and labelled them in English. Commons' own search
// is a noisier fallback.
//
// Searches run in the student's browser, so they count against the student's
// own rate limit rather than one shared server's.

export interface FoundImage {
  /** A rendered thumbnail, always on a wikimedia.org host. */
  url: string;
  width: number;
  height: number;
  /** The file's page, linked as the credit. */
  page: string;
}

const WIDTH = 960;
const API = { wikipedia: "https://en.wikipedia.org/w/api.php", commons: "https://commons.wikimedia.org/w/api.php" };

// This is a children's product and these sources have no safe-search, so
// anything whose title suggests adult content is skipped outright.
const BLOCKED = /nud(e|ity)|naked|erotic|porn|sex(ual)?[ _-]?(act|toy|position|intercourse)|fetish|bdsm|genital|penis|vagina|vulva|breast|masturb|topless|lingerie|gore|corpse|beheading/i;
// Wikipedia's own interface art, which appears in every article's image list.
const CHROME = /logo|icon|ambox|edit[-_ ]|question[-_ ]book|wik(i|t)[a-z]*[-_ ](logo|letter)|commons-|oojs|symbol[-_ ]|padlock|crystal[-_ ]clear|nuvola|stub|folder|disambig|flag[-_ ]of|red[-_ ]pog|blue[-_ ]pog|arrow|speaker|sound-/i;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/svg+xml", "image/webp", "image/gif"]);
// "Heart diagram-fa.svg" is the Persian-labelled copy; prefer English or unmarked files.
const LANGUAGE_CODES = new Set(
  "ar bg bn ca cs da de el eo es et eu fa fi fr gl he hi hr hu id it ja ka ko kr lt lv mk ml ms nl no pl pt ro ru sk sl sr sv ta te th tr uk ur vi zh".split(" "),
);
const LANGUAGE_SUFFIX = /[-_ (]([a-z]{2,3})\)?\.(svg|png|jpe?g|webp|gif)$/i;

// Words that describe the kind of picture wanted, not its subject.
const FILLER = new Set(["diagram", "labelled", "labeled", "label", "picture", "photo", "image", "of", "the", "a", "an", "and", "with", "in", "for", "simple"]);
const WANTS_DIAGRAM = /diagram|labell?ed|structure|anatomy|map|chart|cycle|cross.?section/i;
const DIAGRAM_HINT = /diagram|scheme|schematic|anatomy|structure|label|cross.?section|morphology|cycle|map|parts/i;

/** The subject words of a query, e.g. "human heart diagram" → ["human", "heart"]. */
export function keywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !FILLER.has(w));
}

/**
 * How many of the keywords appear in a title: as whole words (plural-tolerant),
 * or, for longer words, inside a compound such as "Watercycle".
 */
export function matches(title: string, words: string[]): number {
  const lower = title.toLowerCase();
  const tokens = new Set(lower.split(/[^\p{L}\p{N}]+/u).flatMap((t) => [t, t.replace(/s$/, "")]));
  return words.filter((w) => tokens.has(w) || tokens.has(w.replace(/s$/, "")) || (w.length >= 5 && lower.includes(w))).length;
}

/** True when a title covers at least half of the subject words. */
const onSubject = (title: string, words: string[]) => matches(title, words) >= Math.max(1, Math.ceil(words.length / 2));

export interface Candidate {
  /** File title, e.g. "File:Heart diagram-en.svg". */
  title: string;
  /** Position in the source's own ordering. */
  index: number;
  width: number;
  height: number;
  mime: string;
}

/**
 * Scores a picture for a query; higher is better, below zero means "don't show".
 * `trusted` is for pictures taken from an article already known to be about the
 * subject, where the title needn't repeat the subject words.
 */
export function score(candidate: Candidate, words: string[], wantsDiagram: boolean, trusted: boolean): number {
  if (BLOCKED.test(candidate.title) || CHROME.test(candidate.title)) return -1;
  if (!IMAGE_TYPES.has(candidate.mime) || candidate.width < 240) return -1;
  const matched = matches(candidate.title, words);
  const looksLikeDiagram = DIAGRAM_HINT.test(candidate.title);
  if (trusted) {
    // In the right article, a diagram request still needs something diagram-like or on-subject.
    if (wantsDiagram && !looksLikeDiagram && !onSubject(candidate.title, words)) return -1;
  } else if (!onSubject(candidate.title, words)) {
    // From open search, at least half the subject words must be in the title.
    return -1;
  }
  const ratio = candidate.width / (candidate.height || 1);
  const language = LANGUAGE_SUFFIX.exec(candidate.title)?.[1]?.toLowerCase();
  const drawn = candidate.mime === "image/svg+xml" || candidate.mime === "image/png";
  return (
    matched * 10 +
    (wantsDiagram && looksLikeDiagram ? 8 : 0) +
    (wantsDiagram && drawn ? 3 : 0) +
    (language === "en" ? 4 : language && LANGUAGE_CODES.has(language) ? -12 : 0) +
    (ratio > 2.6 || ratio < 0.45 ? -5 : 0) + // banners and tall strips read badly on the board
    (candidate.width < 400 ? -3 : 0) -
    // An article lists its pictures alphabetically, so position only means something in search results.
    (trusted ? 0 : candidate.index * 0.2)
  );
}

interface ImageInfo {
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width?: number;
  height?: number;
  mime?: string;
  descriptionurl?: string;
}
interface FilePage {
  index?: number;
  title: string;
  imageinfo?: ImageInfo[];
}
interface ArticlePage {
  index: number;
  title: string;
  pageimage?: string;
  thumbnail?: { source: string; width: number; height: number };
}
type Pages<T> = { query?: { pages?: Record<string, T> } };

async function getJson<T>(base: string, params: Record<string, string>, signal: AbortSignal): Promise<T | null> {
  try {
    const query = new URLSearchParams({ action: "query", format: "json", origin: "*", ...params });
    const url = `${base}?${query}`;
    let res = await fetch(url, { signal, referrerPolicy: "no-referrer" });
    if (res.status === 429) {
      // Briefly rate-limited: one patient retry is usually enough.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      res = await fetch(url, { signal, referrerPolicy: "no-referrer" });
    }
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Only pictures hosted by Wikimedia itself (upload. or thumb.wikimedia.org) are ever shown. */
function isWikimedia(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname.endsWith(".wikimedia.org");
  } catch {
    return false;
  }
}

/** Picks the best-scoring file, or null if none is good enough. */
function best(pages: FilePage[], words: string[], wantsDiagram: boolean, trusted: boolean): FoundImage | null {
  let top: { info: ImageInfo; score: number } | null = null;
  pages.forEach((page, position) => {
    const info = page.imageinfo?.[0];
    if (!info || !isWikimedia(info.thumburl)) return;
    const s = score(
      { title: page.title, index: page.index ?? position, width: info.width ?? 0, height: info.height ?? 0, mime: info.mime ?? "" },
      words,
      wantsDiagram,
      trusted,
    );
    if (s >= 0 && (!top || s > top.score)) top = { info, score: s };
  });
  const info = (top as { info: ImageInfo } | null)?.info;
  if (!info?.thumburl) return null;
  return {
    url: info.thumburl,
    width: info.thumbwidth ?? WIDTH,
    height: info.thumbheight ?? WIDTH,
    page: info.descriptionurl ?? "https://commons.wikimedia.org/",
  };
}

/** Wikipedia articles about the subject, best first, each with its lead picture. */
async function findArticles(words: string[], signal: AbortSignal): Promise<ArticlePage[]> {
  const data = await getJson<Pages<ArticlePage>>(
    API.wikipedia,
    {
      generator: "search",
      gsrsearch: words.join(" "),
      gsrnamespace: "0",
      gsrlimit: "5",
      prop: "pageimages",
      piprop: "thumbnail|name",
      pithumbsize: String(WIDTH),
    },
    signal,
  );
  // Wikipedia's own ranking is kept: sorting by title match prefers oddities
  // like the novel "Any Human Heart" over the article "Heart".
  return Object.values(data?.query?.pages ?? {})
    .filter((p) => onSubject(p.title, words) && !BLOCKED.test(p.title))
    .sort((a, b) => a.index - b.index);
}

/** The best diagram among the pictures used in one article. */
async function diagramFromArticle(title: string, words: string[], signal: AbortSignal): Promise<FoundImage | null> {
  const data = await getJson<Pages<FilePage>>(
    API.wikipedia,
    { generator: "images", titles: title, gimlimit: "60", prop: "imageinfo", iiprop: "url|mime|size", iiurlwidth: String(WIDTH) },
    signal,
  );
  return best(Object.values(data?.query?.pages ?? {}), words, true, true);
}

function leadImage(article: ArticlePage | undefined): FoundImage | null {
  if (!article?.thumbnail || !isWikimedia(article.thumbnail.source) || BLOCKED.test(article.pageimage ?? "")) return null;
  return {
    url: article.thumbnail.source,
    width: article.thumbnail.width,
    height: article.thumbnail.height,
    page: article.pageimage ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(article.pageimage)}` : "https://en.wikipedia.org/",
  };
}

async function searchCommons(words: string[], wantsDiagram: boolean, signal: AbortSignal, addDiagram = false): Promise<FoundImage | null> {
  const data = await getJson<Pages<FilePage>>(
    API.commons,
    {
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: `${words.join(" ")}${addDiagram ? " diagram" : ""} filetype:bitmap|drawing`,
      gsrlimit: "20",
      prop: "imageinfo",
      iiprop: "url|mime|size",
      iiurlwidth: String(WIDTH),
    },
    signal,
  );
  return best(Object.values(data?.query?.pages ?? {}), words, wantsDiagram, false);
}

async function search(query: string): Promise<FoundImage | null> {
  const words = keywords(query);
  if (!words.length || BLOCKED.test(query)) return null;
  const signal = AbortSignal.timeout(9000);
  const wantsDiagram = WANTS_DIAGRAM.test(query);

  const articles = await findArticles(words, signal);
  // An article's lead picture is only used when the article is exactly about the
  // subject. A loosely related article's picture would teach something false,
  // and showing nothing is better than that.
  const exact = leadImage(articles.find((a) => a.thumbnail && matches(a.title, words) === words.length));
  if (!wantsDiagram) return exact ?? (await searchCommons(words, false, signal));

  // A labelled diagram: look inside the best article, then Commons, then settle for a photo.
  return (
    (articles[0] && (await diagramFromArticle(articles[0].title, words, signal))) ||
    (await searchCommons(words, true, signal, /diagram|labell?ed/i.test(query))) ||
    exact
  );
}

const cache = new Map<string, Promise<FoundImage | null>>();

/** Finds a picture for a short search phrase; null when nothing suitable exists. */
export function findImage(query: string): Promise<FoundImage | null> {
  const key = query.trim().toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = search(key);
    cache.set(key, pending);
  }
  return pending;
}
