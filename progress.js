/*
 * Mistake tracking, stored in this browser (localStorage).
 *
 * Every graded answer (quiz, fill-in, typed flashcard) is recorded per item, keyed by its Chinese.
 * An item is on the mistakes list once you got it wrong at least once and your score for it
 * is 75% or lower; it drops off as soon as you get it right more than 75% of the time.
 *
 * Lesson pages load this before their own script; the mistakes page reads the list back as a
 * lesson (Progress.asLesson) so the normal Browse / Flashcards / Quiz / Fill in modes work on it.
 */
(function () {
  const KEY = "chinesePractice.mistakes.v1";
  const ROOT = new URL(".", document.currentScript.src);
  const THRESHOLD = 0.75;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  }

  const CLASS_NAMES = { beginners: "Beginners", improvers: "Improvers", hsk1: "HSK 1", hsk2: "HSK 2", hsk3: "HSK 3", proverbs: "Proverbs" };

  /** Where the current page's lesson lives: { dir, id, title }. Empty on the mistakes page itself. */
  function here() {
    const dir = (location.pathname.match(/\/([^/]+)\/lesson\.html$/) || [])[1] || "";
    const id = new URLSearchParams(location.search).get("id") || "";
    return { dir, id };
  }

  function score(rec) {
    const n = rec.right + rec.wrong;
    return n ? rec.right / n : 1;
  }
  function isMistake(rec) {
    return rec.wrong > 0 && score(rec) <= THRESHOLD;
  }

  /**
   * Record one graded answer. `item` is {zh, py, en}; `section` (optional) is the topic it came from.
   * On the mistakes page items keep the source they were first recorded with.
   */
  function record(item, correct, section) {
    if (!item || !item.zh) return;
    const all = load();
    const src = here();
    const rec = all[item.zh] || { zh: item.zh, py: item.py || "", en: item.en || "", right: 0, wrong: 0 };
    if (src.dir && src.id !== "mistakes") {
      // On the "All words" page a section names the lesson it came from.
      const fromSection = section && typeof section === "object" && section.lessonId;
      rec.dir = src.dir;
      rec.id = fromSection ? section.lessonId : src.id;
      rec.lesson = fromSection ? (section.lessonTitle || rec.lesson || "")
        : (document.title.split(" — ")[1] || "").trim() || rec.lesson || "";
      const topic = typeof section === "object" ? section && section.topic : section;
      if (topic) rec.section = topic;
    }
    rec.py = rec.py || item.py || "";
    rec.en = rec.en || item.en || "";
    if (correct) rec.right++; else rec.wrong++;
    rec.last = Date.now();
    all[item.zh] = rec;
    save(all);
  }

  function list() {
    return Object.values(load()).filter(isMistake)
      .sort((a, b) => score(a) - score(b) || (b.last || 0) - (a.last || 0));
  }

  /** The mistakes as lesson JSON: one practice section per source lesson, worst first. */
  function asLesson() {
    const items = list();
    // Words go under 生词 (so Fill in can use them), sentences under 练习, per source lesson.
    const groups = new Map();
    items.forEach(r => {
      const label = r.dir ? `${CLASS_NAMES[r.dir] || r.dir} · ${r.lesson || r.id}` : "Other";
      const kind = /[，。？！：、,.?!:]/.test(r.zh) ? "练习 · Practice" : "生词 · Words";
      const topic = `${kind} (${label})`;
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic).push({ zh: r.zh, py: r.py, en: r.en });
    });
    return {
      title: "错题 · Mistakes",
      subtitle: items.length
        ? `${items.length} item${items.length > 1 ? "s" : ""} you often get wrong · an item leaves the list once you get it right more than 75% of the time`
        : "No mistakes yet — answer quiz, fill-in or typed flashcard questions and the ones you get wrong will collect here.",
      data: [...groups].map(([topic, its]) => ({ topic, items: its })),
    };
  }

  /**
   * The mistakes lesson plus a pool of wrong-answer options: all items of the lessons your
   * mistakes come from. Lets the quiz run with just one or two mistakes.
   */
  async function asLessonWithPool() {
    const lesson = asLesson();
    const sources = [...new Set(list().filter(r => r.dir && r.id && !/^(words|mistakes)$/.test(r.id)).map(r => `${r.dir}/${r.id}`))];
    const pools = await Promise.all(sources.map(src => {
      const [dir, id] = src.split("/");
      return fetch(new URL(`${dir}/data/${id}.json`, ROOT)).then(r => r.json())
        .then(j => j.data.filter(s => !s.browseOnly).flatMap(s => s.items).filter(i => i.py))
        .catch(() => []);
    }));
    lesson.pool = pools.flat();
    return lesson;
  }

  /** Per-item stats for display: "2 / 5 right". */
  function stats(zh) {
    const r = load()[zh];
    return r ? { right: r.right, wrong: r.wrong, pct: Math.round(score(r) * 100) } : null;
  }

  function count() { return list().length; }

  /** { lessonId: number of items from that lesson on the mistakes list } for one class folder. */
  function byLesson(dir) {
    const out = {};
    list().forEach(r => { if (r.dir === dir && r.id) out[r.id] = (out[r.id] || 0) + 1; });
    return out;
  }

  function reset() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /**
   * How far an item is from leaving the mistakes list. You need more than 75% right, so with
   * `wrong` mistakes you need 3 × wrong + 1 right answers in total.
   * Returns null for items you never got wrong.
   */
  function progressOf(zh) {
    const r = load()[zh];
    if (!r || !r.wrong) return null;
    const target = 3 * r.wrong + 1;
    return { right: r.right, wrong: r.wrong, target, needed: Math.max(0, target - r.right), learned: !isMistake(r) };
  }

  /** A small meter for the quiz / fill-in screen; empty for items you never got wrong. */
  function meterHtml(zh) {
    const p = progressOf(zh);
    if (!p) return "";
    const done = Math.min(p.right, p.target);
    const pct = Math.round(done / p.target * 100);
    const segs = p.target <= 12
      ? `<div class="pm-segs">${Array.from({ length: p.target }, (_, i) => `<span class="${i < done ? "on" : ""}"></span>`).join("")}</div>`
      : `<div class="pm-bar"><span style="width:${pct}%"></span></div>`;
    const text = p.learned
      ? "✓ Learned — off your mistakes list"
      : `Mistake · ${p.needed}× more right to learn it`;
    return `<div class="pmeter${p.learned ? " learned" : ""}" title="${p.right} right, ${p.wrong} wrong — you need more than 75% right">
      <div class="pm-text"><span>${text}</span><span class="pm-count">${done} / ${p.target}</span></div>${segs}</div>`;
  }

  // Styles for the meter, using each page's own colour variables.
  const style = document.createElement("style");
  style.textContent = `
    .pmeter { max-width: 22rem; margin: .4rem auto 1rem; font-size: .8rem; color: var(--text-muted, #999); text-align: left; }
    .pmeter .pm-text { display: flex; justify-content: space-between; gap: .8rem; margin-bottom: .3rem; }
    .pmeter .pm-count { font-variant-numeric: tabular-nums; }
    .pmeter .pm-segs { display: flex; gap: 3px; }
    .pmeter .pm-segs span { flex: 1; height: 7px; border-radius: 3px; background: var(--border, #2a2a4a); }
    .pmeter .pm-segs span.on { background: #f0a030; }
    .pmeter .pm-bar { height: 7px; border-radius: 4px; background: var(--border, #2a2a4a); overflow: hidden; }
    .pmeter .pm-bar span { display: block; height: 100%; background: #f0a030; transition: width .3s; }
    .pmeter.learned { color: var(--success, #4caf50); }
    .pmeter.learned .pm-segs span.on, .pmeter.learned .pm-bar span { background: var(--success, #4caf50); }
  `;
  (document.head || document.documentElement).appendChild(style);

  window.Progress = { record, list, asLesson, asLessonWithPool, stats, count, byLesson, progressOf, meterHtml, reset, THRESHOLD };
})();
