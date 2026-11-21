/*
 * Shared site code, loaded on every page.
 *
 * 1. window.Topics — how lesson sections are grouped into categories (Notes, Texts, Words, …)
 *    and how a category/section maps to a URL anchor:
 *      #all          whole lesson
 *      #grammar      every section in a category
 *      #grammar-2    the 2nd section in that category
 *    Lesson pages must load this file before their own script (no `defer`) to use it.
 *
 * 2. The hamburger menu: a full-screen overlay listing every class, its lessons, and per lesson
 *    the categories and sections (linking to the anchors above). Lesson lists are read from each
 *    class's index.html (.lesson-card links), sections from the lesson's JSON, so nothing goes stale.
 *
 * 0. Before all that: the redirect from GitHub Pages to xuexi.nl, and window.Account, which keeps
 *    the progress on the server for signed-in users (see "0b" below and server/lib.php).
 */
(function () {
  // ---------- 0. Move from GitHub Pages to xuexi.nl ----------
  // localStorage belongs to one origin, so the progress (mistakes, chapter scores, settings) is
  // carried along in the URL fragment, which is never sent to a server. xuexi.nl adds the keys it
  // does not have yet and puts the original #anchor back.
  const SITE = "https://xuexi.nl";
  const KEYS = ["chinesePractice.mistakes.v1", "chinesePractice.chapters.v1", "quizShowPinyin", "journalTrack", "homeworkClass", "theme"];
  const XFER = "#xfer=";

  if (location.hostname === "roelbaka.github.io") {
    const path = location.pathname.replace(/^\/chinese-practice/, "") || "/";
    let hash = location.hash;
    try {
      const data = {};
      KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
      if (Object.keys(data).length) {
        const json = JSON.stringify({ d: data, h: location.hash });
        hash = XFER + btoa(unescape(encodeURIComponent(json)));
      }
    } catch (e) { /* no storage: just redirect */ }
    location.replace(SITE + path + location.search + hash);
    return;
  }

  /** `base` wins; for per-item objects (mistakes, chapter scores) add the items only `extra` has. */
  function mergeMissing(base, extra) {
    if (base === null) return extra;
    if (extra === null) return base;
    try {
      const a = JSON.parse(base), b = JSON.parse(extra);
      if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) {
        let n = 0;
        Object.keys(b).forEach((x) => { if (!(x in a)) { a[x] = b[x]; n++; } });
        return n ? JSON.stringify(a) : base;
      }
    } catch (e) { /* plain value */ }
    return base;
  }

  // Pages that load this file with `defer` have already read localStorage: read it again, once.
  // The mark only lives for one load, so this can never loop.
  const RELOAD_MARK = "navReloaded";
  const justReloaded = sessionStorage.getItem(RELOAD_MARK) === location.href;
  sessionStorage.removeItem(RELOAD_MARK);
  function reloadIfLate() {
    if (document.readyState === "loading" || justReloaded) return;
    sessionStorage.setItem(RELOAD_MARK, location.href);
    location.reload();
  }

  if (location.hash.startsWith(XFER)) {
    try {
      const { d, h } = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(XFER.length)))));
      let added = false;
      Object.entries(d || {}).forEach(([k, v]) => {
        if (!KEYS.includes(k) || typeof v !== "string") return;
        const mine = localStorage.getItem(k);
        const merged = mergeMissing(mine, v);
        if (merged !== mine) { localStorage.setItem(k, merged); added = true; }
      });
      history.replaceState(null, "", location.pathname + location.search + (h || ""));
      if (added) reloadIfLate();
    } catch (e) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  // ---------- 0b. Account: progress on the server when signed in ----------
  // Signed out (or on a host without the PHP backend): everything stays in localStorage, as before.
  // Signed in with Google: the server (SQLite on xuexi.nl) holds the progress and localStorage is a
  // working copy. Every write to one of KEYS is sent to /api/progress; on page load the server's copy
  // replaces the local one. The first sign-in on a device merges what this device already had.
  const SYNCED_AS = "chinesePractice.syncedAs";
  const store = Storage.prototype;
  const rawSet = store.setItem, rawRemove = store.removeItem;
  let account = null, pending = {}, timer = null;

  function flush() {
    clearTimeout(timer);
    const keys = Object.keys(pending);
    if (!keys.length || !account) return;
    const body = JSON.stringify(pending);
    pending = {};
    fetch("/api/progress", {
      method: "POST", credentials: "same-origin", keepalive: body.length < 60000,
      headers: { "Content-Type": "application/json" }, body,
    }).catch(() => { /* offline: the next write or page load sends it again */ });
  }
  function queue(k, v) {
    if (!account || !KEYS.includes(k)) return;
    pending[k] = v;
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  }
  store.setItem = function (k, v) { rawSet.call(this, k, v); if (this === window.localStorage) queue(String(k), String(v)); };
  store.removeItem = function (k) { rawRemove.call(this, k); if (this === window.localStorage) queue(String(k), null); };
  addEventListener("pagehide", flush);

  const accountReady = fetch("/api/me", { credentials: "same-origin" })
    .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
    .catch(() => null)
    .then(async (me) => {
      if (!me) return { available: false, user: null };
      if (!me.user) {
        // Signed out elsewhere (or session expired): don't keep the account's copy on this device.
        if (localStorage.getItem(SYNCED_AS)) {
          KEYS.forEach((k) => rawRemove.call(localStorage, k));
          rawRemove.call(localStorage, SYNCED_AS);
          reloadIfLate();
        }
        return { available: true, user: null };
      }
      const server = await fetch("/api/progress", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
      if (!server) return { available: true, user: me.user };
      const firstTime = localStorage.getItem(SYNCED_AS) !== me.user.email;
      const push = {};
      let changed = false;
      KEYS.forEach((k) => {
        const local = localStorage.getItem(k);
        const remote = typeof server[k] === "string" ? server[k] : null;
        const value = firstTime ? mergeMissing(remote, local) : remote;
        if (value !== local) {
          if (value === null) rawRemove.call(localStorage, k); else rawSet.call(localStorage, k, value);
          changed = true;
        }
        if (value !== remote && value !== null) push[k] = value;
      });
      rawSet.call(localStorage, SYNCED_AS, me.user.email);
      account = me.user;
      Object.assign(pending, push);
      flush();
      if (changed) reloadIfLate();
      return { available: true, user: me.user };
    });

  /** Sign out: forget the account's copy on this device first, then end the session. */
  function signOut() {
    flush();
    account = null;
    KEYS.forEach((k) => rawRemove.call(localStorage, k));
    rawRemove.call(localStorage, SYNCED_AS);
    location.href = "/auth/logout?return=" + encodeURIComponent(location.pathname + location.search + location.hash);
  }
  window.Account = { ready: accountReady, signOut };

  // ---------- 1. Topics ----------

  /** Sections are grouped by the Chinese prefix of their topic ("语法 · …" → Grammar). */
  const CATEGORIES = [
    { key: "notes",    zh: "课上要点", en: "Notes",    re: /^课上要点/ },
    { key: "texts",    zh: "课文",    en: "Texts",    re: /^(课文|会话|天气会话|听力|听后复述|句子)/ },
    { key: "words",    zh: "生词",    en: "Words",    re: /^(生词|词汇|新词|教室词汇|专名|专有名词)/ },
    { key: "grammar",  zh: "语法",    en: "Grammar",  re: /^(语法|注释|语音)/ },
    { key: "practice", zh: "练习",    en: "Practice", re: /^(练习|替换|课堂练习|课上扩展)/ },
    { key: "proverbs", zh: "成语",    en: "Proverbs", re: /^成语/ },
    { key: "examples", zh: "例句",    en: "Examples", re: /^例句/ },
    { key: "more",     zh: "更多",    en: "More",     re: /./ },
  ];

  function categoryOf(section) {
    return CATEGORIES.find(c => c.re.test(section.topic)).key;
  }

  /** "语法 · Grammar (A没有B)" → "Grammar (A没有B)" */
  function topicLabel(topic) {
    const i = topic.indexOf(" · ");
    return i >= 0 ? topic.slice(i + 3) : topic;
  }

  /** Short label: "Grammar (A没有B + Adj)" → "A没有B + Adj"; keeps "New Words (Lesson 10)" as is. */
  function shortLabel(topic) {
    const label = topicLabel(topic);
    const m = label.match(/^[^(（]+[(（](.+)[)）]$/);
    return m && !/^Lesson\b/.test(m[1]) ? m[1].trim() : label;
  }

  /** Label for a section chip or menu link; texts keep their full name ("Dialogue 2 (At the Store)"). */
  function sectionLabel(section) {
    return categoryOf(section) === "texts" ? topicLabel(section.topic) : shortLabel(section.topic);
  }

  /** "All grammar", "All practice", … for the chip/link that shows a whole category. */
  function allLabel(cat) {
    return cat === "more" ? "All extras" : `All ${CATEGORIES.find(c => c.key === cat).en.toLowerCase()}`;
  }

  /** Categories present in a lesson, each with its sections, in display order. */
  function groups(data) {
    return CATEGORIES
      .map(c => ({ ...c, sections: data.filter(s => categoryOf(s) === c.key) }))
      .filter(c => c.sections.length);
  }

  /** Anchor (without #) for a category and topic ("all" = the whole category). */
  function hashFor(data, cat, topic) {
    if (cat === "all") return "all";
    if (topic === "all") return cat;
    const n = data.filter(s => categoryOf(s) === cat).findIndex(s => s.topic === topic) + 1;
    return n > 0 ? `${cat}-${n}` : cat;
  }

  /** Anchor → { cat, topic }, or null when absent/unknown. Texts never mean "all texts". */
  function parseHash(data, hash) {
    const h = decodeURIComponent((hash || "").replace(/^#/, ""));
    if (!h) return null;
    if (h === "all") return { cat: "all", topic: "all" };
    const m = h.match(/^([a-z]+)(?:-(\d+))?$/);
    if (!m) return null;
    const secs = data.filter(s => categoryOf(s) === m[1]);
    if (!secs.length) return null;
    const pick = m[2] ? secs[+m[2] - 1] : (m[1] === "texts" ? secs[0] : null);
    return { cat: m[1], topic: pick ? pick.topic : "all" };
  }

  window.Topics = { CATEGORIES, categoryOf, topicLabel, shortLabel, sectionLabel, allLabel, groups, hashFor, parseHash };

  // ---------- 2. Hamburger menu ----------

  const ROOT = new URL(".", document.currentScript.src);

  /**
   * All vocabulary of one book as a single "lesson": every lesson's word lists (生词, 词汇, 专名 …)
   * merged into one section per lesson. Used by lesson.html?id=words in each class folder.
   */
  async function bookWords(dir) {
    const base = new URL(`${dir}/`, ROOT);
    const html = await fetch(base).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const cards = [...doc.querySelectorAll("a.lesson-card")];
    const lessons = await Promise.all(cards.map(async (a, i) => {
      const id = new URL(a.getAttribute("href"), base).searchParams.get("id");
      const json = await fetch(new URL(`data/${id}.json`, base)).then(r => r.json());
      const num = (a.querySelector(".lesson-num")?.textContent || "").replace(/\D+/g, "") || String(i + 1);
      const seen = new Set();
      const items = json.data.filter(s => categoryOf(s) === "words").flatMap(s => s.items)
        .filter(it => it.zh && !seen.has(it.zh) && seen.add(it.zh));
      const title = json.title.replace(/^第[^·]+·\s*/, "");
      return { topic: `生词 · Words (Lesson ${num} · ${title})`, items, lessonId: id, lessonTitle: json.title };
    }));
    const data = lessons.filter(l => l.items.length);
    const total = data.reduce((n, l) => n + l.items.length, 0);
    const name = (doc.querySelector("header h1")?.textContent || dir).trim();
    return {
      title: "全书生词 · All words",
      subtitle: `${name} · ${total} words from ${data.length} lessons — pick a lesson or practise them all`,
      data,
    };
  }
  window.BookWords = bookWords;
  const CLASSES = [
    { dir: "beginners", zh: "初级班", en: "Beginners" },
    { dir: "improvers", zh: "提高班", en: "Improvers" },
    { dir: "hsk1",      zh: "HSK 1",  en: "Standard Course" },
    { dir: "hsk2",      zh: "HSK 2",  en: "Standard Course" },
    { dir: "hsk3",      zh: "HSK 3",  en: "Standard Course" },
    { dir: "proverbs",  zh: "成语谚语", en: "Proverbs" },
  ];

  const here = new URL(location.href);
  const currentDir = CLASSES.find(c => here.pathname.includes(`/${c.dir}/`))?.dir || null;
  const currentId = here.searchParams.get("id");
  const lessonCache = {};
  const sectionCache = {};
  let openDir = currentDir;
  let openLesson = currentId;

  const css = `
    .snav-btn {
      position: fixed; top: .75rem; left: .75rem; z-index: 1000;
      width: 44px; height: 44px; border-radius: 10px; cursor: pointer;
      background: var(--card, #1a1a2e); border: 1px solid var(--border, #2a2a4a);
      box-shadow: 0 1px 3px rgba(0,0,0,.12);
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
    }
    .snav-btn span { display: block; width: 20px; height: 2px; border-radius: 2px; background: var(--text, #eee); }
    .snav-btn:hover { border-color: var(--accent, #e94560); background: var(--card-hover, #222244); }
    .stheme {
      position: fixed; top: .75rem; right: .75rem; z-index: 1000; width: 44px; height: 44px; border-radius: 10px;
      display: grid; place-items: center; cursor: pointer; font-size: 1.1rem; line-height: 1;
      background: var(--card, #1a1a2e); color: var(--text, #eee); border: 1px solid var(--border, #2a2a4a);
      box-shadow: 0 1px 3px rgba(0,0,0,.12);
    }
    .stheme:hover { border-color: var(--accent, #e94560); background: var(--card-hover, #222244); }
    .stheme svg { width: 20px; height: 20px; }
    body.snav-locked .stheme { display: none; }
    .sacct {
      position: fixed; top: .75rem; right: calc(.75rem + 44px + .5rem); z-index: 1000; height: 44px; box-sizing: border-box;
      display: flex; align-items: center; gap: .5rem; padding: 0 .9rem; border-radius: 10px; cursor: pointer;
      background: var(--card, #1a1a2e); color: var(--text, #eee); border: 1px solid var(--border, #2a2a4a);
      box-shadow: 0 1px 3px rgba(0,0,0,.12); font: 500 .9rem var(--menu-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      text-decoration: none;
    }
    .sacct:hover { border-color: var(--accent, #e94560); background: var(--card-hover, #222244); }
    .sacct svg { width: 18px; height: 18px; flex-shrink: 0; }
    .sacct.in { padding: 0 .35rem 0 .35rem; gap: .45rem; }
    .sacct .av {
      width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center;
      background: var(--accent, #e94560); color: #fff; font-weight: 700; font-size: .95rem;
    }
    .sacct .nm { max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: .45rem; }
    .sacct-pop {
      position: fixed; top: 3.6rem; right: calc(.75rem + 44px + .5rem); z-index: 1000; min-width: 14rem; padding: .75rem;
      background: var(--card, #1a1a2e); color: var(--text, #eee); border: 1px solid var(--border, #2a2a4a);
      border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.25);
      font: .88rem var(--menu-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    }
    .sacct-pop[hidden] { display: none; }
    .sacct-pop .em { color: var(--text-muted, #999); font-size: .8rem; margin: .15rem 0 .6rem; word-break: break-all; }
    .sacct-pop p { margin: 0 0 .7rem; color: var(--text-muted, #999); font-size: .8rem; line-height: 1.4; }
    .sacct-pop button {
      width: 100%; padding: .5rem; border-radius: 8px; cursor: pointer; font: inherit;
      background: transparent; color: var(--text, #eee); border: 1px solid var(--border, #2a2a4a);
    }
    .sacct-pop button:hover, .sacct-pop .adm:hover { border-color: var(--accent, #e94560); }
    .sacct-pop .adm {
      display: block; text-align: center; margin-bottom: .5rem; padding: .5rem; border-radius: 8px;
      color: var(--text, #eee); text-decoration: none; border: 1px solid var(--border, #2a2a4a);
    }
    body.snav-locked .sacct, body.snav-locked .sacct-pop { display: none; }
    @media (max-width: 600px) {
      .stheme { top: .5rem; right: .5rem; width: 40px; height: 40px; }
      .sacct { top: .5rem; right: calc(.5rem + 40px + .4rem); height: 40px; padding: 0 .7rem; font-size: .82rem; }
      .sacct.in .nm { display: none; }
      .sacct .av { width: 30px; height: 30px; }
      .sacct-pop { top: 3.2rem; right: calc(.5rem + 40px + .4rem); }
    }
    .snav {
      position: fixed; inset: 0; z-index: 1001; background: var(--bg, #0f0f0f); color: var(--text, #eee);
      display: flex; flex-direction: column; opacity: 0; visibility: hidden; transition: opacity .2s, visibility .2s;
      font-family: var(--menu-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif);
    }
    .snav.open { opacity: 1; visibility: visible; }
    .snav-top {
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
      padding: .75rem 1rem; border-bottom: 1px solid var(--border, #2a2a4a);
    }
    .snav-home { color: var(--text, #eee); text-decoration: none; font-size: 1.2rem; font-weight: 300; letter-spacing: 1px; }
    .snav-home b { color: var(--accent, #e94560); font-weight: 600; }
    .snav-home img { display: block; height: 34px; width: auto; }
    .snav-journal {
      margin-left: auto; color: var(--text, #eee); text-decoration: none; font-size: .9rem;
      border: 1px solid var(--border, #2a2a4a); border-radius: 999px; padding: .35rem .9rem;
    }
    .snav-journal:hover { border-color: var(--accent, #e94560); }
    .snav-mistakes, .snav-account { margin-left: 0; }
    .snav-account[hidden] { display: none; }
    .snav-count:not(:empty) {
      display: inline-block; margin-left: .4rem; min-width: 1.3rem; padding: 0 .35rem; border-radius: 999px;
      background: var(--accent, #e94560); color: #fff; font-size: .75rem; text-align: center;
    }
    @media (max-width: 600px) { .snav-journal { font-size: .78rem; padding: .3rem .6rem; } }
    .snav-close {
      width: 44px; height: 44px; border-radius: 10px; cursor: pointer; font-size: 1.6rem; line-height: 1;
      background: transparent; color: var(--text, #eee); border: 1px solid var(--border, #2a2a4a);
    }
    .snav-close:hover { border-color: var(--accent, #e94560); }
    .snav-body { flex: 1; overflow-y: auto; padding: 1rem; }
    .snav-inner { max-width: 720px; margin: 0 auto; }
    .snav-class { border: 1px solid var(--border, #2a2a4a); border-radius: 12px; margin-bottom: .75rem; overflow: hidden; }
    .snav-head {
      width: 100%; display: flex; align-items: center; gap: .6rem; padding: 1rem 1.1rem; cursor: pointer;
      background: var(--card, #1a1a2e); color: var(--text, #eee); border: 0; font-family: inherit; font-size: 1.1rem; text-align: left;
    }
    .snav-head:hover { background: var(--card-hover, #222244); }
    .snav-head .en { color: var(--text-muted, #999); font-size: .9rem; }
    .chev { margin-left: auto; color: var(--text-muted, #999); transition: transform .2s; flex-shrink: 0; }
    .snav-class.open > .snav-head .chev, .snav-lesson.open > .snav-row .chev { transform: rotate(90deg); }
    .snav-class.current > .snav-head { box-shadow: inset 3px 0 0 var(--accent, #e94560); }
    .snav-lessons { display: none; padding: .4rem; }
    .snav-class.open > .snav-lessons { display: block; }
    .snav-lessons a, .snav-row {
      display: flex; align-items: baseline; gap: .75rem; padding: .6rem .75rem; border-radius: 8px;
      color: var(--text, #eee); text-decoration: none; font-size: .95rem;
    }
    .snav-row { width: 100%; background: none; border: 0; cursor: pointer; text-align: left; font: inherit; font-size: .95rem; }
    .snav-lessons a:hover, .snav-row:hover { background: var(--card-hover, #222244); }
    .snav-lesson.current > .snav-row { color: var(--accent, #e94560); }
    .snav-lessons .num { color: var(--text-muted, #999); font-size: .75rem; min-width: 4.5rem; flex-shrink: 0; }
    .snav-lessons .overview { color: var(--text-muted, #999); font-size: .85rem; }
    .snav-sub { display: none; margin: 0 0 .5rem 5.25rem; padding-left: .6rem; border-left: 1px solid var(--border, #2a2a4a); }
    .snav-lesson.open > .snav-sub { display: block; }
    .snav-sub a { padding: .4rem .6rem; font-size: .88rem; }
    .snav-sub a.all { font-weight: 600; }
    .snav-sub a.sec { padding-left: 1.4rem; color: var(--text-muted, #bbb); font-size: .84rem; }
    .snav-sub a.sec:hover { color: var(--text, #eee); }
    .snav-sub a.here { background: var(--accent, #e94560); color: #fff; }
    .snav-sub .cat { color: var(--text-muted, #999); font-size: .72rem; letter-spacing: 1px; text-transform: uppercase; padding: .7rem .6rem .2rem; }
    .snav-msg { color: var(--text-muted, #999); padding: .6rem .75rem; font-size: .9rem; }
    body.snav-locked { overflow: hidden; }
    @media (max-width: 600px) {
      .snav-btn { top: .5rem; left: .5rem; width: 40px; height: 40px; }
      .snav-lessons .num { min-width: 3.8rem; }
      .snav-sub { margin-left: 1rem; }
    }
  `;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function fetchText(url) {
    return fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r; });
  }

  function loadLessons(dir) {
    const base = new URL(`${dir}/`, ROOT);
    lessonCache[dir] ??= fetchText(base).then(r => r.text()).then(html => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return [...doc.querySelectorAll("a.lesson-card")].map(a => {
        const url = new URL(a.getAttribute("href"), base);
        return {
          href: url.href,
          id: url.searchParams.get("id"),
          title: a.querySelector("h3")?.textContent.trim() || a.textContent.trim(),
          num: a.querySelector(".lesson-num")?.textContent.trim() || "",
        };
      });
    });
    return lessonCache[dir];
  }

  function loadSections(dir, id) {
    const key = `${dir}/${id}`;
    sectionCache[key] ??= fetchText(new URL(`${dir}/data/${id}.json`, ROOT)).then(r => r.json()).then(j => j.data || []);
    return sectionCache[key];
  }

  /** The submenu of one lesson: All first, then per category its "all" link and sections. */
  async function renderSub(dir, lesson, box) {
    box.innerHTML = `<div class="snav-msg">Loading…</div>`;
    try {
      const data = await loadSections(dir, lesson.id);
      const isHere = dir === currentDir && lesson.id === currentId;
      const curHash = isHere ? (location.hash.replace(/^#/, "") || null) : null;
      const link = (hash, label, cls = "") =>
        `<a href="${esc(lesson.href)}#${hash}" class="${cls}${curHash === hash ? " here" : ""}">${esc(label)}</a>`;
      let html = link("all", "All · 全部", "all");
      Topics.groups(data).forEach(g => {
        const name = `${g.zh} ${g.en}`;
        if (g.sections.length === 1) { html += link(g.key, name); return; }
        html += `<div class="cat">${esc(name)}</div>`;
        if (g.key !== "texts") html += link(g.key, Topics.allLabel(g.key), "sec");
        g.sections.forEach((s, i) => { html += link(`${g.key}-${i + 1}`, Topics.sectionLabel(s), "sec"); });
      });
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = `<div class="snav-msg">Couldn't load this lesson's sections.</div>`;
    }
  }

  async function renderLessons(dir, box) {
    box.innerHTML = `<div class="snav-msg">Loading…</div>`;
    try {
      const lessons = await loadLessons(dir);
      box.innerHTML = `<a href="${esc(new URL(`${dir}/`, ROOT).href)}"><span class="num"></span><span class="overview">Overview</span></a>` +
        (dir === "proverbs" ? "" : `<a href="${esc(new URL(`${dir}/lesson.html?id=words`, ROOT).href)}"><span class="num"></span><span class="overview">全书生词 · All words</span></a>`);
      lessons.forEach(l => {
        const cur = dir === currentDir && l.id && l.id === currentId;
        const item = el(`<div class="snav-lesson ${cur ? "current" : ""}">
          <button type="button" class="snav-row"><span class="num">${esc(l.num)}</span><span>${esc(l.title)}</span><span class="chev">&#9656;</span></button>
          <div class="snav-sub"></div>
        </div>`);
        const sub = item.querySelector(".snav-sub");
        const expand = () => { item.classList.add("open"); openLesson = l.id; renderSub(dir, l, sub); };
        item.querySelector(".snav-row").addEventListener("click", () => {
          const opening = !item.classList.contains("open");
          box.querySelectorAll(".snav-lesson.open").forEach(x => x.classList.remove("open"));
          if (opening) expand(); else openLesson = null;
        });
        if (l.id && l.id === openLesson && dir === openDir) expand();
        box.appendChild(item);
      });
      box.querySelector(".snav-lesson.open, .snav-lesson.current")?.scrollIntoView({ block: "nearest" });
    } catch (e) {
      box.innerHTML = `<div class="snav-msg">Couldn't load the lessons. Open the site through a web server, not as a file.</div>`;
    }
  }

  function build() {
    document.head.appendChild(el(`<style>${css}</style>`));

    const btn = el(`<button type="button" class="snav-btn" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>`);
    const overlay = el(`<div class="snav" role="dialog" aria-modal="true" aria-label="Site menu">
      <div class="snav-top">
        <a class="snav-home" href="${esc(ROOT.href)}"><img src="${esc(new URL("logo.svg", ROOT).href)}" alt="学习 · Home"></a>
        <a class="snav-journal" href="${esc(new URL("homework/", ROOT).href)}">作业 · Homework</a>
        <a class="snav-journal snav-mistakes" href="${esc(new URL("journal/", ROOT).href)}">课堂笔记 · Class journal</a>
        <a class="snav-journal snav-mistakes" href="${esc(new URL("mistakes/lesson.html?id=mistakes", ROOT).href)}">错题 · Mistakes<span class="snav-count"></span></a>
        <a class="snav-journal snav-account" hidden></a>
        <button type="button" class="snav-close" aria-label="Close menu">&times;</button>
      </div>
      <div class="snav-body"><div class="snav-inner"></div></div>
    </div>`);
    const inner = overlay.querySelector(".snav-inner");

    // Sign in / out (only where the backend exists, i.e. on xuexi.nl).
    const acc = overlay.querySelector(".snav-account");
    Account.ready.then(({ available, user }) => {
      if (!available) return;
      const here = location.pathname + location.search + location.hash;
      if (user) {
        acc.textContent = "Sign out";
        acc.title = `Signed in as ${user.email}: your progress is saved to your account`;
        acc.href = "/auth/logout";
        acc.addEventListener("click", (e) => { e.preventDefault(); Account.signOut(); });
      } else {
        acc.textContent = "Sign in with Google";
        acc.title = "Save your progress to your account and use it on every device";
        acc.href = "/auth/login?return=" + encodeURIComponent(here);
      }
      acc.hidden = false;
    });

    CLASSES.forEach(c => {
      const block = el(`<div class="snav-class ${c.dir === currentDir ? "current" : ""}" data-dir="${c.dir}">
        <button type="button" class="snav-head"><span>${esc(c.zh)}</span><span class="en">${esc(c.en)}</span><span class="chev">&#9656;</span></button>
        <div class="snav-lessons"></div>
      </div>`);
      block.querySelector(".snav-head").addEventListener("click", () => {
        const opening = !block.classList.contains("open");
        inner.querySelectorAll(".snav-class.open").forEach(b => b.classList.remove("open"));
        openDir = opening ? c.dir : null;
        if (opening) { block.classList.add("open"); renderLessons(c.dir, block.querySelector(".snav-lessons")); }
      });
      inner.appendChild(block);
    });

    const open = () => {
      overlay.classList.add("open");
      // Mistakes are counted from localStorage (progress.js stores them under this key).
      let n = 0;
      try {
        const all = JSON.parse(localStorage.getItem("chinesePractice.mistakes.v1")) || {};
        n = Object.values(all).filter(r => r.wrong > 0 && r.right / (r.right + r.wrong) <= 0.75).length;
      } catch (e) {}
      overlay.querySelector(".snav-count").textContent = n || "";
      document.body.classList.add("snav-locked");
      btn.setAttribute("aria-expanded", "true");
      inner.querySelectorAll(".snav-class.open").forEach(b => b.classList.remove("open"));
      const block = openDir && inner.querySelector(`.snav-class[data-dir="${openDir}"]`);
      if (block) {
        block.classList.add("open");
        renderLessons(openDir, block.querySelector(".snav-lessons"));
      }
      overlay.querySelector(".snav-close").focus();
    };
    const close = () => {
      overlay.classList.remove("open");
      document.body.classList.remove("snav-locked");
      btn.setAttribute("aria-expanded", "false");
    };

    btn.addEventListener("click", open);
    overlay.querySelector(".snav-close").addEventListener("click", () => { close(); btn.focus(); });
    // A link to another part of this same page only changes the anchor: close the menu ourselves.
    overlay.addEventListener("click", e => { if (e.target.closest("a")) close(); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && overlay.classList.contains("open")) { close(); btn.focus(); }
    });

    document.body.append(btn, overlay);
    buildThemeButton();
    buildAccountButton();
  }

  /**
   * Light / dark toggle, top right. The choice goes to localStorage "theme" and <html data-theme>;
   * theme.css holds the light colours, and each page's <head> applies the choice before drawing.
   * Without a choice the site is dark, except the class journal, which follows the system.
   */
  function buildThemeButton() {
    const root = document.documentElement;
    const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>`;
    const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>`;
    const current = () => root.getAttribute("data-theme")
      || (root.classList.contains("journal") && !matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
    const b = el(`<button type="button" class="stheme"></button>`);
    const paint = () => {
      const light = current() === "light";
      b.innerHTML = light ? MOON : SUN;
      b.title = light ? "Switch to dark mode" : "Switch to light mode";
      b.setAttribute("aria-label", b.title);
    };
    b.addEventListener("click", () => {
      const next = current() === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      paint();
    });
    paint();
    document.body.append(b);
  }

  /** Top-right: "Sign in" when signed out; your initial with a small sign-out panel when signed in. */
  function buildAccountButton() {
    const G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;
    Account.ready.then(({ available, user }) => {
      if (!available) return;
      const here = location.pathname + location.search + location.hash;
      if (!user) {
        const a = el(`<a class="sacct" title="Save your progress to your account and use it on every device">${G}<span>Sign in</span></a>`);
        a.href = "/auth/login?return=" + encodeURIComponent(here);
        a.addEventListener("click", () => { a.href = "/auth/login?return=" + encodeURIComponent(location.pathname + location.search + location.hash); });
        document.body.append(a);
        return;
      }
      const name = (user.name || user.email).trim();
      const first = name.split(/\s+/)[0];
      const b = el(`<button type="button" class="sacct in" aria-haspopup="true" aria-expanded="false"><span class="av"></span><span class="nm"></span></button>`);
      b.querySelector(".av").textContent = first.charAt(0).toUpperCase();
      b.querySelector(".nm").textContent = first;
      b.title = `Signed in as ${user.email}`;
      const pop = el(`<div class="sacct-pop" hidden><strong></strong><div class="em"></div><p>Your progress is saved to your account and shared between your devices.</p>${user.admin ? `<a class="adm" href="/admin">Admin · users and progress</a>` : ""}<button type="button">Sign out</button></div>`);
      pop.querySelector("strong").textContent = name;
      pop.querySelector(".em").textContent = user.email;
      const toggle = (open) => { pop.hidden = !open; b.setAttribute("aria-expanded", String(open)); };
      b.addEventListener("click", (e) => { e.stopPropagation(); toggle(pop.hidden); });
      pop.addEventListener("click", (e) => e.stopPropagation());
      pop.querySelector("button").addEventListener("click", () => Account.signOut());
      document.addEventListener("click", () => toggle(false));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggle(false); });
      document.body.append(b, pop);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
