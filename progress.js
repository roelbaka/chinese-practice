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
      rec.dir = src.dir;
      rec.id = src.id;
      rec.lesson = (document.title.split(" — ")[1] || "").trim() || rec.lesson || "";
      if (section) rec.section = section;
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

  /** Per-item stats for display: "2 / 5 right". */
  function stats(zh) {
    const r = load()[zh];
    return r ? { right: r.right, wrong: r.wrong, pct: Math.round(score(r) * 100) } : null;
  }

  function count() { return list().length; }

  function reset() { try { localStorage.removeItem(KEY); } catch (e) {} }

  window.Progress = { record, list, asLesson, stats, count, reset, THRESHOLD };
})();
