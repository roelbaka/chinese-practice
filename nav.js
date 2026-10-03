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
 */
(function () {
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
  const CLASSES = [
    { dir: "beginners", zh: "初级班", en: "Beginners" },
    { dir: "improvers", zh: "提高班", en: "Improvers" },
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
      background: rgba(26,26,46,.85); border: 1px solid var(--border, #2a2a4a);
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
    }
    .snav-btn span { display: block; width: 20px; height: 2px; border-radius: 2px; background: var(--text, #eee); }
    .snav-btn:hover { border-color: var(--accent, #e94560); }
    .snav {
      position: fixed; inset: 0; z-index: 1001; background: var(--bg, #0f0f0f); color: var(--text, #eee);
      display: flex; flex-direction: column; opacity: 0; visibility: hidden; transition: opacity .2s, visibility .2s;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
    }
    .snav.open { opacity: 1; visibility: visible; }
    .snav-top {
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
      padding: .75rem 1rem; border-bottom: 1px solid var(--border, #2a2a4a);
    }
    .snav-home { color: var(--text, #eee); text-decoration: none; font-size: 1.2rem; font-weight: 300; letter-spacing: 1px; }
    .snav-home b { color: var(--accent, #e94560); font-weight: 600; }
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
      background: var(--card, #1a1a2e); color: var(--text, #eee); border: 0; font-size: 1.1rem; text-align: left;
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
      box.innerHTML = `<a href="${esc(new URL(`${dir}/`, ROOT).href)}"><span class="num"></span><span class="overview">Overview</span></a>`;
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
        <a class="snav-home" href="${esc(ROOT.href)}">练习 <b>中文</b></a>
        <button type="button" class="snav-close" aria-label="Close menu">&times;</button>
      </div>
      <div class="snav-body"><div class="snav-inner"></div></div>
    </div>`);
    const inner = overlay.querySelector(".snav-inner");

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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
