/*
 * Site-wide hamburger menu: a full-screen overlay listing every class and its lessons.
 * Include on every page with <script src="…/nav.js" defer></script>.
 * Lesson lists are read from each class's index.html (.lesson-card links), so they never go stale.
 */
(function () {
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
  let openDir = currentDir;

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
    .snav-head .chev { margin-left: auto; color: var(--text-muted, #999); transition: transform .2s; }
    .snav-class.open .snav-head .chev { transform: rotate(90deg); }
    .snav-class.current .snav-head { box-shadow: inset 3px 0 0 var(--accent, #e94560); }
    .snav-lessons { display: none; padding: .4rem; }
    .snav-class.open .snav-lessons { display: block; }
    .snav-lessons a {
      display: flex; align-items: baseline; gap: .75rem; padding: .6rem .75rem; border-radius: 8px;
      color: var(--text, #eee); text-decoration: none; font-size: .95rem;
    }
    .snav-lessons a:hover { background: var(--card-hover, #222244); }
    .snav-lessons a.current { background: var(--accent, #e94560); color: #fff; }
    .snav-lessons .num { color: var(--text-muted, #999); font-size: .75rem; min-width: 4.5rem; flex-shrink: 0; }
    .snav-lessons a.current .num { color: rgba(255,255,255,.8); }
    .snav-lessons .overview { color: var(--text-muted, #999); font-size: .85rem; }
    .snav-msg { color: var(--text-muted, #999); padding: .6rem .75rem; font-size: .9rem; }
    body.snav-locked { overflow: hidden; }
    @media (max-width: 600px) {
      .snav-btn { top: .5rem; left: .5rem; width: 40px; height: 40px; }
      .snav-lessons .num { min-width: 3.8rem; }
    }
  `;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  async function loadLessons(dir) {
    if (!lessonCache[dir]) {
      lessonCache[dir] = fetch(new URL(`${dir}/`, ROOT))
        .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(html => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return [...doc.querySelectorAll("a.lesson-card")].map(a => ({
            href: new URL(a.getAttribute("href"), new URL(`${dir}/`, ROOT)).href,
            id: new URL(a.getAttribute("href"), ROOT).searchParams.get("id"),
            title: a.querySelector("h3")?.textContent.trim() || a.textContent.trim(),
            num: a.querySelector(".lesson-num")?.textContent.trim() || "",
          }));
        });
    }
    return lessonCache[dir];
  }

  async function renderLessons(dir, box) {
    box.innerHTML = `<div class="snav-msg">Loading…</div>`;
    try {
      const lessons = await loadLessons(dir);
      box.innerHTML = `<a href="${esc(new URL(`${dir}/`, ROOT).href)}"><span class="num"></span><span class="overview">Overview</span></a>` +
        lessons.map(l => {
          const cur = dir === currentDir && l.id && l.id === currentId;
          return `<a href="${esc(l.href)}" class="${cur ? "current" : ""}"><span class="num">${esc(l.num)}</span><span>${esc(l.title)}</span></a>`;
        }).join("");
      box.querySelector("a.current")?.scrollIntoView({ block: "nearest" });
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
      const block = el(`<div class="snav-class ${c.dir === currentDir ? "current" : ""}">
        <button type="button" class="snav-head"><span>${esc(c.zh)}</span><span class="en">${esc(c.en)}</span><span class="chev">&#9656;</span></button>
        <div class="snav-lessons"></div>
      </div>`);
      const box = block.querySelector(".snav-lessons");
      block.querySelector(".snav-head").addEventListener("click", () => {
        const opening = !block.classList.contains("open");
        inner.querySelectorAll(".snav-class.open").forEach(b => b.classList.remove("open"));
        openDir = opening ? c.dir : null;
        if (opening) { block.classList.add("open"); renderLessons(c.dir, box); }
      });
      block.dataset.dir = c.dir;
      inner.appendChild(block);
    });

    const open = () => {
      overlay.classList.add("open");
      document.body.classList.add("snav-locked");
      btn.setAttribute("aria-expanded", "true");
      const block = openDir && inner.querySelector(`.snav-class[data-dir="${openDir}"]`);
      if (block && !block.classList.contains("open")) {
        block.classList.add("open");
        renderLessons(openDir, block.querySelector(".snav-lessons"));
      }
      overlay.querySelector(".snav-close").focus();
    };
    const close = () => {
      overlay.classList.remove("open");
      document.body.classList.remove("snav-locked");
      btn.setAttribute("aria-expanded", "false");
      btn.focus();
    };

    btn.addEventListener("click", open);
    overlay.querySelector(".snav-close").addEventListener("click", close);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && overlay.classList.contains("open")) close();
    });

    document.body.append(btn, overlay);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
