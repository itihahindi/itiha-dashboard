/* Itiha Intel dashboard. Plain browser JS, ECharts + marked from CDN. */
(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // The intel modules write Markdown emphasis into their verdict strings; this panel renders text, not HTML,
  // so the markers would otherwise show up as literal asterisks.
  const unmd = (s) => String(s ?? "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  const truncate = (s, n = 34) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const fmt = (n) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "–";
    n = Number(n);
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "k";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };
  const fmtFull = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("en-IN"));
  // Headline numbers are read, not scanned: 25,614 beats 25.6k when there is room for it. Compact form is
  // kept above a million, where the separators stop helping and start wrapping the tile.
  const fmtTile = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? "–" : Math.abs(Number(n)) < 1e6 ? fmtFull(Math.round(Number(n))) : fmt(n));
  const fmtDate = (iso) => { if (!iso) return "–"; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }); };
  const fmtDateTime = (iso) => { if (!iso) return "–"; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const ago = (iso) => { if (!iso) return ""; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };
  const ytUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

  const SLOTS = ["--s1", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"]; // s2 reserved for Itiha
  const theme = () => ({
    ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"),
    surface: css("--surface"), accent: css("--accent"), comp: css("--comp"), pos: css("--pos"), neg: css("--neg"),
    slots: SLOTS.map(css), s1: css("--s1"), s2: css("--s2"),
  });

  const charts = new Map(); // id -> echarts instance
  function chart(id, option, { empty = false, emptyText = "No data yet" } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    let inst = charts.get(id);
    if (empty) {
      if (inst) { inst.dispose(); charts.delete(id); }
      el.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
      return;
    }
    if (!inst || inst.isDisposed()) { el.innerHTML = ""; inst = echarts.init(el, null, { renderer: "canvas" }); charts.set(id, inst); }
    inst.setOption(option, true);
  }
  function baseOption(t) {
    return {
      textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: t.ink2 },
      color: t.slots,
      animationDuration: 300,
      tooltip: {
        backgroundColor: t.surface, borderColor: t.grid, textStyle: { color: t.ink, fontSize: 12 },
        confine: true, appendToBody: false,
      },
      legend: { textStyle: { color: t.ink2, fontSize: 11 }, itemWidth: 14, itemHeight: 8, icon: "roundRect", type: "scroll", pageTextStyle: { color: t.muted } },
      grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
    };
  }
  const axisStyle = (t) => ({
    axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true }, splitLine: { lineStyle: { color: t.grid } },
  });
  const valueAxis = (t, extra = {}) => ({ type: "value", ...axisStyle(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => fmt(v) }, ...extra });
  const catAxis = (t, data, extra = {}) => ({ type: "category", data, ...axisStyle(t), splitLine: { show: false }, ...extra });

  // A read-only copy made by `npm run cli -- share` sets ITIHA_STATIC: every read comes from a saved file, and
  // nothing on the page can write, refresh or start a job.
  const STATIC = window.ITIHA_STATIC || null;
  const staticName = (p) => { const [a, q = ""] = p.replace(/^\/api\//, "").split("?"); const v = new URLSearchParams(q).values().next().value; return a.replace(/\//g, "_") + (v ? `__${String(v).replace(/[^\w.-]/g, "_")}` : ""); };
  const HIDDEN_TABS = STATIC ? ["research", "search", ...(STATIC.hide || [])] : [];
  if (STATIC) { document.documentElement.classList.add("static"); HIDDEN_TABS.forEach((t) => { const b = document.querySelector(`.tab[data-tab="${t}"]`); if (b) b.hidden = true; }); }
  async function api(path) {
    const r = await fetch(STATIC ? `api/${staticName(path)}.json` : path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  function showError(panelId, e) {
    const p = document.getElementById(panelId);
    const div = document.createElement("div");
    div.className = "error";
    div.textContent = `Could not load: ${e.message || e}`;
    p.prepend(div);
    console.error(e);
  }

  // ---------- state ----------
  const state = {
    loaded: {}, data: {}, videoFormat: 0, sort: { key: "published_at", asc: false }, compLog: true, relative: false,
    intelSort: { long: { key: "published_at", asc: false }, short: { key: "published_at", asc: false } }, intelSelected: null, intelVideo: {},
    igSort: { key: "per_1k", asc: false }, igShowAll: false,
  };

  // ---------- tabs ----------
  const loaders = { brief: loadBrief, goal: loadGoal, search: loadSearch, overview: loadOverview, videos: loadVideos, competitors: loadCompetitors, ideas: loadIdeas, audience: loadAudience, research: loadResearch, instagram: loadInstagram, intel: loadIntel };

  // One line per tab, saying which decision it serves. With seven tabs the first thing to get lost was
  // "where am I and what is this screen for", and every one of these sentences is a rule from CLAUDE.md.
  const PURPOSE = {
    brief: "",
    goal: "The road to 100,000 subscribers by 28 September 2027: where the channel stands against the path, what this month needs, and what the plan asks against what the channel has already done.",
    search: "Find where a name, place or phrase was said.",
    overview: "The last 90 days as trends: what the automatic checks flagged, then long-form and Shorts side by side, never added together. Today has the verdict; this is the picture behind it.",
    videos: "Your own uploads, one format at a time: how the latest did against your usual video, which ones bring subscribers, then the curves and the full list. Judge a launch on day three, not on day one.",
    competitors: "The Indian-history watchlist: who is growing fastest, which of their videos broke out against their own usual, and what went up in the last 48 hours.",
    ideas: "What beat its own channel's normal in the niche: views over that channel's own same-format median. Long-form and Shorts are separate lists.",
    audience: "Who watches and how they found you, one format at a time. Studio's “Browse features” is counted here inside the Home feed.",
    research: "Every brief and report, each listed once. Older copies are under Version.",
    instagram: "A separate platform, judged on followers, not reach. Nothing here may drive a YouTube decision.",
    intel: "Your mistakes video by video, with the moment viewers left and what the script said there; then what the script readings add up to.",
  };

  /**
   * Loading state. Every loader hits SQLite and some walk the whole catalogue, so a tab can sit blank for
   * seconds on its first open; a blank table reads as broken rather than as not-yet.
   */
  function setBusy(tab, on) {
    const panel = document.getElementById(`tab-${tab}`);
    if (!panel) return;
    const existing = panel.querySelector(":scope > .loading-bar");
    if (!on) { if (existing) existing.remove(); return; }
    if (!existing) {
      const bar = document.createElement("div");
      bar.className = "loading-bar";
      bar.setAttribute("role", "status");
      bar.textContent = "Reading the database…";
      panel.prepend(bar);
    }
    $$(`#tab-${tab} table.data tbody`).forEach((tb) => { if (!tb.children.length) tb.innerHTML = `<tr><td colspan="12"><div class="empty">Loading…</div></td></tr>`; });
    $$(`#tab-${tab} .chart`).forEach((el) => { if (!el.children.length) el.innerHTML = `<div class="empty">Loading…</div>`; });
  }

  function activate(tab) {
    $$(".tab").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1; // roving tabindex: one stop for the whole tablist, arrows move within it
    });
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
    const purpose = $("#purpose");
    if (purpose) purpose.textContent = PURPOSE[tab] || "";
    document.body.dataset.tab = tab; // Today draws the goal as its own tiles, so the strip in the bar hides there (style.css)
    try { localStorage.setItem("itiha.tab", tab); } catch { /* ignore */ }
    if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
    if (!state.loaded[tab]) {
      state.loaded[tab] = true;
      setBusy(tab, true);
      loaders[tab]().then(() => setBusy(tab, false)).catch((e) => { state.loaded[tab] = false; setBusy(tab, false); showError(`tab-${tab}`, e); });
    } else requestAnimationFrame(() => charts.forEach((c) => c.resize()));
  }
  const tabButtons = $$(".tab");
  tabButtons.forEach((b, i) => {
    b.id = `tabbtn-${b.dataset.tab}`;
    b.setAttribute("aria-controls", `tab-${b.dataset.tab}`);
    b.addEventListener("click", () => activate(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      const jump = e.key === "Home" ? 0 : e.key === "End" ? tabButtons.length - 1 : null;
      if (!step && jump === null) return;
      e.preventDefault();
      const next = jump !== null ? jump : (i + step + tabButtons.length) % tabButtons.length;
      tabButtons[next].focus();
      activate(tabButtons[next].dataset.tab);
    });
  });
  window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", () => { Object.keys(state.loaded).forEach((k) => { if (state.loaded[k] && renderers[k]) renderers[k](); }); });

  // ---------- Goal ----------
  // A plan, not a verdict: the required path, the levers that add up to it, and whether this month is on it.
  // Nothing is computed here beyond formatting; src/intel/goal.ts owns every number.
  const STATUS_CLS = { ahead: "ahead", "on track": "ontrack", behind: "behind", watch: "watch" };
  // Plain YYYY-MM-DD dates are UTC midnight to Date(); pin them to midday so a browser west of UTC shows the right day.
  const fmtDay = (iso) => (iso ? fmtDate(String(iso).slice(0, 10) + "T12:00:00") : "–");
  const perDay = (x) => (x === null || x === undefined ? "–" : `${fmtFull(Math.round(Number(x)))}/day`);
  async function loadGoal() {
    state.data.goal = await api("/api/goal");
    if (!state.goalPlan) state.goalPlan = state.data.goal.default_plan;
    renderGoal();
    renderGoalStrip(state.data.goal);
  }
  async function loadGoalStrip() {
    try { const g = await api("/api/goal"); state.data.goal = g; renderGoalStrip(g); } catch { /* the strip is optional */ }
  }
  function renderGoalStrip(g) {
    const el = $("#goal-strip");
    if (!el || !g || !g.current) return;
    const m = g.this_month;
    const need = m ? m.required_per_day : g.required_today?.per_day;
    const ok = m ? m.actual_per_day_7d >= m.required_per_day : false;
    el.innerHTML = `<b>${esc(fmtFull(g.current.subs))}</b> / ${esc(fmtFull(g.config.target))}`
      + ` <span class="sep">·</span> need ${esc(perDay(need))} this month, ${esc(perDay(g.straight_line_per_day))} avg`
      + ` <span class="sep">·</span> <span class="${ok ? "ok" : "short"}">7-day ${esc(perDay(g.pace.per_day_7d))}</span>`;
    el.title = `Progress to ${fmtFull(g.config.target)} by ${g.config.deadline}. The ramp asks ${need}/day this month; a straight line would need ${g.straight_line_per_day}/day. Actual 7-day rate ${g.pace.per_day_7d}/day (channel-wide, data through ${g.data_through || "n/a"}). Opens the Goal tab.`;
    el.hidden = false;
    renderTodayStatus();
    renderHealth();
  }

  /** What each lever counts, in plain words. The numbers are net subscribers this month from that source. */
  function leverHelp(g) {
    const th = g.thresholds || {};
    return {
      breakouts: `Subscribers from any one video that brings in ${fmtFull(th.breakout ?? 500)} or more on its own. These are the rare big jumps, usually a video timed to a film or a date.`,
      long: "Subscribers from long-form videos published this month.",
      shorts: "Subscribers from Shorts published this month.",
      community: "Subscribers who joined from a community post or the channel page, not from watching a video.",
      tail: "Subscribers from your older videos, those published more than 90 days ago, that are still being found and watched. The back catalogue working on its own.",
      hits: `Videos that land in your top tenth, ${fmtFull(th.hit ?? 65)} or more subscribers each, but are not breakouts.`,
    };
  }
  const hbarHtml = (fill, cls, mark, markLabel) => `<div class="hbar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, fill)).toFixed(1)}%"></i>${mark != null ? `<u style="left:${Math.max(0, Math.min(100, mark)).toFixed(1)}%" title="${esc(markLabel || "")}"></u>` : ""}</div>`;
  /** One bar per lever, shared by Today and Goal. `detail` adds what the target is made of and the channel's best. */
  function leverBlocks(g, detail) {
    const help = leverHelp(g);
    const pct = (a, b) => (b ? (a / b) * 100 : 0);
    return (g.levers || []).filter((l) => l.target_subs > 0 || l.actual_subs > 0).map((l) => {
      const paced = l.basis === "28-day pace";
      const got = paced ? l.pace_subs : l.actual_subs;
      return `<div class="lever">
        <div class="lever-top"><span class="lever-name">${esc(l.label)}</span><span class="pill ${STATUS_CLS[l.status] || "watch"}">${esc(l.status)}</span><span class="lever-num"><b>${esc(fmtFull(got))}</b> of ${esc(fmtFull(l.target_subs))}</span></div>
        ${hbarHtml(pct(got, l.target_subs), l.status === "behind" ? "bad" : l.status === "ahead" ? "good" : "info", l.target_subs && !paced ? pct(l.expected_by_now ?? 0, l.target_subs) : null, "where it should be by today")}
        <div class="lever-help">${esc(help[l.lever] || "")}${l.status === "behind" && l.closes_gap ? ` <b>To close it:</b> ${esc(l.closes_gap)}` : ""}</div>
        ${detail ? `<div class="lever-facts"><span><b>Target</b> ${esc(l.target_production)}</span><span><b>So far</b> ${esc(paced ? l.pace_production : l.actual_production)}</span><span><b>Best shown</b> ${esc(l.demonstrated_best)}</span></div>` : ""}
      </div>`;
    }).join("");
  }

  function renderGoal() {
    const g = state.data.goal;
    if (!g) return;
    const t = theme();
    const c = g.current, rq = g.required_today, m = g.this_month;
    $("#goal-current").textContent = fmtFull(c.subs);
    $("#goal-target").textContent = `/ ${fmtFull(g.config.target)}`;
    $("#goal-current-sub").textContent = `${fmtFull(c.gained_since_start)} gained since ${fmtDay(g.config.start_date)} · ${fmtFull(g.config.target - c.subs)} to go by ${fmtDay(g.config.deadline)}`;
    const gap = rq ? rq.gap : 0;
    const need = m ? m.required_per_day : rq?.per_day;
    const paceOk = need != null && g.pace.per_day_7d >= need;
    // The verdict: position against the path, then whether the current rate is enough.
    const v = $("#goal-verdict");
    v.className = `hbanner ${gap > 0 && !paceOk ? "bad" : gap > 0 || !paceOk ? "warn" : "good"}`;
    v.innerHTML = `<b>${gap > 0 ? `${esc(fmtFull(gap))} behind the path` : gap < 0 ? `${esc(fmtFull(-gap))} ahead of the path` : "On the path"}</b>
      <span>${paceOk ? `gaining ${esc(g.pace.per_day_7d.toFixed(1))} a day over the last 7 days, above the ${esc(Number(need).toFixed(1))} this month needs` : `gaining ${esc(g.pace.per_day_7d.toFixed(1))} a day over the last 7 days, below the ${esc(Number(need ?? 0).toFixed(1))} this month needs`}${m && m.shortfall > 0 ? `; still on course to end the month ${esc(fmtFull(m.shortfall))} short` : ""}</span>`;
    v.hidden = false;
    const pct = Math.max(0, Math.min(100, (c.subs / g.config.target) * 100));
    const reqPct = rq ? Math.max(0, Math.min(100, (rq.subs / g.config.target) * 100)) : pct;
    $("#goal-bar-fill").style.width = `${pct}%`;
    $("#goal-bar-mark").style.left = `${reqPct}%`;
    const bar = $("#goal-bar");
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.setAttribute("aria-valuetext", `${fmtFull(c.subs)} of ${fmtFull(g.config.target)} subscribers`);
    const tile = (label, big, small, cls = "") => `<div class="tstat ${cls}"><div class="tlabel">${esc(label)}</div><div class="tbig">${big}</div><div class="tsmall">${small}</div></div>`;
    $("#goal-hero-nums").innerHTML = [
      tile("Rate now", `${esc(g.pace.per_day_7d.toFixed(1))} <span class="of">a day, last 7 days</span>`, `${esc(g.pace.per_day_28d.toFixed(1))} a day over 28 days`, paceOk ? "good" : "bad"),
      tile("Rate this month needs", `${esc(Number(need ?? 0).toFixed(1))} <span class="of">a day</span>`, `the path asks more every month, growing ${esc(Number(g.ramp.monthly_growth_pct).toFixed(1))}% a month`),
      tile("Rate needed by the end", `${esc(fmtFull(Math.round(g.ramp.end_per_day)))} <span class="of">a day</span>`, `by ${esc(fmtDay(g.config.deadline))}; a straight line would need ${esc(String(g.straight_line_per_day))} a day from today`),
      tile("Time left", `${esc(fmtFull(c.days_left))} <span class="of">days</span>`, `${esc(String(c.days_elapsed))} days in`),
    ].join("");
    $("#goal-ramp-note").textContent = unmd(g.ramp.explanation);

    // Chart: actual history, the ramp, the straight line, milestone dots.
    const range = state.goalRange || "near";
    const endIso = range === "year" ? g.config.deadline : (() => { const d = new Date(g.today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 90); return d.toISOString().slice(0, 10); })();
    const inRange = (d) => d <= endIso;
    const actual = (g.series.actual || []).map((p) => [p.date, p.subs]);
    const req = (g.series.required || []).filter((p) => inRange(p.date)).map((p) => [p.date, p.subs]);
    const straight = (g.series.straight || []).filter((p) => inRange(p.date)).map((p) => [p.date, p.subs]);
    const miles = (g.milestones || []).filter((x) => inRange(x.end)).map((x) => ({ value: [x.end, x.required_subs], m: x }));
    if (!req.length) chart("goal-chart", null, { empty: true });
    else chart("goal-chart", {
      ...baseOption(t),
      legend: { ...baseOption(t).legend, top: 0, data: ["Actual", "The path", "Straight line", "Month-end milestone"] },
      tooltip: { ...baseOption(t).tooltip, trigger: "axis", formatter: (ps) => {
        const d = ps[0] && (Array.isArray(ps[0].value) ? ps[0].value[0] : ps[0].axisValue);
        const rows = ps.filter((p) => p.seriesName !== "Month-end milestone").map((p) => `${p.marker}${esc(p.seriesName)} ${fmtFull(p.value[1])}`);
        const ms = ps.find((p) => p.seriesName === "Month-end milestone");
        return `<b>${esc(fmtDay(typeof d === "number" ? new Date(d).toISOString() : d))}</b><br>${rows.join("<br>")}${ms ? `<br>${esc(ms.data.m.label)} milestone: ${fmtFull(ms.data.m.required_subs)} (${fmtFull(ms.data.m.required_per_day)}/day that month)` : ""}`;
      } },
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (x) => fmtDay(new Date(x).toISOString()) } },
      yAxis: valueAxis(t, { scale: true }),
      series: [
        { name: "The path", type: "line", data: req, showSymbol: false, lineStyle: { width: 2, color: t.s1 }, itemStyle: { color: t.s1 }, areaStyle: { color: t.s1, opacity: 0.06 } },
        { name: "Straight line", type: "line", data: straight, showSymbol: false, lineStyle: { width: 1.5, type: "dashed", color: t.muted }, itemStyle: { color: t.muted } },
        { name: "Actual", type: "line", data: actual, showSymbol: actual.length < 40, symbolSize: 5, step: "end", lineStyle: { width: 3, color: t.accent }, itemStyle: { color: t.accent }, z: 5 },
        { name: "Month-end milestone", type: "scatter", data: miles, symbolSize: 8, itemStyle: { color: t.surface, borderColor: t.s1, borderWidth: 2 }, z: 4 },
      ],
    });

    // This month: where it is heading, and the ways to close what is missing.
    if (!m) { $("#goal-month-body").innerHTML = `<div class="empty">The goal period has ended or has not started.</div>`; }
    else {
      const ms = m.milestone;
      $("#goal-month-title").textContent = `This month: ${ms.label}`;
      $("#goal-month-meta").textContent = `day ${m.days_into} of ${ms.days} · subscriber data through ${fmtDay(g.data_through)}`;
      const ok = m.shortfall <= 0;
      // Month bar on the scale of the milestone: where the count is, where the current rate lands, where it must land.
      const lo = Math.min(c.subs, m.projected_end_subs, ms.required_subs) - Math.max(200, ms.required_net * 0.5);
      const pos = (x) => ((x - lo) / (Math.max(ms.required_subs, m.projected_end_subs) * 1.0 - lo)) * 100;
      // closes_with is "<where it lands>. That is A, or B, or C." Split the options out when it has that shape.
      const txt = String(m.closes_with || ""), at = txt.indexOf("That is ");
      const opts = !ok && at >= 0 ? txt.slice(at + 8).replace(/\.$/, "").split(/,\s+or\s+/).map((s) => s.trim()).filter(Boolean) : [];
      $("#goal-month-body").innerHTML = `
        <div class="hrow"><div class="hrow-top"><span class="lever-name">Heading for ${esc(fmtFull(m.projected_end_subs))} by ${esc(fmtDay(ms.end))}</span><span class="lever-num">${ok ? "milestone" : `<b>${esc(fmtFull(m.shortfall))}</b> short of`} ${esc(fmtFull(ms.required_subs))}</span></div>
          <div class="hbar month"><i class="ink" style="width:${Math.max(0, Math.min(100, pos(c.subs))).toFixed(1)}%"></i><i class="proj ${ok ? "good" : "bad"}" style="left:${Math.max(0, Math.min(100, pos(c.subs))).toFixed(1)}%;width:${Math.max(0, Math.min(100, pos(m.projected_end_subs)) - Math.max(0, Math.min(100, pos(c.subs)))).toFixed(1)}%"></i><u style="left:${Math.max(0, Math.min(100, pos(ms.required_subs))).toFixed(1)}%" title="the month-end milestone"></u></div>
          <div class="goal-bar-key hint"><span><i class="fill ink"></i>today, ${esc(fmtFull(c.subs))}</span><span><i class="fill ${ok ? "good" : "bad"}"></i>the next ${esc(String(m.days_remaining))} days at ${esc(Number(m.projection_rate).toFixed(1))} a day</span><span><i class="tick"></i>milestone, ${esc(fmtFull(ms.required_subs))}</span></div></div>
        ${opts.length > 1 ? `<div class="hsub">Any one of these closes the ${esc(fmtFull(m.shortfall))}</div><div class="goal-opts">${opts.map((o) => `<div class="goal-opt">${esc(o.charAt(0).toUpperCase() + o.slice(1))}</div>`).join("")}</div>`
          : `<p class="goal-closes"><span class="lbl">${ok ? "Keep it" : "Closes the gap"}</span>${esc(txt)}</p>`}`;
    }

    // Levers, as bars.
    const levers = g.levers || [];
    $("#goal-levers-meta").textContent = levers[0]?.basis === "28-day pace" ? "fewer than 7 days of this month's data yet, so these are the last 28 days scaled to the month" : "month to date";
    const hits = levers.find((l) => l.lever === "hits");
    $("#goal-levers").innerHTML = (leverBlocks(g, true) || `<div class="empty">No lever data yet</div>`)
      + (hits ? `<div class="lever watchline"><div class="lever-top"><span class="lever-name">${esc(hits.label)}</span><span class="pill watch">early sign</span></div><div class="lever-help">${esc(leverHelp(g).hits)} ${esc(hits.basis === "28-day pace" ? hits.pace_production : hits.actual_production)}. ${esc(hits.closes_gap)}</div></div>` : "");

    renderGoalPlan();

    // Evidence.
    const demo = g.demonstrated || {};
    const dfmt = (k, d) => (/pct/.test(k) ? `${Number(d.value).toFixed(1)}%` : /per_1k/.test(k) ? `${Number(d.value).toFixed(1)}/1k` : /per_day|per_month/.test(k) ? Number(d.value).toFixed(2) : fmtFull(Math.round(d.value)));
    $("#goal-demo tbody").innerHTML = Object.entries(demo).map(([k, d]) => `<tr><td>${esc(d.label)}</td><td class="num">${esc(dfmt(k, d))}</td><td class="hint">${esc(d.basis)}</td></tr>`).join("");
    $("#goal-breakouts").innerHTML = (g.breakouts || []).map((b) => `<li><a href="${ytUrl(b.video_id)}" target="_blank" rel="noopener">${esc(b.title)}</a> <span class="hint">${esc(b.is_short ? "Short" : "long-form")} · ${esc(fmtDay(b.published_at))} · ${esc(fmtFull(b.views))} views · <b>${esc(fmtFull(b.net_subs))}</b> net subs${b.newsjack ? ` · ${esc(b.newsjack)}` : ""}</span></li>`).join("") || `<li class="hint">None yet.</li>`;
    $("#goal-notes").innerHTML = (g.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  }

  function renderGoalPlan() {
    const g = state.data.goal;
    if (!g) return;
    const plans = g.plans || [];
    const key = plans.some((p) => p.key === state.goalPlan) ? state.goalPlan : g.default_plan;
    const seg = $("#goal-plans");
    seg.innerHTML = plans.map((p) => `<button type="button" data-plan="${esc(p.key)}" class="${p.key === key ? "active" : ""}" aria-pressed="${p.key === key}">${esc(p.label)}${p.key === g.default_plan ? " (tracked)" : ""}</button>`).join("");
    const p = plans.find((x) => x.key === key);
    if (!p) return;
    $("#goal-plan-desc").textContent = p.description;
    const tot = p.totals || {};
    const parts = [["Breakouts", tot.breakouts, "--s1"], ["Long-form", tot.long, "--s2"], ["Community", tot.community, "--s3"], ["Shorts", tot.shorts, "--s4"], ["Tail", tot.tail, "--s7"]];
    const sum = Math.max(1, tot.total || 0);
    $("#goal-mix").innerHTML = `<div class="hsub first">Where the ${esc(fmtFull(tot.total || 0))} subscribers come from on this plan</div><div class="goal-mix-bar" role="img" aria-label="${esc(parts.map(([l, v]) => `${l} ${Math.round((v / sum) * 100)}%`).join(", "))}">${parts.map(([l, v, c]) => v > 0 ? `<span style="width:${(v / sum) * 100}%;background:var(${c})" title="${esc(l)}: ${esc(fmtFull(v))} subscribers"></span>` : "").join("")}</div>
      <div class="goal-mix-legend">${parts.map(([l, v, c]) => `<span><i style="background:var(${c})"></i>${esc(l)} <b>${esc(fmtFull(v))}</b> <span class="hint">${Math.round((v / sum) * 100)}%</span></span>`).join("")}</div>`;
    // What the plan needs against what the channel has shown, hardest ask first. The bar is "shown" as a share of "needed".
    const u = (r, x) => (r.unit === "per 1k" ? `${Number(x).toFixed(1)}/1k` : r.unit === "per day" ? `${Number(x).toFixed(1)}/day` : r.unit === "per month" ? `${Number(x).toFixed(1)}/month` : fmtFull(x));
    const reqs = [...(p.requirements || [])].filter((r) => r.required > 0).sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0));
    const hard = reqs[0];
    $("#goal-hardest").innerHTML = hard && hard.multiple > 1 ? `<b>The hardest ask:</b> ${esc(hard.label.charAt(0).toLowerCase() + hard.label.slice(1))}. The plan needs ${esc(u(hard, hard.required))}; the channel has shown ${esc(u(hard, hard.demonstrated))} (${esc(hard.demonstrated_label)}). That is ${esc(String(hard.multiple))} times what it has done.` : "";
    $("#goal-reqs").innerHTML = `<div class="hsub">What it needs, against what the channel has shown</div>` + reqs.map((r) => {
      const mult = r.multiple ?? 0, cls = mult > 3 ? "bad" : mult > 1.5 ? "warn" : "good";
      return `<div class="ask">
        <div class="lever-top"><span class="lever-name">${esc(r.label)}</span><span class="lever-num">shown <b>${esc(u(r, r.demonstrated))}</b> · needs <b>${esc(u(r, r.required))}</b></span><span class="ask-mult ${cls}">${r.multiple === null ? "–" : esc(`${r.multiple}x`)}</span></div>
        ${hbarHtml(r.required ? (r.demonstrated / r.required) * 100 : 0, cls)}
        <div class="lever-help">Shown: ${esc(r.demonstrated_label)}.</div>
      </div>`;
    }).join("");
    const months = p.months || [];
    const curIdx = Math.max(0, months.findIndex((mo) => g.this_month && g.this_month.milestone.end === mo.end));
    const n1 = (x) => Number(x).toFixed(1);
    $("#goal-next").innerHTML = months.slice(curIdx, curIdx + 3).map((mo, i) => {
      const ms = (g.milestones || [])[curIdx + i] || {};
      return `<div class="goal-mo ${i === 0 ? "current" : ""}">
        <div class="goal-mo-head"><b>${esc(mo.label)}</b>${i === 0 ? ' <span class="badge own">now</span>' : ""}<span class="hint">reach ${esc(fmtFull(ms.required_subs))}</span></div>
        <div class="goal-mo-big">+${esc(fmtFull(mo.required_net))} <span class="of">subscribers, ${esc(n1(ms.required_per_day ?? mo.required_net / mo.days))} a day</span></div>
        <ul>
          <li><b>${esc(n1(mo.long_per_month))}</b> long-forms at ${esc(fmtFull(mo.long_views_each))} views each</li>
          <li><b>${esc(n1(mo.shorts_per_month))}</b> Shorts</li>
          <li><b>${esc(Number(mo.breakouts_per_month).toFixed(2))}</b> breakouts <span class="hint">(${esc(fmtFull(mo.breakouts_subs))} subscribers)</span></li>
          <li><b>${esc(n1(mo.community_per_day))}</b> a day from community posts and the channel page</li>
        </ul></div>`;
    }).join("");
    $("#goal-months tbody").innerHTML = months.map((mo, i) => {
      const ms = (g.milestones || [])[i] || {};
      const cur = g.this_month && g.this_month.milestone.end === mo.end;
      return `<tr class="${cur ? "current" : ""}">
        <td>${esc(mo.label)}${cur ? ' <span class="badge own">now</span>' : ""}</td>
        <td class="num">${esc(fmtFull(ms.required_subs))}</td>
        <td class="num">${esc(fmtFull(mo.required_net))}</td>
        <td class="num">${esc(mo.long_per_month)}</td>
        <td class="num">${esc(fmtFull(mo.long_views_each))}</td>
        <td class="num">${esc(mo.long_subs_per_1k)}</td>
        <td class="num">${esc(mo.shorts_per_month)}</td>
        <td class="num">${esc(Number(mo.breakouts_per_month).toFixed(2))}</td>
        <td class="num">${esc(mo.community_per_day)}</td>
        <td class="num">${esc(mo.tail_per_day)}</td>
      </tr>`;
    }).join("");
  }
  $("#goal-plans")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-plan]");
    if (!b) return;
    state.goalPlan = b.dataset.plan;
    renderGoalPlan();
    $(`#goal-plans button[data-plan="${CSS.escape(state.goalPlan)}"]`)?.focus();
  });
  $("#goal-range")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-range]");
    if (!b) return;
    state.goalRange = b.dataset.range;
    $$("#goal-range button").forEach((x) => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); });
    renderGoal();
  });

  // ---------- Overview ----------
  // Ninety days of trends. Today carries the verdict and the decisions; this tab is the picture behind them.
  // Long-form and Shorts are drawn side by side on their own scales and never summed (owner rule).
  async function loadOverview() {
    state.data.overview = await api("/api/overview");
    $("#tab-overview").addEventListener("click", (e) => { const b = e.target.closest("[data-lessons]"); if (b) openLessons(b.dataset.lessons); });
    renderOverview();
  }
  /** Open one video in the Lessons tab, where its mistakes and script are. */
  function openLessons(id, kind) {
    state.intelSelected = id;
    if (kind) state.mistakeFormat = kind;
    const loaded = state.loaded.intel;
    activate("intel");
    if (loaded) selectIntel(id);
  }
  function renderOverview() {
    const d = state.data.overview;
    const t = theme();
    const daily = d.daily || [];
    $("#meta").textContent = d.last_sync ? `synced ${ago(d.last_sync.finished_at || d.last_sync.started_at)}${d.last_sync.ok ? "" : " (failed)"}` : "no sync yet";

    // What the checks flagged: warnings first, each with a way in.
    const an = (d.anomalies || []).slice().sort((a, b) => (a.severity === "warn" ? 0 : 1) - (b.severity === "warn" ? 0 : 1));
    const KIND = { views_surge: "views up", views_drop: "views down", early_dropoff: "early drop-off" };
    $("#ov-anomalies").innerHTML = an.length
      ? an.map((a) => `<li class="${esc(a.severity)}"><span class="kind">${esc(KIND[a.kind] || String(a.kind).replace(/_/g, " "))}</span>${esc(a.message)}${a.data && a.data.video ? ` <button type="button" class="btn ghost" data-lessons="${esc(a.data.video)}">Where viewers dropped</button>` : ""}</li>`).join("")
      : `<li class="info"><span class="kind">all clear</span>Nothing is out of line with the channel's own baselines.</li>`;

    // One panel per format: the last 28 days of data against the 28 before, with the 90-day shape.
    const n = (x) => Number(x) || 0;
    const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
    const panel = (label, rows, lead) => {
      if (!rows.length) return `<div class="card ovf"><div class="card-head"><h2>${label}</h2></div><div class="empty">No data yet</div></div>`;
      const now = rows.slice(-28), prev = rows.slice(-56, -28);
      const stat = (name, f, digits) => {
        const a = sum(now, f), b = prev.length === 28 ? sum(prev, f) : null;
        const pct = b ? ((a - b) / b) * 100 : null, up = (pct ?? 0) >= 0, mx = Math.max(a, b ?? 0, 1);
        return `<div class="week"><div class="week-top"><span class="lever-name">${name}</span>${pct == null ? "" : `<span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%</span>`}</div>
          <div class="week-row"><span>last 28 days</span>${hbarHtml((a / mx) * 100, up ? "good" : "bad")}<b>${esc(fmtFull(Math.round(a)))}</b></div>
          ${b == null ? "" : `<div class="week-row"><span>28 before</span>${hbarHtml((b / mx) * 100, "muted")}<b>${esc(fmtFull(Math.round(b)))}</b></div>`}</div>`;
      };
      const W = 320, H = 56, mx = Math.max(...rows.map((r) => n(r.views)), 1) * 1.05;
      const pts = rows.map((r, i) => `${((i / Math.max(1, rows.length - 1)) * W).toFixed(1)},${(H - (n(r.views) / mx) * H).toFixed(1)}`).join(" ");
      const ups = (d.uploads || []).filter((u) => Number(u.is_short) === (lead ? 0 : 1) && String(u.published_at).slice(0, 10) >= String(now[0].date)).length;
      return `<div class="card ovf ${lead ? "lead" : ""}">
        <div class="card-head"><h2>${label}</h2><span class="hint">${lead ? "what the channel is judged on" : "the feeder"} · ${ups} upload${ups === 1 ? "" : "s"} in the last 28 days</span></div>
        <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${label} daily views, last 90 days"><polyline class="got" points="${pts}"/></svg>
        <div class="spark-key"><span><i class="got"></i>daily views, ${esc(fmtDate(rows[0].date))} to ${esc(fmtDate(rows.at(-1).date))}</span></div>
        ${stat("Views", (r) => n(r.views))}
        ${stat("Watch hours", (r) => n(r.watch_minutes) / 60)}
        ${stat("Net subscribers", (r) => n(r.subs_gained) - n(r.subs_lost))}
      </div>`;
    };
    $("#ov-formats").innerHTML = panel("Long-form", d.daily_long || [], true) + panel("Shorts", d.daily_shorts || [], false);

    // Subscribers: the count, and gained against lost over the last 28 days of data.
    const snap = d.snapshot || {}, s = d.stats28 || {};
    const net = (s.subs_gained || 0) - (s.subs_lost || 0), tot = Math.max(1, (s.subs_gained || 0) + (s.subs_lost || 0));
    $("#ov-subs-meta").textContent = s.to ? `from videos, ${fmtDate(s.from)} to ${fmtDate(s.to)}; subscribers from community posts and the channel page are on the Goal tab` : "";
    $("#ov-subs-summary").innerHTML = `<div class="ov-subnums">
        <div class="goal-num"><b>${esc(fmtTile(snap.subscribers))}</b><span>subscribers${snap.fetched_at ? `, counted ${esc(ago(snap.fetched_at))}` : ""}</span></div>
        <div class="goal-num"><b class="${net > 0 ? "up" : net < 0 ? "down" : ""}">${net > 0 ? "+" : ""}${esc(fmtFull(net))}</b><span>net in ${esc(String(s.days ?? 0))} days of data</span></div>
        <div class="ov-gl"><div class="split"><i class="g" style="width:${((s.subs_gained || 0) / tot * 100).toFixed(1)}%">${esc(fmtFull(s.subs_gained || 0))} gained</i><i class="l" style="width:${((s.subs_lost || 0) / tot * 100).toFixed(1)}%"></i></div><span class="hint">${esc(fmtFull(s.subs_lost || 0))} lost</span></div>
      </div>`;

    // Daily views: one panel per format, each on its own axis.
    const long = d.daily_long || [], shorts = d.daily_shorts || [];
    if (!long.length && !shorts.length) chart("ov-daily", null, { empty: true });
    else {
      const dates = (long.length ? long : shorts).map((r) => r.date);
      const longBy = new Map(long.map((r) => [r.date, n(r.views)])), shortBy = new Map(shorts.map((r) => [r.date, n(r.views)]));
      const upBy = new Map();
      for (const u of d.uploads || []) { const k = String(u.published_at).slice(0, 10); if (!longBy.has(k) && !shortBy.has(k)) continue; if (!upBy.has(k)) upBy.set(k, []); upBy.get(k).push(u); }
      const marks = (isShort, by) => Array.from(upBy.entries()).filter(([, l]) => l.some((u) => Number(u.is_short) === isShort)).map(([k]) => ({ value: [k, by.get(k) ?? 0] }));
      chart("ov-daily", {
        ...baseOption(t),
        tooltip: { ...baseOption(t).tooltip, trigger: "axis",
          formatter: (ps) => {
            const date = ps[0]?.axisValue, ups = upBy.get(date) || [];
            return `<b>${esc(fmtDate(date))}</b><br>Long-form ${fmtFull(longBy.get(date) ?? 0)}<br>Shorts ${fmtFull(shortBy.get(date) ?? 0)}`
              + (ups.length ? `<br><span style="color:${t.accent}">▲</span> ${ups.map((u) => esc(truncate(u.title, 48)) + (u.is_short ? " (short)" : "")).join("<br>")}` : "");
          } },
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        legend: { ...baseOption(t).legend, data: ["Long-form", "Shorts", "Uploads"], top: 0 },
        grid: [{ left: 8, right: 12, top: 34, height: "38%", containLabel: true }, { left: 8, right: 12, top: "58%", bottom: 8, containLabel: true }],
        xAxis: [catAxis(t, dates, { gridIndex: 0, axisLabel: { show: false }, boundaryGap: false }), catAxis(t, dates, { gridIndex: 1, boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => fmtDate(v) } })],
        yAxis: [valueAxis(t, { gridIndex: 0, name: "Long-form", nameTextStyle: { color: t.muted, align: "left" } }), valueAxis(t, { gridIndex: 1, name: "Shorts", nameTextStyle: { color: t.muted, align: "left" } })],
        series: [
          { name: "Long-form", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: dates.map((k) => longBy.get(k) ?? 0), showSymbol: false, lineStyle: { width: 2.5, color: t.accent }, itemStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: 0.1 } },
          { name: "Shorts", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: dates.map((k) => shortBy.get(k) ?? 0), showSymbol: false, lineStyle: { width: 2, color: t.s1 }, itemStyle: { color: t.s1 }, areaStyle: { color: t.s1, opacity: 0.08 } },
          { name: "Uploads", type: "scatter", xAxisIndex: 0, yAxisIndex: 0, data: marks(0, longBy), symbol: "triangle", symbolSize: 11, itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 }, z: 5 },
          { name: "Uploads", type: "scatter", xAxisIndex: 1, yAxisIndex: 1, data: marks(1, shortBy), symbol: "triangle", symbolSize: 9, itemStyle: { color: t.s1, borderColor: t.surface, borderWidth: 2 }, z: 5 },
        ],
      });
    }

    if (!daily.length) chart("ov-subs", null, { empty: true });
    else {
      chart("ov-subs", {
        ...baseOption(t),
        tooltip: { ...baseOption(t).tooltip, trigger: "axis", formatter: (ps) => `<b>${esc(fmtDate(ps[0].axisValue))}</b><br>Gained ${fmtFull(ps.find((p) => p.seriesName === "Gained")?.value ?? 0)}<br>Lost ${fmtFull(Math.abs(ps.find((p) => p.seriesName === "Lost")?.value ?? 0))}` },
        legend: { ...baseOption(t).legend, top: 0, data: ["Gained", "Lost"] },
        xAxis: catAxis(t, daily.map((r) => r.date), { axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => fmtDate(v) } }),
        yAxis: valueAxis(t),
        series: [
          { name: "Gained", type: "bar", stack: "s", data: daily.map((r) => r.subs_gained || 0), itemStyle: { color: t.pos, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 },
          { name: "Lost", type: "bar", stack: "s", data: daily.map((r) => -(r.subs_lost || 0)), itemStyle: { color: t.neg, borderRadius: [0, 0, 3, 3] }, barMaxWidth: 14 },
        ],
      });
    }
  }

  // ---------- Videos ----------
  // One format at a time (owner rule: formats never mix). "Usual" is the median of the same format over 180 days,
  // the same baseline the outlier score uses; conversion figures are the 90-day analytics window.
  async function loadVideos() {
    state.data.videos = await api("/api/videos");
    $("#vid-format").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.videoFormat = Number(b.dataset.format); state.videoAll = false; $$("#vid-format button").forEach((x) => x.classList.toggle("active", x === b)); renderVideos(); });
    $("#vid-relative").addEventListener("change", (e) => { state.relative = e.target.checked; renderVideoCharts(); });
    $("#vid-all").addEventListener("click", () => { state.videoAll = !state.videoAll; renderVideoTable(); });
    $("#tab-videos").addEventListener("click", (e) => {
      const b = e.target.closest("[data-lessons]");
      if (!b) return;
      state.intelSelected = b.dataset.lessons;
      state.mistakeFormat = state.videoFormat ? "short" : "long";
      const loaded = state.loaded.intel;
      activate("intel");
      if (loaded) selectIntel(b.dataset.lessons);
    });
    $$("#vid-table th[data-key]").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.sort.key === key) state.sort.asc = !state.sort.asc; else state.sort = { key, asc: key === "title" };
      renderVideoTable();
    }));
    renderVideos();
  }
  const median = (xs) => { const a = xs.filter((x) => x != null && !Number.isNaN(Number(x))).map(Number).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
  const ageDays = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;
  /** The chosen format's videos and its baselines. */
  function videoSet() {
    const d = state.data.videos || {};
    const rows = (d.videos || []).filter((v) => Number(v.is_short) === state.videoFormat);
    const base = rows.filter((v) => ageDays(v.published_at) >= 3 && ageDays(v.published_at) <= 180);
    return { rows, base, usualViews: median(base.map((v) => v.views)), usualConv: median(base.map((v) => v.subs_per_1k)), usualWatch: median(base.map((v) => v.avg_view_pct)) };
  }
  const multOf = (v) => (v.outlier_score == null ? null : Number(v.outlier_score));
  const verdictOf = (v) => {
    if (ageDays(v.published_at) < 3) return ["too early", "watch"];
    const m = multOf(v);
    if (m == null) return ["no baseline", "watch"];
    return m >= 3 ? ["breakout", "ahead"] : m >= 1.2 ? ["above usual", "ahead"] : m >= 0.8 ? ["usual", "ontrack"] : ["below usual", "behind"];
  };
  const multText = (m) => (m == null ? "–" : `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}x`);
  function renderVideos() { renderVideoSummary(); renderVideoCharts(); renderVideoTable(); }
  function renderVideoSummary() {
    const s = videoSet(), word = state.videoFormat ? "Short" : "long-form";
    $("#vid-basis").textContent = `${s.rows.length} ${state.videoFormat ? "Shorts" : "long-form videos"} · "usual" is the median of the ${s.base.length} published in the last 180 days`;
    const tile = (label, big, small, cls = "") => `<div class="tstat ${cls}"><div class="tlabel">${esc(label)}</div><div class="tbig">${big}</div><div class="tsmall">${small}</div></div>`;
    const judged = s.rows.filter((v) => ageDays(v.published_at) >= 3 && ageDays(v.published_at) <= 30);
    const beat = judged.filter((v) => (multOf(v) ?? 0) >= 1).length;
    const last = s.rows.find((v) => ageDays(v.published_at) >= 3) || s.rows[0];
    const lv = last ? verdictOf(last) : null;
    $("#vid-tiles").innerHTML = [
      last ? tile(`Latest ${word} to judge`, `${esc(multText(multOf(last)))} <span class="of">your usual</span>`, `${esc(truncate(last.title, 60))} · ${esc(fmtFull(last.views))} views`, lv[1] === "ahead" ? "good" : lv[1] === "behind" ? "bad" : "") : "",
      tile(`Your usual ${word}`, `${esc(s.usualViews == null ? "–" : fmtFull(Math.round(s.usualViews)))} <span class="of">views</span>`, `${s.usualWatch == null ? "" : `${esc(s.usualWatch.toFixed(0))}% watched · `}${s.usualConv == null ? "" : `${esc(s.usualConv.toFixed(1))} subscribers per 1,000 views`}`),
      tile("Last 30 days", `${beat} of ${judged.length} <span class="of">beat the usual</span>`, judged.length ? `${judged.length - beat} came in under it` : "nothing old enough to judge yet", !judged.length ? "" : beat * 2 >= judged.length ? "good" : "warn"),
    ].join("");

    // Latest six, each against the usual.
    const cmp = (x, usual, unit, digits = 0) => (x == null ? `<b>–</b>` : `<b>${esc(Number(x).toFixed(digits))}${unit}</b>${usual == null ? "" : ` <span class="${x >= usual ? "up" : "down"}">${x >= usual ? "▲" : "▼"}</span>`}`);
    $("#vid-latest").innerHTML = s.rows.slice(0, 6).map((v) => {
      const m = multOf(v), [label, cls] = verdictOf(v), early = label === "too early";
      const fill = m == null ? 0 : Math.min(100, (m / 3) * 100);
      return `<div class="vcard">
        <a href="${ytUrl(v.id)}" target="_blank" rel="noopener">${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy">` : `<div class="thumb-ph"></div>`}</a>
        <div class="vbody">
          <div class="vtop"><span class="vmult ${cls}">${early ? "–" : esc(multText(m))}</span><span class="pill ${cls}">${esc(label)}</span><span class="hint">${esc(fmtDate(v.published_at))}</span></div>
          ${hbarHtml(early ? 0 : fill, cls === "behind" ? "bad" : cls === "ahead" ? "good" : "info", 100 / 3, "1x, your usual video")}
          <div class="vtitle">${esc(v.title)}</div>
          <div class="vstats"><span>${`<b>${esc(fmt(v.views))}</b>`} views</span><span>${cmp(v.avg_view_pct, s.usualWatch, "%")} watched</span><span>${cmp(v.subs_per_1k, s.usualConv, "", 1)} subs /1k</span></div>
          ${early ? `<div class="hint">Under three days old. Judge it on day three.</div>` : `<button type="button" class="btn ghost" data-lessons="${esc(v.id)}">Where viewers dropped</button>`}
        </div></div>`;
    }).join("") || `<div class="empty">No videos in this format yet</div>`;

    // Conversion: the best, and the well-watched that do not convert. 90-day analytics window.
    const withConv = s.rows.filter((v) => v.subs_per_1k != null && v.analytics_views != null);
    const floor = median(withConv.map((v) => v.analytics_views)) ?? 0;
    const row = (v, max, cls) => `<div class="vrow"><div class="lever-top"><a class="lever-name" href="${ytUrl(v.id)}" target="_blank" rel="noopener">${esc(truncate(v.title, 62))}</a><span class="lever-num"><b>${esc(Number(v.subs_per_1k).toFixed(1))}</b> /1k · ${esc(fmt(v.analytics_views))} views · ${v.subs_net > 0 ? "+" : ""}${esc(fmtFull(v.subs_net))} subs</span></div>${hbarHtml(max ? (Math.max(0, v.subs_per_1k) / max) * 100 : 0, cls)}</div>`;
    const best = withConv.filter((v) => v.analytics_views >= floor).sort((a, b) => b.subs_per_1k - a.subs_per_1k).slice(0, 5);
    const leak = withConv.filter((v) => v.analytics_views >= floor && (s.usualConv == null || v.subs_per_1k < s.usualConv * 0.8)).sort((a, b) => b.analytics_views - a.analytics_views).filter((v) => !best.includes(v)).slice(0, 5);
    const max = Math.max(...best.map((v) => v.subs_per_1k), 1);
    $("#vid-convert").innerHTML = best.map((v) => row(v, max, "good")).join("") || `<div class="empty">Not enough data yet</div>`;
    $("#vid-leak").innerHTML = leak.map((v) => row(v, max, "bad")).join("") || `<div class="empty">Nothing well-watched is converting below the usual</div>`;
    $("#vid-convert-do").innerHTML = best.length ? `<b>Do</b> Point end screens and pinned comments on new uploads at these, and treat their topics as the lane to repeat.` : "";
    $("#vid-leak-do").innerHTML = leak.length ? `<b>Do</b> These have the audience and lose it. Add a pinned comment and an end screen leading to one of the videos on the left.` : "";
  }
  function renderVideoCharts() {
    const d = state.data.videos; const t = theme();
    const detail = (d.detail || []).filter((v) => Number(v.is_short) === state.videoFormat).slice(0, 6);
    const colorFor = (i) => t.slots[i % t.slots.length];
    const styleFor = (i) => ({ width: 2, type: i >= t.slots.length ? "dashed" : "solid" });
    const names = detail.map((v) => truncate(v.title, 30));

    const withLaunch = detail.filter((v) => (v.launch || []).length);
    if (!withLaunch.length) chart("vid-launch", null, { empty: true, emptyText: "No launch data yet for this format" });
    else {
      chart("vid-launch", {
        ...baseOption(t),
        tooltip: { ...baseOption(t).tooltip, trigger: "axis", formatter: (ps) => `<b>Day ${ps[0].axisValue}</b><br>` + ps.filter((p) => p.value != null).sort((a, b) => b.value - a.value).map((p) => `${p.marker} ${esc(p.seriesName)}: ${fmtFull(p.value)}`).join("<br>") },
        legend: { ...baseOption(t).legend, top: 0 },
        grid: { left: 8, right: 16, top: names.length > 3 ? 56 : 36, bottom: 8, containLabel: true },
        xAxis: catAxis(t, Array.from({ length: 10 }, (_, i) => String(i + 1)), { name: "day", nameTextStyle: { color: t.muted } }),
        yAxis: valueAxis(t),
        series: detail.map((v, i) => ({
          name: names[i], type: "line", showSymbol: false, symbolSize: 8,
          data: (v.launch || []).slice(0, 10).map((p) => p.cum), lineStyle: styleFor(i), itemStyle: { color: colorFor(i) }, color: colorFor(i),
          endLabel: i < 3 ? { show: true, formatter: (p) => fmt(p.value), color: t.ink2, fontSize: 11 } : undefined,
        })),
      });
    }

    const withRet = detail.filter((v) => (v.retention || []).length);
    if (!withRet.length) chart("vid-retention", null, { empty: true, emptyText: "No retention curves yet for this format" });
    else {
      const series = [];
      withRet.forEach((v) => {
        const i = detail.indexOf(v);
        series.push({ name: names[i], type: "line", showSymbol: false, data: v.retention.map((p) => [Math.round(p.ratio * 100), Number(p.watchRatio.toFixed(3))]), lineStyle: styleFor(i), itemStyle: { color: colorFor(i) }, color: colorFor(i) });
        if (state.relative) series.push({ name: names[i] + " (relative)", type: "line", showSymbol: false, data: v.retention.map((p) => [Math.round(p.ratio * 100), Number((p.relative ?? 0).toFixed(3))]), lineStyle: { width: 1.5, type: "dashed" }, itemStyle: { color: colorFor(i) }, color: colorFor(i), tooltip: { show: true } });
      });
      chart("vid-retention", {
        ...baseOption(t),
        tooltip: { ...baseOption(t).tooltip, trigger: "axis", formatter: (ps) => `<b>${ps[0].axisValue}% of video</b><br>` + ps.map((p) => `${p.marker} ${esc(p.seriesName)}: ${Math.round(p.value[1] * 100)}%`).join("<br>") },
        legend: { ...baseOption(t).legend, top: 0, data: series.filter((x) => !x.name.endsWith("(relative)")).map((x) => x.name) },
        grid: { left: 8, right: 16, top: withRet.length > 3 ? 56 : 36, bottom: 8, containLabel: true },
        xAxis: { type: "value", min: 0, max: 100, ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => v + "%" }, splitLine: { show: false } },
        yAxis: valueAxis(t, { min: 0, axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => Math.round(v * 100) + "%" } }),
        series,
      });
    }
  }
  function renderVideoTable() {
    const d = state.data.videos;
    const rows = videoSet().rows.slice();
    const { key, asc } = state.sort;
    rows.sort((a, b) => {
      const va = a[key] ?? (typeof a[key] === "string" ? "" : -Infinity), vb = b[key] ?? (typeof b[key] === "string" ? "" : -Infinity);
      const c = typeof va === "string" ? va.localeCompare(vb) : Number(va) - Number(vb);
      return asc ? c : -c;
    });
    $$("#vid-table th[data-key]").forEach((th) => { th.classList.toggle("sorted", th.dataset.key === key); th.classList.toggle("asc", th.dataset.key === key && asc); });
    $("#vid-table-title").textContent = state.videoFormat ? "All Shorts" : "All long-form videos";
    $("#vid-count").textContent = rows.length ? `${rows.length} videos · click a column to sort${!state.videoFormat && d.orphan_metrics ? ` · ${d.orphan_metrics} older videos have analytics but no metadata yet` : ""}` : "";
    const tb = $("#vid-table tbody"), LIMIT = 8;
    const all = $("#vid-all");
    all.hidden = rows.length <= LIMIT;
    all.textContent = state.videoAll ? "Show fewer" : `Show all ${rows.length}`;
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="8"><div class="empty">No videos in this format yet</div></td></tr>`; return; }
    tb.innerHTML = (state.videoAll ? rows : rows.slice(0, LIMIT)).map((r) => {
      const v = Number(r.views) || 0, m = multOf(r), [, cls] = verdictOf(r);
      return `<tr>
        <td class="title"><a href="${ytUrl(r.id)}" target="_blank" rel="noopener">${esc(r.title)}</a></td>
        <td>${esc(fmtDate(r.published_at))}</td>
        <td class="num" title="${fmtFull(v)}">${fmt(v)}</td>
        <td class="num"><b class="vmult-s ${cls}">${esc(multText(m))}</b><div class="mult-bar"><i style="width:${m == null ? 0 : Math.min(100, (m / 3) * 100).toFixed(0)}%"></i></div></td>
        <td class="num">${r.avg_view_pct == null ? "–" : Number(r.avg_view_pct).toFixed(0) + "%"}</td>
        <td class="num">${r.subs_net == null || r.metrics_at == null ? "–" : (r.subs_net > 0 ? "+" : "") + fmt(r.subs_net)}</td>
        <td class="num ${r.subs_per_1k != null && r.subs_per_1k >= 10 ? "above" : ""}">${r.subs_per_1k == null ? "–" : Number(r.subs_per_1k).toFixed(1)}</td>
        <td class="num" title="${r.engaged_views == null ? "No engaged-views data yet" : `${fmtFull(r.engaged_views)} engaged of ${fmtFull(r.analytics_views)} analytics views, 90 days`}">${r.engaged_pct == null ? "–" : Number(r.engaged_pct).toFixed(0) + "%"}</td>
      </tr>`;
    }).join("");
  }

  // ---------- Competitors ----------
  // Who is growing, what broke out, what just went up. Formats stay apart: outliers are picked one format at a time.
  async function loadCompetitors() {
    state.data.competitors = await api("/api/competitors");
    $("#comp-log").checked = state.compLog;
    $("#comp-log").addEventListener("change", (e) => { state.compLog = e.target.checked; renderCompChart(); });
    $("#comp-chart-fold").addEventListener("toggle", (e) => { if (e.target.open) renderCompChart(); });
    $("#comp-format").addEventListener("click", (e) => { const b = e.target.closest("button[data-format]"); if (!b) return; state.compFormat = Number(b.dataset.format); state.compOutAll = false; $$("#comp-format button").forEach((x) => x.classList.toggle("active", x === b)); renderOutliers(); });
    $("#comp-growth-all").addEventListener("click", () => { state.compGrowAll = !state.compGrowAll; renderCompGrowth(); });
    $("#comp-outliers-all").addEventListener("click", () => { state.compOutAll = !state.compOutAll; renderOutliers(); });
    $("#comp-uploads-all").addEventListener("click", () => { state.compUpAll = !state.compUpAll; renderUploads(); });
    renderCompetitors();
  }
  function renderCompetitors() { renderCompGrowth(); renderOutliers(); renderUploads(); renderCompTiles(); renderCompTable(); if ($("#comp-chart-fold").open) renderCompChart(); }
  /** Subscribers gained over the last 30 days per channel, from the stored snapshots. */
  function compGrowth() {
    const d = state.data.competitors || {};
    return (d.channels || []).map((c) => {
      const s = (c.series || []).filter((p) => p.subscribers != null);
      if (s.length < 2) return null;
      const last = s.at(-1), cut = new Date(last.fetched_at).getTime() - 30 * 86400000;
      const base = s.find((p) => new Date(p.fetched_at).getTime() >= cut) || s[0];
      const days = (new Date(last.fetched_at).getTime() - new Date(base.fetched_at).getTime()) / 86400000;
      if (days < 7 || !base.subscribers) return null;
      const gain = last.subscribers - base.subscribers;
      return { c, gain, pct: (gain / base.subscribers) * 100, days: Math.round(days), subs: last.subscribers };
    }).filter(Boolean).sort((a, b) => b.pct - a.pct);
  }
  function renderCompGrowth() {
    const rows = compGrowth(), el = $("#comp-growth"), LIMIT = 8;
    if (!rows.length) { el.innerHTML = `<div class="empty">Not enough snapshots yet</div>`; return; }
    $("#comp-growth-meta").textContent = `subscribers gained over the last ${rows[0].days} days, as a share of the channel's size; YouTube rounds counts to three figures, so large channels move in steps`;
    const max = Math.max(...rows.map((r) => r.pct), 0.1);
    let shown = state.compGrowAll ? rows : rows.slice(0, LIMIT);
    const own = rows.find((r) => Number(r.c.is_own));
    if (own && !shown.includes(own)) shown = [...shown, own];
    el.innerHTML = shown.map((r) => {
      const isOwn = Number(r.c.is_own);
      return `<div class="vrow ${isOwn ? "own" : ""}"><div class="lever-top"><span class="lever-name">${rows.indexOf(r) + 1}. ${esc((r.c.title || r.c.handle || "").trim())}${isOwn ? ' <span class="badge own">you</span>' : ""}</span>
        <span class="lever-num"><b>${r.pct >= 0 ? "+" : ""}${esc(r.pct.toFixed(1))}%</b> · ${r.gain >= 0 ? "+" : ""}${esc(fmt(r.gain))} to ${esc(fmt(r.subs))} · ${esc(String(r.c.uploads_30d))} uploads</span></div>
        ${hbarHtml((Math.max(0, r.pct) / max) * 100, isOwn ? "ink" : r.pct > 0 ? "info" : "muted")}</div>`;
    }).join("");
    const all = $("#comp-growth-all");
    all.hidden = rows.length <= LIMIT;
    all.textContent = state.compGrowAll ? "Show fewer" : `Show all ${rows.length}`;
  }
  function renderCompTiles() {
    const d = state.data.competitors || {};
    const tile = (label, big, small, cls = "") => `<div class="tstat ${cls}"><div class="tlabel">${esc(label)}</div><div class="tbig">${big}</div><div class="tsmall">${small}</div></div>`;
    const g = compGrowth(), top = g.find((r) => !Number(r.c.is_own)), own = g.find((r) => Number(r.c.is_own));
    const rank = own ? g.indexOf(own) + 1 : null;
    const o = (d.outliers || []).filter((x) => ageDays(x.published_at) <= 30).sort((a, b) => b.outlier_score - a.outlier_score)[0] || (d.outliers || [])[0];
    const ups = (d.uploads || []).filter((u) => !Number(u.is_own)).sort((a, b) => b.views_per_hour - a.views_per_hour);
    $("#comp-tiles").innerHTML = [
      own ? tile("Your growth rank", `${rank} <span class="of">of ${g.length} channels</span>`, `${own.pct >= 0 ? "+" : ""}${esc(own.pct.toFixed(1))}% in ${own.days} days${top ? `; ${rank === 1 ? "next" : "fastest"} is ${esc((top.c.title || "").trim())} at ${top.pct >= 0 ? "+" : ""}${esc(top.pct.toFixed(1))}%` : ""}`, rank <= Math.ceil(g.length / 3) ? "good" : rank > (g.length * 2) / 3 ? "bad" : "warn")
        : top ? tile("Fastest growing", esc((top.c.title || "").trim()), `+${esc(top.pct.toFixed(1))}% in ${top.days} days`) : "",
      o ? tile("Biggest breakout, 30 days", `${esc(Number(o.outlier_score).toFixed(0))}x <span class="of">${esc((o.channel_title || "").trim())}</span>`, `${esc(truncate(o.title, 70))} · ${esc(fmt(o.views))} views · ${o.is_short ? "Short" : "long-form"}`) : "",
      tile("Uploaded in 48 hours", `${ups.length} <span class="of">videos</span>`, ups[0] ? `fastest: ${esc(truncate(ups[0].title, 56))}, ${esc(fmtFull(Math.round(ups[0].views_per_hour)))} views an hour` : "nothing new"),
    ].join("");
  }
  function channelColors() {
    const d = state.data.competitors; const t = theme();
    const comps = (d.channels || []).filter((c) => !Number(c.is_own)).slice().sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)));
    const map = new Map();
    for (const c of d.channels || []) if (Number(c.is_own)) map.set(c.id, { color: t.accent, dashed: false });
    comps.forEach((c, i) => map.set(c.id, { color: t.slots[i % t.slots.length], dashed: i >= t.slots.length }));
    return map;
  }
  function renderCompChart() {
    const d = state.data.competitors; const t = theme();
    const colors = channelColors();
    const chans = (d.channels || []).filter((c) => (c.series || []).some((p) => p.subscribers != null));
    if (!chans.length) { chart("comp-subs", null, { empty: true }); return; }
    chart("comp-subs", {
      ...baseOption(t),
      tooltip: { ...baseOption(t).tooltip, trigger: "axis", formatter: (ps) => `<b>${esc(fmtDateTime(ps[0].value[0]))}</b><br>` + ps.slice().sort((a, b) => b.value[1] - a.value[1]).map((p) => `${p.marker} ${esc(p.seriesName)}: ${fmtFull(p.value[1])}`).join("<br>") },
      legend: { ...baseOption(t).legend, top: 0 },
      grid: { left: 8, right: 16, top: 56, bottom: 8, containLabel: true },
      xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => fmtDate(v) } },
      yAxis: valueAxis(t, { type: state.compLog ? "log" : "value", logBase: 10, min: state.compLog ? 1 : undefined }),
      series: chans.map((c) => {
        const col = colors.get(c.id) || { color: t.comp, dashed: false };
        return { name: (c.title || c.handle || c.id).trim(), type: "line", showSymbol: true, symbolSize: 6,
          data: c.series.filter((p) => p.subscribers != null).map((p) => [p.fetched_at, p.subscribers]),
          lineStyle: { width: Number(c.is_own) ? 3 : 2, type: col.dashed ? "dashed" : "solid" }, itemStyle: { color: col.color }, color: col.color };
      }),
    });
  }
  function renderCompTable() {
    const d = state.data.competitors; const colors = channelColors();
    const tb = $("#comp-table tbody");
    const rows = (d.channels || []).slice().sort((a, b) => Number(b.is_own) - Number(a.is_own) || (b.latest?.subscribers || 0) - (a.latest?.subscribers || 0));
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">No channels yet</div></td></tr>`; return; }
    tb.innerHTML = rows.map((c) => `<tr>
      <td><span class="chip" style="background:${colors.get(c.id)?.color || "var(--comp)"}"></span>${esc((c.title || "").trim())} <span class="hint">${esc(c.handle || "")}</span>${Number(c.is_own) ? ' <span class="badge own">own</span>' : ""}</td>
      <td class="num" title="${fmtFull(c.latest?.subscribers)}">${fmt(c.latest?.subscribers)}</td>
      <td class="num" title="${fmtFull(c.latest?.total_views)}">${fmt(c.latest?.total_views)}</td>
      <td class="num">${fmtFull(c.latest?.video_count)}</td>
      <td class="num">${fmt(c.uploads_30d)}</td>
      <td>${esc(c.last_crawled_at ? ago(c.last_crawled_at) : "–")}</td>
    </tr>`).join("");
  }
  function renderOutliers() {
    const d = state.data.competitors;
    const el = $("#comp-outliers"), LIMIT = 6;
    const list = (d.outliers || []).filter((o) => Number(o.is_short) === (state.compFormat || 0));
    const all = $("#comp-outliers-all");
    all.hidden = list.length <= LIMIT;
    all.textContent = state.compOutAll ? "Show fewer" : `Show all ${list.length}`;
    if (!list.length) { el.innerHTML = `<div class="empty">No breakouts in this format in the last 90 days</div>`; return; }
    const max = Math.log10(Math.max(...list.map((o) => o.outlier_score), 10));
    el.innerHTML = (state.compOutAll ? list : list.slice(0, LIMIT)).map((o) => `<div class="vcard">
      <a href="${ytUrl(o.video_id)}" target="_blank" rel="noopener">${o.thumbnail ? `<img loading="lazy" src="${esc(o.thumbnail)}" alt="">` : `<div class="thumb-ph"></div>`}</a>
      <div class="vbody">
        <div class="vtop"><span class="vmult">${esc(multText(Number(o.outlier_score)))}</span><span class="hint">${esc((o.channel_title || "").trim())} · ${esc(fmtDate(o.published_at))}</span></div>
        <div class="mult-bar wide"><i style="width:${Math.min(100, (Math.log10(Math.max(1, o.outlier_score)) / max) * 100).toFixed(0)}%"></i></div>
        <div class="vtitle"><a href="${ytUrl(o.video_id)}" target="_blank" rel="noopener">${esc(o.title)}</a></div>
        <div class="vstats"><span><b>${esc(fmt(o.views))}</b> views</span><span>their usual <b>${esc(fmt(Math.round(o.channel_median)))}</b></span></div>
      </div></div>`).join("");
  }
  function renderUploads() {
    const d = state.data.competitors;
    const el = $("#comp-uploads"), LIMIT = 6;
    const rows = (d.uploads || []).slice().sort((a, b) => b.views_per_hour - a.views_per_hour);
    $("#comp-upload-count").textContent = rows.length ? `${rows.length} in the last 48 hours, fastest first; views an hour is the fair way to compare a 2-hour-old upload with a 40-hour-old one` : "";
    const all = $("#comp-uploads-all");
    all.hidden = rows.length <= LIMIT;
    all.textContent = state.compUpAll ? "Show fewer" : `Show all ${rows.length}`;
    if (!rows.length) { el.innerHTML = `<div class="empty">No uploads in the last 48 hours</div>`; return; }
    const max = Math.max(...rows.map((u) => u.views_per_hour), 1);
    el.innerHTML = (state.compUpAll ? rows : rows.slice(0, LIMIT)).map((u) => `<div class="vrow ${Number(u.is_own) ? "own" : ""}"><div class="lever-top"><a class="lever-name" href="${ytUrl(u.video_id)}" target="_blank" rel="noopener">${esc(truncate(u.title, 78))}</a>
        <span class="lever-num"><b>${esc(fmtFull(Math.round(u.views_per_hour)))}</b> an hour · ${esc(fmt(u.views))} views · ${esc((u.channel_title || "").trim())}${Number(u.is_own) ? ' <span class="badge own">you</span>' : ""} · ${u.is_short ? "Short" : "long-form"} · ${esc(ago(u.published_at))}</span></div>
        ${hbarHtml((u.views_per_hour / max) * 100, Number(u.is_own) ? "ink" : "info")}</div>`).join("");
  }

  // ---------- Ideas ----------
  // src/intel/ideas.ts owns every number; this only filters the 365-day set and formats it.
  const IDEA_STATUS_CLS = { new: "new", related: "related", in_pipeline: "pipeline", made_other_format: "other", made: "made" };
  const fmtDur = (s) => (s == null ? "" : s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`);
  const fmtAge = (d) => (d < 1 ? "today" : d < 60 ? `${d}d ago` : d < 730 ? `${Math.round(d / 30)}mo ago` : `${(d / 365).toFixed(1)}y ago`);
  async function loadIdeas() {
    state.data.ideas = await api("/api/ideas");
    state.ideas = state.ideas || { format: "both", window: 90, min: 2, niche: "history", hideMade: false };
    const bindSeg = (id, key, cast) => $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.ideas[key] = cast(b.dataset.v);
      $$(`${id} button`).forEach((x) => x.classList.toggle("active", x === b));
      renderIdeas();
    });
    bindSeg("#ideas-format", "format", String);
    bindSeg("#ideas-window", "window", Number);
    bindSeg("#ideas-min", "min", Number);
    bindSeg("#ideas-niche", "niche", String);
    $("#ideas-hide-made").addEventListener("change", (e) => { state.ideas.hideMade = e.target.checked; renderIdeas(); });
    renderIdeas();
  }
  function ideaRows(format) {
    const f = state.ideas; const d = state.data.ideas;
    const niches = f.niche === "history" ? ["history"] : f.niche === "wide" ? ["history", "epic", "world"] : null;
    return (d.rows || []).filter((r) => r.format === format && r.days_ago <= f.window && r.multiple >= f.min
      && (!niches || niches.includes(r.niche)) && (!f.hideMade || r.itiha.status !== "made"))
      .sort((a, b) => b.multiple - a.multiple);
  }
  function renderIdeas() {
    const d = state.data.ideas; if (!d) return;
    const f = state.ideas; const labels = d.coverage_labels || {};
    for (const format of ["long", "short"]) {
      const card = $(`#ideas-${format}-card`);
      card.hidden = f.format !== "both" && f.format !== format;
      const rows = ideaRows(format);
      $(`#ideas-${format}-count`).textContent = `${rows.length} video${rows.length === 1 ? "" : "s"}, highest multiple first`;
      const tb = $(`#ideas-${format} tbody`);
      if (!rows.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">Nothing at ${f.min}× or more in the last ${f.window} days with these filters</div></td></tr>`; continue; }
      // Eight rows until asked: the top of each list is what matters, and 150 rows of thumbnails buried it.
      const showAll = !!(state.ideasAll && state.ideasAll[format]);
      const more = $(`#ideas-${format}-all`);
      if (more) {
        more.hidden = rows.length <= 8;
        more.textContent = showAll ? "Show the top 8" : `Show all ${Math.min(rows.length, 150)}`;
        more.onclick = () => { state.ideasAll = { ...(state.ideasAll || {}), [format]: !showAll }; renderIdeas(); };
      }
      const topMult = Math.max(...rows.map((r) => r.multiple), 2);
      tb.innerHTML = rows.slice(0, showAll ? 150 : 8).map((r) => {
        const st = r.itiha.status;
        const own = r.itiha.title && st !== "new"
          ? `<div class="hint">${r.itiha.video_id ? `<a href="${ytUrl(r.itiha.video_id)}" target="_blank" rel="noopener">${esc(truncate(r.itiha.title, 60))}</a>` : esc(truncate(r.itiha.title, 60))}${r.itiha.views != null ? ` · ${fmt(r.itiha.views)} views` : ""}${r.itiha.format ? ` · ${esc(r.itiha.format)}` : ""}</div>` : "";
        const also = r.also?.length ? `<div class="hint" title="${esc(r.also.map((a) => `${a.title} (${a.channel}, ${a.multiple.toFixed(1)}×)`).join("\n"))}">+${r.also.length} similar: ${esc(truncate(r.also.map((a) => a.channel).filter((c, i, A) => A.indexOf(c) === i).join(", "), 50))}</div>` : "";
        return `<tr>
          <td class="thumb"><a href="${ytUrl(r.video_id)}" target="_blank" rel="noopener">${r.thumbnail ? `<img loading="lazy" src="${esc(r.thumbnail)}" alt="">` : `<span class="thumb-ph"></span>`}</a></td>
          <td class="title"><a href="${ytUrl(r.video_id)}" target="_blank" rel="noopener">${esc(r.title)}</a>
            <div class="hint">${esc(r.channel)} · ${esc(fmtAge(r.days_ago))}${r.duration_sec ? ` · ${esc(fmtDur(r.duration_sec))}` : ""}${r.niche !== "history" ? ` · <span class="badge">${esc(r.niche)}</span>` : ""}</div>${also}</td>
          <td class="num"><span class="idea-mult">${r.multiple >= 10 ? Math.round(r.multiple) : r.multiple.toFixed(1)}×</span><div class="mult-bar"><i style="width:${(Math.log(Math.max(r.multiple, 1.01)) / Math.log(topMult) * 100).toFixed(0)}%"></i></div><div class="hint" title="Median of ${r.baseline_n} same-format videos on this channel">median ${fmt(r.channel_median)}</div></td>
          <td class="num" title="${fmtFull(r.views)}">${fmt(r.views)}</td>
          <td><div>${esc(r.topic || "–")}</div><div class="hint" title="${r.hook.source === "opening" ? "From the transcript opening" : "From the title only (no transcript stored)"}">${esc(r.hook.name)}${r.hook.template ? ` · ${esc(r.hook.template)}` : ""}${r.hook.source === "title" ? " · title" : ""} · ${esc(r.lane)}</div></td>
          <td><span class="idea-st ${IDEA_STATUS_CLS[st] || ""}" title="${r.itiha.shared?.length ? `Matched on: ${esc(r.itiha.shared.join(", "))} (overlap ${r.itiha.coverage}). Title matching, so check it.` : "No shared subject words with any Itiha video or pipeline item"}">${esc(labels[st] || st)}</span>${own}</td>
        </tr>`;
      }).join("");
    }
    const all = [...ideaRows("long"), ...ideaRows("short")];
    const chans = new Set(all.map((r) => r.channel)).size;
    $("#ideas-summary").textContent = `${d.scanned} competitor videos from the last 365 days, each against its own channel's same-format median. ${all.length} pass these filters across ${chans} channels; ${all.filter((r) => r.itiha.status === "new").length} are topics Itiha has never made. Built ${ago(d.generated_at)}.${d.thin_baselines?.length ? ` Skipped for a thin baseline (under 5 videos): ${d.thin_baselines.map((t) => `${t.channel} ${t.format}`).join(", ")}.` : ""}`;
    renderIgIdeas(d, labels);
    renderIdeaPicks();
    const fl = { history: "Indian history", wide: "history, epics, world", all: "everything" };
    $("#ideas-filter-sum").textContent = `last ${f.window} days · ${f.min}× or more · ${fl[f.niche] || f.niche}${f.hideMade ? " · hiding topics already made" : ""}`;
  }
  /** The lead of the Ideas tab: the three strongest outliers per format on subjects Itiha has never made, as cards. */
  function renderIdeaPicks() {
    const box = $("#ideas-picks");
    const pick = (format) => ideaRows(format).filter((r) => r.itiha.status === "new").sort((a, b) => (b.idea_score ?? 0) - (a.idea_score ?? 0) || b.multiple - a.multiple).slice(0, 3);
    const groups = [["Long-form", pick("long")], ["Shorts", pick("short")]].filter(([, xs]) => xs.length && (state.ideas.format === "both" || state.ideas.format === (xs[0].format)));
    if (!groups.length) { box.innerHTML = `<div class="empty">Nothing new to Itiha passes these filters. Open Filters to widen the window or the niche.</div>`; return; }
    const top = Math.max(...groups.flatMap(([, xs]) => xs.map((r) => r.multiple)), 2);
    const card = (r) => `<a class="pickcard" href="${ytUrl(r.video_id)}" target="_blank" rel="noopener">
        ${r.thumbnail ? `<img loading="lazy" src="${esc(r.thumbnail)}" alt="">` : `<span class="thumb-ph"></span>`}
        <div class="pick-body">
          <div class="pick-mult"><b>${r.multiple >= 10 ? Math.round(r.multiple) : r.multiple.toFixed(1)}×</b><span>its channel's normal</span></div>
          <div class="mult-bar wide"><i style="width:${(Math.log(Math.max(r.multiple, 1.01)) / Math.log(top) * 100).toFixed(0)}%"></i></div>
          <div class="pick-title">${esc(truncate(r.title, 90))}</div>
          <div class="hint">${esc(r.channel)} · ${esc(fmt(r.views))} views · ${esc(fmtAge(r.days_ago))}</div>
          <div class="pick-topic"><span class="lbl">Subject</span>${esc(r.topic || "–")}</div>
          ${r.hook && r.hook.form !== "none" ? `<div class="pick-topic"><span class="lbl">Opening</span>${esc(r.hook.name)}</div>` : ""}
        </div></a>`;
    box.innerHTML = groups.map(([label, xs]) => `<div class="pick-group"><h3 class="sub">${label}</h3><div class="pick-row">${xs.map(card).join("")}</div></div>`).join("");
  }
  // Instagram reels from the newest supervised browser pass (data/ig-browser/). Format filter: shown with "both"
  // and "short"; window filter by posted date; niche and hide-made filters as for YouTube. Multiples are against
  // the account's own reels and are never compared with the YouTube lists. The niche filter is NOT applied here:
  // the accounts are owner-picked, and the title-tuned niche regex misreads captions; the niche shows as a badge.
  function renderIgIdeas(d, labels) {
    const ig = d.instagram || { rows: [], accounts: [] }; const f = state.ideas;
    $("#ideas-ig-card").hidden = f.format === "long";
    const rows = (ig.rows || []).filter((r) => r.multiple >= f.min && (r.days_ago == null || r.days_ago <= f.window)
      && (f.niche === "all" || !r.sponsored) && (!f.hideMade || r.itiha.status !== "made"));
    $("#ideas-ig").textContent = ig.date
      ? `From the supervised Claude in Chrome pass of ${ig.date} (${fmtAge(ig.age_days)} old) over ${ig.accounts.length} accounts you listed. ${ig.note}`
      : ig.note;
    $("#ideas-ig-count").textContent = ig.date ? `${rows.length} reel${rows.length === 1 ? "" : "s"} · pass ${ig.date}` : "no pass yet";
    const tb = $("#ideas-igtable tbody");
    if (!ig.date) { tb.innerHTML = `<tr><td colspan="5"><div class="empty">No browser pass yet. Ask Claude Code for an Instagram pass (docs/IG-BROWSER-OUTLIERS.md).</div></td></tr>`; return; }
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="5"><div class="empty">No reels at ${f.min}× or more in the last ${f.window} days with these filters</div></td></tr>`; return; }
    tb.innerHTML = rows.map((r) => {
      const st = r.itiha.status;
      const own = r.itiha.title && st !== "new" ? `<div class="hint">${r.itiha.video_id ? `<a href="${ytUrl(r.itiha.video_id)}" target="_blank" rel="noopener">${esc(truncate(r.itiha.title, 60))}</a>` : esc(truncate(r.itiha.title, 60))}${r.itiha.format ? ` · ${esc(r.itiha.format)}` : ""}</div>` : "";
      const prof = `https://www.instagram.com/${encodeURIComponent(r.handle)}/reels/`;
      return `<tr>
        <td class="title">${esc(r.caption)}
          <div class="hint"><a href="${prof}" target="_blank" rel="noopener">@${esc(r.handle)}</a>${r.days_ago != null ? ` · ${esc(fmtAge(r.days_ago))}` : ""}${r.niche !== "history" ? ` · <span class="badge">${esc(r.niche)}</span>` : ""}${r.sponsored ? ` · <span class="badge">sponsored</span>` : ""}</div></td>
        <td class="num"><span class="idea-mult">${r.multiple >= 10 ? Math.round(r.multiple) : r.multiple.toFixed(1)}×</span><div class="hint">median ${fmt(r.account_median)}</div></td>
        <td class="num">${esc(r.plays_raw)}</td>
        <td><div>${esc(r.topic || "–")}</div><div class="hint">${esc(r.lane)}</div></td>
        <td><span class="idea-st ${IDEA_STATUS_CLS[st] || ""}" title="${r.itiha.shared?.length ? `Matched on: ${esc(r.itiha.shared.join(", "))} (overlap ${r.itiha.coverage}). Title matching, so check it.` : "No shared subject words with any Itiha video or pipeline item"}">${esc(labels[st] || st)}</span>${own}</td>
      </tr>`;
    }).join("");
  }

  // ---------- Audience ----------
  // Long-form and Shorts are never mixed here: every number is one format's 28-day report.
  async function loadAudience() {
    state.data.audience = await api("/api/audience");
    state.audFormat = state.audFormat || "long";
    $("#aud-format").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-format]"); if (!b) return;
      state.audFormat = b.dataset.format; state.audSrcAll = false; state.audSearchAll = false;
      $$("#aud-format button").forEach((x) => x.classList.toggle("active", x === b));
      renderAudience();
    });
    $("#aud-traffic-all").addEventListener("click", () => { state.audSrcAll = !state.audSrcAll; renderAudience(); });
    $("#aud-search-all").addEventListener("click", () => { state.audSearchAll = !state.audSearchAll; renderAudience(); });
    renderAudience();
  }
  const SRC_NAMES = { SHORTS: "Shorts feed", YT_SEARCH: "YouTube search", SUBSCRIBER: "Home feed and subscriptions", YT_CHANNEL: "Channel page", RELATED_VIDEO: "Suggested videos", EXT_URL: "Links outside YouTube", NO_LINK_OTHER: "Direct or unknown", PLAYLIST: "Playlists", NOTIFICATION: "Notifications", YT_OTHER_PAGE: "Other YouTube pages", END_SCREEN: "End screens", HASHTAGS: "Hashtags", SOUND_PAGE: "Sound page", ADVERTISING: "Advertising", PROMOTED: "Promoted", VIDEO_REMIXES: "Remixes", NO_LINK_EMBEDDED: "Embedded players", ANNOTATION: "Cards", CAMPAIGN_CARD: "Campaign card", LIVE_REDIRECT: "Live redirect", SHORTS_CONTENT_LINKS: "Links on Shorts", IMMERSIVE_LIVE: "Live feed", PLAYLIST_PAGE: "Playlist page", SUBSCRIBER_FEED: "Subscriber feed" };
  const DEVICE_NAMES = { MOBILE: "Phone", DESKTOP: "Computer", TV: "TV", TABLET: "Tablet", GAME_CONSOLE: "Console" };
  const pctText = (x) => (x >= 10 ? Math.round(x) : x >= 1 ? x.toFixed(1).replace(/\.0$/, "") : x > 0 ? "<1" : "0") + "%";
  const minText = (m, v) => (v > 0 ? `${(m / v).toFixed(1)} min a view` : "");
  /** A share's move against the 28 days before, in points. Neutral colour: a rising share is not good or bad by itself. */
  const chgHtml = (now, was) => { if (was == null) return ""; const d = now - was; return Math.abs(d) < 0.5 ? `<span class="chg flat" title="was ${pctText(was)}">no change</span>` : `<span class="chg" title="was ${pctText(was)}">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} pts</span>`; };
  /** One source's share of views across every stored 28-day window, as a small line. */
  function shareSpark(series, key) {
    const v = (series || []).map((p) => Number(p.s && p.s[key]) || 0);
    if (v.length < 6) return "";
    const W = 64, H = 18, mx = Math.max(...v, 0.1), mn = Math.min(...v);
    const span = Math.max(mx - mn, mx * 0.08, 0.1);
    const pts = v.map((y, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${(H - 2 - ((y - mn) / span) * (H - 4)).toFixed(1)}`).join(" ");
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="share of views over the stored windows"><polyline points="${pts}"/></svg>`;
  }
  function audRow(name, num, fill, cls = "info", href = "") {
    const label = href ? `<a class="lever-name" href="${esc(href)}" target="_blank" rel="noopener">${name}</a>` : `<span class="lever-name">${name}</span>`;
    return `<div class="vrow"><div class="lever-top">${label}<span class="lever-num">${num}</span></div>${hbarHtml(Math.max(0, Math.min(100, fill)), cls)}</div>`;
  }
  function renderAudience() {
    const d = state.data.audience || {}; const f = state.audFormat || "long";
    const R = (d.formats && d.formats[f]) || {};
    const rows = (k) => ((R[k] && R[k].rows) || []).map((r) => ({ ...r, views: Number(r.views) || 0, minutes: Number(r.estimatedMinutesWatched) || 0 }));
    const sum = (a, k = "views") => a.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const fname = f === "long" ? "long-form" : "Shorts";
    const any = Object.values(R).find((r) => r);
    $("#aud-range").textContent = any ? `${fmtDay(any.start_date)} to ${fmtDay(any.end_date)}, ${fname} uploads only, fetched ${ago(any.fetched_at)}` : "No report snapshots yet. Run a refresh.";
    const empty = `<div class="empty">No data for this format yet</div>`;
    const tile = (label, big, small, cls = "") => `<div class="tstat ${cls}"><div class="tlabel">${esc(label)}</div><div class="tbig">${big}</div><div class="tsmall">${small}</div></div>`;

    // --- sources
    const src = rows("traffic_sources").sort((a, b) => b.views - a.views);
    const total = sum(src);
    const eng = {};
    if (f === "long" && d.engaged_long) for (const r of d.engaged_long.rows || []) if (Number(r.views) > 0) eng[r.key] = (Number(r.engaged) / Number(r.views)) * 100;
    const share = (k) => { const r = src.find((x) => x.insightTrafficSourceType === k); return r && total ? (r.views / total) * 100 : 0; };
    const P = (d.prev && d.prev[f]) || {}, series = (d.trend && d.trend[f]) || [];
    const prevRows = (k) => ((P[k] && P[k].rows) || []).map((r) => ({ ...r, views: Number(r.views) || 0 }));
    const pSrc = prevRows("traffic_sources"), pTotal = sum(pSrc);
    const wasShare = (k) => { if (!pTotal) return null; const r = pSrc.find((x) => x.insightTrafficSourceType === k); return r ? (r.views / pTotal) * 100 : 0; };
    const SRC_LIMIT = 6;
    const srcShown = state.audSrcAll ? src : src.slice(0, SRC_LIMIT);
    $("#aud-src-meta").textContent = total ? `${fmtFull(total)} ${fname} views in 28 days${P.traffic_sources ? `; arrows compare with the 28 days to ${fmtDay(P.traffic_sources.end_date)}, the line is each share since ${series[0] ? fmtDay(series[0].end) : "the first window"}` : ""}${f === "long" && d.engaged_long ? `; the engaged share is measured since ${fmtDay(d.engaged_long.start_date)}` : ""}` : "";
    $("#aud-traffic").innerHTML = srcShown.length ? srcShown.map((r) => {
      const p = (r.views / total) * 100, e = eng[r.insightTrafficSourceType];
      return audRow(esc(SRC_NAMES[r.insightTrafficSourceType] || r.insightTrafficSourceType),
        `${shareSpark(series, r.insightTrafficSourceType)}${chgHtml(p, wasShare(r.insightTrafficSourceType))} <b>${pctText(p)}</b> · ${esc(fmt(r.views))} views · ${esc(minText(r.minutes, r.views))}${e != null ? ` · ${Math.round(e)}% engaged` : ""}`, p, src.indexOf(r) === 0 ? "ink" : "info");
    }).join("") : empty;
    const sAll = $("#aud-traffic-all"); sAll.hidden = src.length <= SRC_LIMIT; sAll.textContent = state.audSrcAll ? "Show fewer" : `Show all ${src.length}`;
    const doSrc = [];
    const mover = pTotal ? src.map((r) => ({ k: r.insightTrafficSourceType, now: (r.views / total) * 100, was: wasShare(r.insightTrafficSourceType) })).sort((a, b) => Math.abs(b.now - b.was) - Math.abs(a.now - a.was))[0] : null;
    if (mover && Math.abs(mover.now - mover.was) >= 3) doSrc.push(`Biggest shift: ${SRC_NAMES[mover.k] || mover.k} went from ${pctText(mover.was)} to ${pctText(mover.now)} of ${fname} views against the 28 days before.`);
    if (f === "long") {
      if (eng.SUBSCRIBER != null && eng.SUBSCRIBER < 60) doSrc.push(`Only ${Math.round(eng.SUBSCRIBER)}% of Home-feed plays since ${fmtDay(d.engaged_long.start_date)} counted as engaged views, so judge a long-form on engaged views, not views.`);
      const deep = src.filter((r) => r.views / total >= 0.01 && r.insightTrafficSourceType !== "SUBSCRIBER").sort((a, b) => b.minutes / b.views - a.minutes / a.views)[0];
      const home = src.find((r) => r.insightTrafficSourceType === "SUBSCRIBER");
      if (deep && home && deep.minutes / deep.views > (home.minutes / home.views) * 1.5) doSrc.push(`${SRC_NAMES[deep.insightTrafficSourceType] || deep.insightTrafficSourceType}: only ${pctText((deep.views / total) * 100)} of views, but each lasts ${(deep.minutes / deep.views).toFixed(1)} minutes against ${(home.minutes / home.views).toFixed(1)} from the Home feed.`);
    } else if (share("YT_SEARCH") >= 15) doSrc.push(`Search is ${pctText(share("YT_SEARCH"))} of Shorts views. Read the terms below before calling it demand: a film or news name fades in days.`);
    $("#aud-src-do").innerHTML = doSrc.length ? `<b>Read</b> ${esc(doSrc.join(" "))}` : "";

    // --- who: age and gender
    const demo = rows("demographics");
    const ages = Array.from(new Set(demo.map((r) => r.ageGroup))).sort();
    const g = (a, s) => Number(demo.find((r) => r.ageGroup === a && r.gender === s)?.viewerPercentage ?? 0);
    const ageRows = ages.map((a) => ({ a, m: g(a, "male"), w: g(a, "female"), t: sum(demo.filter((r) => r.ageGroup === a), "viewerPercentage") }));
    const ageMax = Math.max(...ageRows.map((r) => r.t), 1);
    $("#aud-demo").innerHTML = ageRows.length ? ageRows.map((r) => `<div class="vrow"><div class="lever-top"><span class="lever-name">${esc(r.a.replace("age", "").replace("-", " to ").replace("65 to", "65 and over"))}</span>
      <span class="lever-num"><b>${pctText(r.t)}</b> · ${pctText(r.m)} men, ${pctText(r.w)} women</span></div>
      <div class="hbar duo"><i class="m" style="width:${(r.m / ageMax) * 100}%"></i><i class="f" style="width:${(r.w / ageMax) * 100}%"></i></div></div>`).join("") : empty;
    const men = sum(demo.filter((r) => r.gender === "male"), "viewerPercentage");
    const topGroup = demo.slice().sort((a, b) => Number(b.viewerPercentage) - Number(a.viewerPercentage))[0];

    // --- who: subscribed
    const ss = rows("subscribed_status");
    const subR = ss.find((r) => r.subscribedStatus === "SUBSCRIBED"), unR = ss.find((r) => r.subscribedStatus === "UNSUBSCRIBED");
    const ssTotal = sum(ss), unPct = ssTotal && unR ? (unR.views / ssTotal) * 100 : null;
    const pSs = prevRows("subscribed_status"), pSsTotal = sum(pSs), pUn = pSs.find((r) => r.subscribedStatus === "UNSUBSCRIBED");
    const wasUn = pSsTotal && pUn ? (pUn.views / pSsTotal) * 100 : null;
    $("#aud-subscribed").innerHTML = unPct != null ? `<div class="split"><i class="a" style="width:${unPct}%">Not subscribed ${pctText(unPct)}</i><i class="b" style="width:${100 - unPct}%"></i></div>
      <p class="hint aud-under">Subscribers are ${pctText(100 - unPct)} of views${subR && unR ? ` and watch ${Math.round(Number(subR.averageViewPercentage))}% of a video; everyone else watches ${Math.round(Number(unR.averageViewPercentage))}%` : ""}.${wasUn != null ? ` In the 28 days before, subscribers were ${pctText(100 - wasUn)} of views.` : ""}</p>` : empty;

    // --- who: screen
    const dev = rows("device_type").sort((a, b) => b.views - a.views), devTotal = sum(dev);
    const tv = dev.find((r) => r.deviceType === "TV"), tvPct = tv && devTotal ? (tv.views / devTotal) * 100 : 0;
    const pDev = prevRows("device_type"), pDevTotal = sum(pDev);
    const wasDev = (k) => { if (!pDevTotal) return null; const r = pDev.find((x) => x.deviceType === k); return r ? (r.views / pDevTotal) * 100 : 0; };
    $("#aud-device").innerHTML = dev.length ? dev.map((r) => audRow(esc(DEVICE_NAMES[r.deviceType] || r.deviceType), `${chgHtml((r.views / devTotal) * 100, wasDev(r.deviceType))} <b>${pctText((r.views / devTotal) * 100)}</b>`, (r.views / devTotal) * 100, r.deviceType === "TV" ? "ink" : "info")).join("") : empty;

    // --- who: country
    const geo = rows("geography").sort((a, b) => b.views - a.views), geoTotal = sum(geo);
    const india = geo.find((r) => r.country === "IN"), abroad = geo.filter((r) => r.country !== "IN");
    const abroadPct = geoTotal ? (sum(abroad) / geoTotal) * 100 : 0;
    const GEO_LIMIT = 5;
    $("#aud-geo").innerHTML = geo.length ? geo.slice(0, GEO_LIMIT).map((r) => audRow(esc(regionName(r.country)), `<b>${pctText((r.views / geoTotal) * 100)}</b> · ${esc(minText(r.minutes, r.views))}`, (r.views / geoTotal) * 100, r.country === "IN" ? "ink" : "info")).join("")
      + (geo.length > GEO_LIMIT ? `<p class="hint aud-under">${geo.length - GEO_LIMIT} more countries make up ${pctText((sum(geo.slice(GEO_LIMIT)) / geoTotal) * 100)}.</p>` : "") : empty;
    const doWho = [];
    if (unPct != null && unPct >= 90) doWho.push(`Almost every view is from someone who has not subscribed, so the opening cannot assume they know the channel.`);
    if (f === "long" && tvPct >= 20) doWho.push(`${pctText(tvPct)} of long-form views are on a TV: keep on-screen text large.`);
    if (india && abroad.length && abroadPct >= 20) {
      const mi = india.minutes / india.views, ma = sum(abroad, "minutes") / sum(abroad);
      doWho.push(`${pctText(abroadPct)} of views are outside India${ma > mi * 1.15 ? ` and those viewers stay longer, ${ma.toFixed(1)} minutes a view against ${mi.toFixed(1)} in India` : ""}.`);
    }
    $("#aud-who-do").innerHTML = doWho.length ? `<b>Read</b> ${esc(doWho.join(" "))}` : "";

    // --- tiles
    const top = src[0];
    $("#aud-tiles").innerHTML = [
      top ? tile("Biggest source", pctText((top.views / total) * 100), `${esc(SRC_NAMES[top.insightTrafficSourceType] || top.insightTrafficSourceType)}${wasShare(top.insightTrafficSourceType) != null ? `; ${pctText(wasShare(top.insightTrafficSourceType))} in the 28 days before` : ""}`) : "",
      unPct != null ? tile("Not subscribed", pctText(unPct), `of ${esc(fname)} views${wasUn != null ? `; ${pctText(wasUn)} in the 28 days before` : ""}`) : "",
      topGroup ? tile("Largest group", pctText(Number(topGroup.viewerPercentage)), `${topGroup.gender === "male" ? "men" : topGroup.gender === "female" ? "women" : "viewers"} aged ${esc(String(topGroup.ageGroup).replace("age", "").replace("-", " to "))}; men are ${pctText(men)} in all`) : "",
      geoTotal ? tile("Outside India", pctText(abroadPct), abroad[0] ? `${esc(regionName(abroad[0].country))} leads with ${pctText((abroad[0].views / geoTotal) * 100)}` : "") : "",
    ].join("") || empty;

    // --- search terms
    const terms = rows("search_terms").sort((a, b) => b.views - a.views);
    const TERM_LIMIT = 8, termMax = Math.max(...terms.map((r) => r.views), 1);
    const termsShown = state.audSearchAll ? terms : terms.slice(0, TERM_LIMIT);
    $("#aud-search-meta").textContent = total ? `YouTube search is ${pctText(share("YT_SEARCH"))} of ${fname} views; the top ${terms.length} terms are shown` : "";
    $("#aud-search").innerHTML = termsShown.length ? termsShown.map((r) => audRow(esc(r.insightTrafficSourceDetail), `<b>${esc(fmtFull(r.views))}</b> views`, (r.views / termMax) * 100, "info",
      `https://www.youtube.com/results?search_query=${encodeURIComponent(r.insightTrafficSourceDetail)}`)).join("") : empty;
    const tAll = $("#aud-search-all"); tAll.hidden = terms.length <= TERM_LIMIT; tAll.textContent = state.audSearchAll ? "Show fewer" : `Show all ${terms.length}`;

    // --- outside and suggested (folded)
    const ext = rows("external_referrers").sort((a, b) => b.views - a.views).slice(0, 6), extMax = Math.max(...ext.map((r) => r.views), 1);
    $("#aud-external").innerHTML = ext.length ? ext.map((r) => audRow(esc(r.insightTrafficSourceDetail), `<b>${esc(fmtFull(r.views))}</b> views · ${esc(minText(r.minutes, r.views))}`, (r.views / extMax) * 100)).join("") : empty;
    const sug = rows("suggested_from").sort((a, b) => b.views - a.views).slice(0, 6), sugMax = Math.max(...sug.map((r) => r.views), 1);
    $("#aud-suggested").innerHTML = sug.length ? sug.map((r) => audRow(
      `${esc(truncate(r.title || "A video outside the watchlist", 48))}${r.title && !Number(r.is_own) ? ` <span class="hint">${esc(r.channel_title || "another channel")}</span>` : ""}`,
      `<b>${esc(fmtFull(r.views))}</b> views`, (r.views / sugMax) * 100, Number(r.is_own) ? "ink" : "info", r.video_id ? ytUrl(r.video_id) : "")).join("") : empty;
    $("#aud-more-meta").textContent = total ? `links outside YouTube are ${pctText(share("EXT_URL"))} of ${fname} views, suggested videos ${pctText(share("RELATED_VIDEO"))}` : "";
  }
  const regionNames = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
  const regionName = (code) => { try { return (regionNames && code && regionNames.of(code)) || code; } catch { return code; } };

  // ---------- Research ----------
  // The folder holds a dated copy of every report for every day. The list shows each report once, newest
  // copy first, and older copies sit behind the Version menu, so 240 files read as about 40 documents.
  const REPORTS = {
    autopsy: ["Script autopsy", "every video's script against its retention"],
    hooks: ["Hook library", "openings that worked, own and competitor"],
    ideas: ["Ideas from outliers", "what broke out for other channels"],
    copy: ["What competitors win with", "topics they have and you have not made"],
    searchgaps: ["Search gaps", "search demand nothing of yours serves"],
    evergreen: ["Library, evergreen", "old videos still earning"],
    distribution: ["Off-platform distribution", "WhatsApp, Google and other outside links"],
    titles: ["Titles and thumbnails", "patterns in what got clicked"],
    timing: ["Posting times", "when uploads do best"],
    crosspromo: ["Cross-promotion", "channels worth approaching"],
    flip: ["Flip queue", "counter-channel videos to answer"],
    species: ["Species baselines", "what each kind of Short usually does"],
    coldtest: ["Cold-test log", "how uploads did with strangers"],
    inbox: ["Comment inbox", "comments worth a reply"],
    growth: ["Growth", "where subscribers came from"],
    gsc: ["Website search", "Google impressions and clicks for itiha.info"],
    "path-to-100k": ["Path to 1 lakh", "the plan behind the goal"],
    instagram: ["Instagram report", "reels and the account"],
    iggrowth: ["Instagram growth", "what wins followers"],
    igposts: ["Instagram feed posts", "carousels and images"],
    crossplatform: ["Instagram x YouTube", "the same scripts on both"],
    "instagram-whats-working": ["Instagram, what is working", "a one-off read"],
    scriptcheck: ["Script check, all recent", "retention against script"],
  };
  const deslug = (s) => { const t = String(s).replace(/-/g, " ").replace(/ s /g, "'s ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  // A one-off's name comes from its own first heading, with the report-type prefix and quotes removed;
  // the file name is only the fallback.
  const headName = (f, fallback) => {
    const h = String(f.heading || "").replace(/^(Gate|Keyword research|Idea research|Titles and description|Post-mortem):\s*/i, "").replace(/^["“](.*)["”]$/, "$1").trim();
    return h || fallback;
  };
  function researchDocs() {
    const d = state.data.research || {};
    const map = new Map();
    const add = (group, key, title, sub, f, date) => {
      const id = `${group}:${key}`;
      if (!map.has(id)) map.set(id, { id, group, title, sub, versions: [] });
      map.get(id).versions.push({ name: f.name, date, size: f.size, mtime: f.mtime });
    };
    for (const f of d.briefs || []) {
      const n = f.name.replace(/\.md$/i, ""); let m;
      if ((m = n.match(/^(\d{4}-\d{2}-\d{2})$/))) add("Briefs", "daily", "Daily brief", "decisions and the evidence for them", f, m[1]);
      else if ((m = n.match(/^weekly-(\d{4}-\d{2}-\d{2})$/))) add("Briefs", "weekly", "Weekly roll-up", "what shipped and whether the advice was taken", f, m[1]);
      else { m = n.match(/^(.*?)-?(\d{4}-\d{2}-\d{2})$/); add("One-offs", n, headName(f, deslug(m ? m[1] : n)), "", f, m ? m[2] : String(f.mtime).slice(0, 10)); }
    }
    for (const f of d.research || []) {
      const m = f.name.replace(/\.md$/i, "").match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
      if (!m) { add("One-offs", f.name, deslug(f.name.replace(/\.md$/i, "")), "", f, String(f.mtime).slice(0, 10)); continue; }
      const [, date, rest] = m; let k;
      if (REPORTS[rest]) add("Reports", rest, REPORTS[rest][0], REPORTS[rest][1], f, date);
      else if ((k = rest.match(/^gate-(.+)$/))) add("Topic checks", k[1], headName(f, deslug(k[1])), "", f, date);
      else if ((k = rest.match(/^(idea|keyword)-(.+)$/))) add("Idea and keyword tests", rest, headName(f, deslug(k[2])), k[1] === "idea" ? "idea test" : "keyword research", f, date);
      else if ((k = rest.match(/^(scriptcheck|postmortem)-(.+)$/))) add("Post-mortems", rest, k[1] === "scriptcheck" ? (f.video_title || `Script check ${k[2]}`) : headName(f, deslug(k[2])), k[1] === "scriptcheck" ? "script check" : "post-mortem", f, date);
      else add("One-offs", rest, headName(f, deslug(rest)), "", f, date);
    }
    const docs = [...map.values()];
    for (const x of docs) { x.versions.sort((a, b) => b.date.localeCompare(a.date) || String(b.mtime).localeCompare(String(a.mtime))); x.date = x.versions[0].date; }
    return docs;
  }
  const RES_GROUPS = ["Briefs", "Reports", "Topic checks", "Idea and keyword tests", "Post-mortems", "One-offs"];
  async function loadResearch() {
    state.data.research = await api("/api/research");
    state.resDocs = researchDocs();
    state.resOpen = {};
    $("#res-filter").addEventListener("input", (e) => { state.resFilter = e.target.value.trim().toLowerCase(); renderResearchList(); });
    $("#res-files").addEventListener("click", (e) => {
      const more = e.target.closest("button[data-more]");
      if (more) { state.resOpen[more.dataset.more] = !state.resOpen[more.dataset.more]; renderResearchList(); return; }
      const b = e.target.closest("button[data-doc]"); if (b) openResearch(b.dataset.doc);
    });
    $("#res-ver").addEventListener("change", (e) => openResearch(state.resCurrent, e.target.value));
    $("#res-toc-list").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-h]"); if (!b) return;
      const h = $$("#res-doc h2")[Number(b.dataset.h)]; if (h) h.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    renderResearch();
    const first = state.resDocs.find((x) => x.id === "Briefs:daily") || state.resDocs[0];
    if (first) openResearch(first.id);
    else $("#res-doc").innerHTML = `<p class="empty">No briefs or reports written yet. They appear after the first refresh.</p>`;
  }
  function renderResearch() { if (state.resDocs) renderResearchList(); }
  function renderResearchList() {
    const q = state.resFilter || "", LIMIT = 6;
    const today = new Date().toISOString().slice(0, 10);
    const old = (date) => (Date.parse(today) - Date.parse(date)) / 864e5 > 14;
    $("#res-files").innerHTML = RES_GROUPS.map((g) => {
      let list = state.resDocs.filter((x) => x.group === g && (!q || `${x.title} ${x.sub}`.toLowerCase().includes(q)));
      if (!list.length) return "";
      const order = Object.keys(REPORTS), pos = (x) => { const i = order.indexOf(x.id.split(":")[1]); return i < 0 ? 99 : i; };
      list.sort((a, b) => (g === "Reports" ? pos(a) - pos(b) : g === "Briefs" ? 0 : b.date.localeCompare(a.date)));
      const all = q || state.resOpen[g] || list.length <= LIMIT + 1;
      const shown = all ? list : list.slice(0, LIMIT);
      return `<h3>${esc(g)} <span>${list.length}</span></h3>` + shown.map((x) => `<button type="button" data-doc="${esc(x.id)}" class="${x.id === state.resCurrent ? "active" : ""}">
        <span class="res-name">${esc(x.title)}</span>
        <span class="when">${x.sub ? `${esc(x.sub)} · ` : ""}<i class="${old(x.date) ? "stale" : ""}">${esc(fmtDay(x.date))}</i>${x.versions.length > 1 ? ` · ${x.versions.length} versions` : ""}</span></button>`).join("")
        + (q || list.length <= LIMIT + 1 ? "" : `<button type="button" class="res-more" data-more="${esc(g)}">${state.resOpen[g] ? "Show fewer" : `Show all ${list.length}`}</button>`);
    }).join("") || `<p class="hint res-none">Nothing matches “${esc(q)}”.</p>`;
  }
  async function openResearch(id, name) {
    const x = (state.resDocs || []).find((d) => d.id === id); if (!x) return;
    const v = x.versions.find((w) => w.name === name) || x.versions[0];
    state.resCurrent = id;
    $$("#res-files button[data-doc]").forEach((b) => b.classList.toggle("active", b.dataset.doc === id));
    $("#res-head").hidden = false;
    $("#res-title").textContent = x.title;
    $("#res-sub").textContent = `${fmtDay(v.date)}${v !== x.versions[0] ? ", an older version" : ""} · ${v.size > 1e6 ? (v.size / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(v.size / 1024)) + " KB"}`;
    $("#res-ver-wrap").hidden = x.versions.length < 2;
    $("#res-ver").innerHTML = x.versions.map((w, i) => `<option value="${esc(w.name)}" ${w === v ? "selected" : ""}>${esc(fmtDay(w.date))}${i === 0 ? " (newest)" : ""}</option>`).join("");
    const doc = $("#res-doc"), toc = $("#res-toc");
    toc.hidden = true; toc.open = false;
    doc.innerHTML = `<p class="empty">Loading…</p>`;
    try {
      const r = await api(`/api/research/file?name=${encodeURIComponent(v.name)}`);
      if (state.resCurrent !== id) return;
      doc.innerHTML = typeof marked !== "undefined" ? marked.parse(r.markdown || "") : `<pre>${esc(r.markdown)}</pre>`;
      doc.querySelectorAll("a[href]").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
      doc.querySelectorAll("table").forEach((t) => { const w = document.createElement("div"); w.className = "table-wrap"; t.replaceWith(w); w.appendChild(t); });
      const hs = $$("#res-doc h2");
      if (hs.length >= 3) {
        toc.hidden = false;
        $("#res-toc-sum").textContent = `Jump to a section (${hs.length})`;
        $("#res-toc-list").innerHTML = hs.slice(0, 60).map((h, i) => `<button type="button" class="chip-btn" data-h="${i}">${esc(truncate(h.textContent, 48))}</button>`).join("");
      }
      doc.scrollTop = 0;
    } catch (e) { doc.innerHTML = `<p class="error">Could not load ${esc(v.name)}: ${esc(e.message)}</p>`; }
  }

  // ---------- Instagram ----------
  // A separate surface, not a YouTube input: every number rendered here stays here. Feed posts are judged
  // by followers won, never by reach, and reels by the skip gate, because Instagram reports no follows on reels.
  async function loadInstagram() {
    const [data, reco] = await Promise.all([
      api("/api/instagram"),
      api("/api/instagram/recommendations").catch((e) => ({ items: [], error: e.message || String(e) })),
    ]);
    state.data.instagram = data;
    state.data.igReco = reco;
    $$("#ig-posts th[data-key]").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.igSort.key === key) state.igSort.asc = !state.igSort.asc;
      else state.igSort = { key, asc: key === "opening" || key === "date" };
      renderIgPosts();
    }));
    $("#ig-do-all").addEventListener("click", () => { state.igDoAll = !state.igDoAll; renderIgDo(); });
    $("#ig-reel-view").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-view]"); if (!b) return;
      state.igReelView = b.dataset.view;
      $$("#ig-reel-view button").forEach((x) => x.classList.toggle("active", x === b));
      renderIgReels();
    });
    $("#ig-skip-fold").addEventListener("toggle", (e) => { if (e.target.open) renderIgSkip(); });
    renderInstagram();
  }
  function renderInstagram() {
    renderIgHeader(); renderIgDo(); renderIgGrowth(); renderIgReels(); renderIgCands(); renderIgPosts(); renderIgTrap();
    if ($("#ig-skip-fold").open) renderIgSkip();
  }
  const igTile = (label, big, small, cls = "") => `<div class="tstat ${cls}"><div class="tlabel">${esc(label)}</div><div class="tbig">${big}</div><div class="tsmall">${small}</div></div>`;

  function renderIgHeader() {
    const d = state.data.instagram || {};
    const a = d.account || {}, g = d.growth || {}, og = g.observed_growth || null, s = d.reel_stats || {};
    const best = (g.cells || []).filter((c) => !c.thin).sort((x, y) => y.median_follows - x.median_follows)[0];
    const rest = best ? (g.cells || []).filter((c) => !c.thin && c !== best).sort((x, y) => y.median_follows - x.median_follows)[0] : null;
    $("#ig-tiles").innerHTML = [
      igTile("Followers", esc(fmtFull(a.followers)), `${a.username ? `@${esc(a.username)}` : ""}${a.fetched_at ? `, read ${esc(ago(a.fetched_at))}` : ""}`),
      og ? igTile("Growing", `+${esc(fmtFull(Math.round(og.per_day)))} a day`, `over the last ${esc(og.days)} days; ${esc(og.attributed_share_pct)}% traced to feed posts`, og.per_day > 0 ? "good" : "bad") : "",
      best ? igTile("Best kind of post", `${esc(fmtFull(Math.round(best.median_follows)))} followers`, `a typical ${esc(best.label.replace(/^Carousel, /, "carousel, "))}${rest ? `; next best wins ${esc(fmtFull(Math.round(rest.median_follows)))}` : ""}`) : "",
      s.rated ? igTile("Reels past the gate", `${esc(s.pass_gate)} of ${esc(s.rated)}`, `open under ${esc(s.gate_pct)}% skip; the median reel loses ${esc(s.median_skip_pct)}%`, s.pass_gate / s.rated < 0.5 ? "warn" : "good") : "",
    ].join("");
  }

  function renderIgDo() {
    const r = state.data.igReco || {};
    const body = $("#ig-do-body"), all = $("#ig-do-all");
    const items = r.items || [];
    if (!items.length) {
      body.innerHTML = `<div class="empty">${esc(r.error || "No Instagram posts with insights yet. Run a refresh.")}</div>`; all.hidden = true;
      return;
    }
    const LIMIT = 3, max = Math.max(...items.map((x) => Number(x.at_stake) || 0), 1);
    $("#ig-do-meta").textContent = r.source === "ig_growth" ? "ordered by followers a month at stake at the current pace of posting" : "";
    const shown = state.igDoAll ? items : items.slice(0, LIMIT);
    body.innerHTML = shown.map((it) => {
      const less = it.verdict === "DO LESS", at = Number(it.at_stake) || 0;
      return `<div class="ig-move ${less ? "less" : "more"}">
        <div class="vtop"><span class="pill ${less ? "less" : "more"}">${less ? "Stop" : "Do more"}</span>${it.confidence ? `<span class="hint">${esc(it.confidence)} evidence${it.n ? `, ${esc(it.n)} posts` : ""}</span>` : ""}</div>
        <div class="vtitle">${esc(unmd(it.do))}</div>
        ${at ? `<div class="ig-stake"><b>+${esc(fmtFull(at))}</b> followers a month</div>${hbarHtml((at / max) * 100, less ? "bad" : "good")}` : `<div class="ig-stake small">${esc(unmd(it.number))}</div>`}
        <details class="ig-why"><summary>Why</summary><p>${esc(unmd(it.why))}</p></details>
      </div>`;
    }).join("");
    all.hidden = items.length <= LIMIT;
    all.textContent = state.igDoAll ? "Show the top three" : `Show all ${items.length}`;
  }

  function renderIgGrowth() {
    const d = state.data.instagram || {}, g = d.growth || {}, r = state.data.igReco || {};
    const empty = `<div class="empty">No feed posts with insights yet</div>`;
    const months = (g.follows_by_month || []).slice().reverse();
    const mMax = Math.max(...months.map((m) => m.follows), 1);
    const mName = (m) => { const dt = new Date(`${m}-15T12:00:00`); return Number.isNaN(dt.getTime()) ? m : dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };
    $("#ig-months").innerHTML = months.length ? months.map((m) => audRow(esc(mName(m.month)),
      `<b>${esc(fmtFull(m.follows))}</b> followers · ${esc(m.posts)} posts · ${esc(Number(m.per_1k).toFixed(1))} per 1,000 reached${m.mature ? "" : " · still counting"}`,
      (m.follows / mMax) * 100, m.mature ? "info" : "muted")).join("") : empty;
    $("#ig-months-meta").textContent = d.conversion && d.conversion.total_follows != null ? `${fmtFull(d.conversion.total_follows)} followers traced to carousels and images so far` : "";

    const cells = g.cells || [], cMax = Math.max(...cells.map((c) => c.median_follows), 1);
    $("#ig-cells").innerHTML = cells.length ? cells.map((c) => audRow(esc(c.label),
      `<b>${esc(fmtFull(Math.round(c.median_follows)))}</b> typical · ${esc(fmtFull(Math.round(c.mean_follows)))} average · ${esc(c.n)} posts${c.thin ? " · too few to trust" : ""}`,
      (c.median_follows / cMax) * 100, c.thin ? "muted" : cells.indexOf(c) === 0 ? "ink" : "info")).join("") : empty;

    const sc = r.scenarios || g.scenarios || [], sMax = Math.max(...sc.map((x) => x.expected_follows_per_month), 1);
    $("#ig-scen").innerHTML = sc.length ? sc.map((x) => `<div class="vrow"><div class="lever-top"><span class="lever-name">${esc(x.name)}</span>
      <span class="lever-num"><b>${esc(fmtFull(Math.round(x.expected_follows_per_month)))}</b>${x.vs_current_pct ? ` · ${x.vs_current_pct > 0 ? "+" : ""}${esc(Math.round(x.vs_current_pct))}%` : " · now"}</span></div>
      ${hbarHtml((x.expected_follows_per_month / sMax) * 100, x.vs_current_pct > 0 ? "good" : "ink", (x.floor_follows_per_month / sMax) * 100, `${fmtFull(Math.round(x.floor_follows_per_month))} if no post breaks out`)}</div>`).join("") : empty;
    const cal = g.scenario_calibration;
    $("#ig-months-note").textContent = `Instagram reports follows on carousels and images and never on reels, so every figure here is a lower bound. On the mix bars the tick is what a month yields if no post breaks out.`
      + (cal && cal.ratio > 1.05 ? ` The model ran ${Math.round((cal.ratio - 1) * 100)}% low against the last ${cal.months.length} full months, so read the gaps between the bars, not their levels.` : "");
  }

  function renderIgCands() {
    const d = state.data.instagram || {};
    const rows = (((d.posts_pack || {}).reel_candidates) || []).filter((c) => !c.covered).slice(0, 4);
    const max = Math.max(...rows.map((c) => c.per1k || 0), 1);
    $("#ig-cands").innerHTML = rows.length ? rows.map((c) => audRow(esc(truncate(c.caption, 64)),
      `<b>${esc(Number(c.per1k).toFixed(1))}</b> per 1,000 · ${esc(fmtFull(c.follows))} followers · ${esc(fmt(c.reach))} reach`, (c.per1k / max) * 100, "info", c.permalink || "")).join("")
      : `<div class="empty">Every converting carousel already has a reel</div>`;
  }

  function renderIgSkip() {
    const d = state.data.instagram || {}; const t = theme();
    const s = d.reel_stats || {};
    const gate = s.gate_pct || 45, bar = s.big_reach || 20000;
    const reels = (d.reels || []).filter((r) => r.skip_rate != null && (r.reach || 0) > 0);
    $("#ig-skip-meta").textContent = s.median_skip_pct != null
      ? `${s.rated} reels, median skip ${s.median_skip_pct}%; of the ${s.over_big} above ${fmt(bar)} reach the worst was ${s.worst_skip_over_big}%`
      : "";
    if (!reels.length) { chart("ig-skip", null, { empty: true, emptyText: "No reels with a skip rate yet" }); return; }
    const pt = (r) => ({ value: [r.skip_rate, r.reach], name: r.caption, permalink: r.permalink });
    const over = reels.filter((r) => (r.reach || 0) >= bar).map(pt);
    const under = reels.filter((r) => (r.reach || 0) < bar).map(pt);
    chart("ig-skip", {
      ...baseOption(t),
      tooltip: { ...baseOption(t).tooltip, trigger: "item", formatter: (p) => `${esc(truncate(p.data.name, 60))}<br>skip ${p.value[0]}%, reach ${fmtFull(p.value[1])}` },
      legend: { ...baseOption(t).legend, top: 0, data: [`Above ${fmt(bar)} reach`, "The rest"] },
      grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
      xAxis: { type: "value", ...axisStyle(t), name: "skip rate", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 },
        axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => v + "%" }, splitLine: { show: false } },
      yAxis: valueAxis(t, { type: "log", logBase: 10, min: 100 }),
      series: [
        { name: "The rest", type: "scatter", data: under, symbolSize: 7, itemStyle: { color: t.comp, opacity: 0.55 } },
        { name: `Above ${fmt(bar)} reach`, type: "scatter", data: over, symbolSize: 10, itemStyle: { color: t.accent },
          // The gate is drawn on the winning series so its label sits on top: no reel has ever cleared the
          // reach bar from the right of this line.
          markLine: { silent: true, symbol: "none", lineStyle: { color: css("--bad"), type: "dashed", width: 1.5 },
            label: { show: true, color: t.ink2, fontSize: 11, formatter: `${gate}% gate` },
            data: [{ xAxis: gate }] },
          markArea: { silent: true, itemStyle: { color: css("--bad"), opacity: 0.06 }, data: [[{ xAxis: gate }, { xAxis: 100 }]] } },
      ],
    });
  }

  const igRate = (x) => (x === null || x === undefined ? "–" : Number(x).toFixed(1));
  function igLink(row, text) {
    return row.permalink ? `<a href="${esc(row.permalink)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
  }

  function renderIgPosts() {
    const d = state.data.instagram || {};
    const rows = (d.posts || []).slice();
    const c = d.conversion || {};
    const { key, asc } = state.igSort;
    rows.sort((a, b) => {
      const va = a[key] ?? (typeof a[key] === "string" ? "" : -Infinity), vb = b[key] ?? (typeof b[key] === "string" ? "" : -Infinity);
      const cc = typeof va === "string" ? va.localeCompare(vb) : Number(va) - Number(vb);
      return asc ? cc : -cc;
    });
    $$("#ig-posts th[data-key]").forEach((th) => { th.classList.toggle("sorted", th.dataset.key === key); th.classList.toggle("asc", th.dataset.key === key && asc); });
    $("#ig-posts-meta").textContent = rows.length ? `${rows.length} posts above 2,000 reach, the floor below which the rate is noise` : "";
    $("#ig-posts-note").textContent = c.min == null ? ""
      : `The conversion rate spans ${Number(c.min).toFixed(2)} to ${Number(c.max).toFixed(1)} follows per 1,000 reach, a ${Math.round(c.max / Math.max(c.min, 0.01))}x range, median ${c.median}. ${fmtFull(c.total_follows)} follows across all feed posts. Sorting this table by reach ranks it by noise.`;
    const tb = $("#ig-posts tbody");
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="7"><div class="empty">No rated feed posts yet. Run npm run ig -- --all.</div></td></tr>`; return; }
    const top = rows.length >= 4 ? rows.map((r) => r.per_1k).sort((a, b) => a - b)[Math.floor(0.75 * rows.length)] : Infinity;
    // 114 rows push everything below the fold, so the table opens at the top 25 and expands on request.
    const shown = state.igShowAll ? rows : rows.slice(0, 25);
    tb.innerHTML = shown.map((r) => `<tr class="${r.per_1k >= top ? "q-top" : ""}">
      <td class="num"><b>${igRate(r.per_1k)}</b></td>
      <td class="num" title="${fmtFull(r.follows)} follows">${fmtFull(r.follows)}</td>
      <td class="num hint" title="${fmtFull(r.reach)} accounts reached">${fmt(r.reach)}</td>
      <td class="num">${igRate(r.shares_per_1k)}</td>
      <td class="num">${r.cards == null ? "–" : r.cards}</td>
      <td>${esc(fmtDate(r.date))}</td>
      <td class="title">${igLink(r, truncate(r.opening, 90))}</td>
    </tr>`).join("");
    const more = $("#ig-posts-more");
    if (more) {
      more.innerHTML = rows.length > 25
        ? `<button type="button">${state.igShowAll ? `Show the top 25 only` : `Show all ${rows.length} posts`}</button>`
        : "";
      const btn = more.querySelector("button");
      if (btn) btn.addEventListener("click", () => { state.igShowAll = !state.igShowAll; renderIgPosts(); });
    }
  }

  function renderIgTrap() {
    const d = state.data.instagram || {};
    const rows = d.reach_trap || [];
    const tb = $("#ig-trap tbody");
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">No feed posts yet</div></td></tr>`; return; }
    tb.innerHTML = rows.map((r) => `<tr>
      <td class="num" title="${fmtFull(r.reach)}">${fmt(r.reach)}</td>
      <td class="num">${fmt(r.follows)}</td>
      <td class="num ${r.per_1k != null && r.per_1k < 1 ? "below" : ""}">${igRate(r.per_1k)}</td>
      <td class="num">${r.cards == null ? "–" : r.cards}</td>
      <td>${esc(fmtDate(r.date))}</td>
      <td class="title">${igLink(r, truncate(r.opening, 90))}</td>
    </tr>`).join("");
  }

  function renderIgReels() {
    const d = state.data.instagram || {};
    const s = d.reel_stats || {};
    const gate = s.gate_pct || 45, bar = s.big_reach || 20000;
    const all = (d.reels || []).slice();
    const view = state.igReelView || "latest";
    const list = (view === "biggest" ? all.sort((a, b) => (b.reach || 0) - (a.reach || 0)) : all.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))).slice(0, 6);
    const el = $("#ig-reels");
    $("#ig-reels-meta").textContent = s.rated ? `judged on the opening: under ${gate}% skipping is a pass` : "";
    if (!list.length) { el.innerHTML = `<div class="empty">No reels yet</div>`; $("#ig-reels-note").textContent = ""; return; }
    el.innerHTML = list.map((r) => {
      const pass = r.skip_rate != null && r.skip_rate < gate;
      return `<div class="ocard">
      ${r.permalink ? `<a href="${esc(r.permalink)}" target="_blank" rel="noopener">` : ""}
      ${r.thumbnail ? `<img class="reel" loading="lazy" src="${esc(r.thumbnail)}" alt="" onerror="this.className='reel-ph';this.removeAttribute('src')">` : `<div class="reel-ph"></div>`}
      ${r.permalink ? `</a>` : ""}
      <div class="body">
        <div class="vtop"><span class="vmult-s ${r.skip_rate == null ? "" : pass ? "ahead" : "behind"}">${r.skip_rate == null ? "–" : esc(Math.round(r.skip_rate)) + "%"}</span><span class="hint">${r.skip_rate == null ? "no skip rate" : pass ? "skipped · passes" : "skipped · fails"}</span></div>
        <div class="title">${igLink(r, truncate(r.caption, 60))}</div>
        <div class="stats"><span title="${fmtFull(r.reach)} reach"><b>${esc(fmt(r.reach))}</b> reach</span><span>${esc(fmtDay(r.published_at))}</span></div>
      </div>
    </div>`; }).join("");
    const big = all.filter((r) => (r.reach || 0) >= bar && r.skip_rate != null);
    const bigPass = big.filter((r) => r.skip_rate < gate).length;
    $("#ig-reels-note").textContent = big.length ? `${bigPass} of the ${big.length} reels that passed ${fmt(bar)} reach opened under the gate. The median reel reaches ${fmtFull(((d.types || []).find((t) => t.type === "Reel") || {}).median_reach || 0)}.` : "";
  }

  // ---------- Intelligence ----------
  const INTEL_EMPTY = "Run npm run library and npm run scriptcheck";
  const pct = (x) => (x === null || x === undefined || Number.isNaN(Number(x)) ? "–" : Math.round(Number(x) * 100) + "%");
  const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, "0")}`;
  const failedCount = (v) => (v.checks || []).filter((c) => c.pass === false).length;
  const intelRow = (v) => ({
    ...v,
    ret_avg: v.retention ? v.retention.avg : null,
    vs_median: v.retention && v.channelMedian ? v.retention.avg - v.channelMedian.avg : null,
    failed: failedCount(v),
    tags_str: (v.tags || []).join("/"),
  });
  const intelAll = () => [...(state.data.intel?.long || []), ...(state.data.intel?.short || [])];
  const intelFind = (id) => intelAll().find((v) => v.video_id === id);

  async function loadIntel() {
    const [intel, pipeline, reco] = await Promise.all([
      api("/api/intel"),
      api("/api/intel/pipeline").catch((e) => ({ pipeline: [], error: e.message || String(e) })),
      api("/api/intel/recommendations").catch(() => null),
    ]);
    const vd = await api("/api/verdicts").catch(() => ({ verdicts: [] }));
    state.data.verdicts = Object.fromEntries((vd.verdicts || []).map((v) => [v.video_id, v]));
    $$("#verdicts-filter .chip-btn").forEach((b) => b.addEventListener("click", () => {
      $$("#verdicts-filter .chip-btn").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      state.verdictFilter = b.dataset.v; renderVerdicts();
    }));
    $("#verdicts-body").addEventListener("click", (e) => {
      const row = e.target.closest("[data-vid]");
      if (!row || e.target.closest("a")) return;
      selectIntel(row.dataset.vid);
      $("#intel-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    state.data.intel = intel;
    state.data.pipeline = pipeline;
    state.data.reco = reco;
    $$(".intel-table").forEach((table) => {
      const kind = table.dataset.kind;
      $$("th[data-key]", table).forEach((th) => th.addEventListener("click", () => {
        const key = th.dataset.key;
        const s = state.intelSort[kind];
        if (s.key === key) s.asc = !s.asc; else state.intelSort[kind] = { key, asc: key === "title" || key === "verdict" || key === "tags_str" };
        renderIntelTable(kind);
      }));
      table.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        const tr = e.target.closest("tr[data-id]");
        if (tr) selectIntel(tr.dataset.id);
      });
    });
    $("#intel-detail").addEventListener("click", (e) => {
      const li = e.target.closest("li[data-from]");
      if (!li) return;
      const blk = $(`#intel-detail .script .blk[data-sec="${li.dataset.blk}"]`);
      if (!blk) return;
      blk.scrollIntoView({ block: "center", behavior: "smooth" });
      blk.classList.add("flash");
      setTimeout(() => blk.classList.remove("flash"), 1200);
    });
    if (!state.intelSelected) {
      // Long-form is what the channel is judged on, so the newest long-form opens first.
      const newest = (xs) => (xs || []).slice().sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0];
      const first = newest(intel.long) || newest(intelAll());
      if (first) state.intelSelected = first.video_id;
    }
    renderIntel();
    if (state.intelSelected) fetchIntelVideo(state.intelSelected);
  }
  function renderIntel() { renderMistakePicker(); renderPlaybook(); renderReco(); renderVerdicts(); renderIntelTable("long"); renderIntelTable("short"); renderIntelDetail(); renderPipeline(); }

  /**
   * The lead of the Lessons tab: what the script readings add up to. Counted from the verified verdicts only,
   * one format at a time (formats never mix): which mechanisms the videos that worked share, and which ones
   * sank the ones that failed, each with the clearest example. Small samples, so these are leads, not laws.
   */
  const MECH = { hook: "Hook", villain: "Villain", context_dump: "Context", structure: "Structure", payoff: "Payoff", stakes: "Stakes",
    lane: "Lane", peg: "News or film peg", search: "Search demand", topic: "Topic", title: "Title", length: "Length" };
  function renderPlaybook() {
    const body = $("#playbook-body");
    if (!body) return;
    const fmtKey = state.playbookFormat || "long";
    $$("#playbook-format .chip-btn").forEach((b) => {
      const on = b.dataset.f === fmtKey; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on));
      b.onclick = () => { state.playbookFormat = b.dataset.f; renderPlaybook(); };
    });
    const all = Object.values(state.data.verdicts || {}).filter((v) => v.format === fmtKey && v.verified);
    if (!all.length) { body.innerHTML = `<div class="empty">No verified script readings for this format yet.</div>`; $("#playbook-meta").textContent = ""; return; }
    const side = (verdict, rank) => {
      const set = all.filter((v) => v.verdict === verdict);
      const byMech = new Map();
      for (const v of set) for (const w of v.why || []) { if (!byMech.has(w.mechanism)) byMech.set(w.mechanism, []); byMech.get(w.mechanism).push({ v, w }); }
      const top = [...byMech.entries()].map(([m, xs]) => ({ m, n: new Set(xs.map((x) => x.v.video_id)).size, best: xs.slice().sort((a, b) => rank(b.v) - rank(a.v))[0] }))
        .sort((a, b) => b.n - a.n).slice(0, 4);
      return { n: set.length, top };
    };
    const won = side("worked", (v) => v.net_subs || 0), lost = side("failed", (v) => v.views || 0);
    $("#playbook-meta").textContent = `${all.length} ${fmtKey === "long" ? "long-form" : "Shorts"} scripts read: ${won.n} worked, ${lost.n} failed. Leads, not laws.`;
    const fixShown = new Set(); // one video can lead several rows; its fix is printed once
    const item = (x, total, withFix) => { const fix = withFix && x.best.v.fix && !fixShown.has(x.best.v.video_id) && fixShown.add(x.best.v.video_id) ? x.best.v.fix : ""; return `<li>
        <div class="pb-what">${esc(MECH[x.m] || x.m.replace(/_/g, " "))} <span class="hint">in ${x.n} of ${total}</span></div>
        <div class="pb-claim">${esc(x.best.w.claim)}</div>
        <div class="hint">“${esc(truncate(x.best.v.title, 70))}”</div>${fix ? `<div class="pb-fix"><b>Fix</b> ${esc(fix)}</div>` : ""}
      </li>`; };
    const col = (title, cls, s2, withFix) => `<div class="pb-col ${cls}"><h3 class="sub ${cls}">${title}</h3>${s2.top.length ? `<ul class="plain">${s2.top.map((x) => item(x, s2.n, withFix)).join("")}</ul>` : `<p class="hint">none read yet</p>`}</div>`;
    body.innerHTML = col("Do this: what the ones that worked share", "good", won, false) + col("Avoid this: what sank the ones that failed", "bad", lost, true);
  }

  const VERDICT_PILL = { worked: "pass", partly: "check", failed: "fail" };

  // ---------- mistakes, video by video ----------
  const clockSec = (s) => { const m = /^(\d+):(\d{2})/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  /**
   * One video's mistakes, worst first: every retention cliff with the script text under it (and the script
   * reading's diagnosis when one sits within 20 seconds of it), then every channel check the video failed.
   */
  function mistakesFor(v) {
    const vd = (state.data.verdicts || {})[v.video_id];
    const read = (vd?.cliffs || []).map((c) => ({ sec: clockSec(c.at), diagnosis: c.diagnosis }));
    const drops = (v.cliffs || []).slice().sort((a, b) => b.lostPct - a.lostPct).map((c) => {
      const near = read.filter((r) => r.sec !== null && Math.abs(r.sec - c.fromSec) <= 20).sort((a, b) => Math.abs(a.sec - c.fromSec) - Math.abs(b.sec - c.fromSec))[0];
      return { ...c, diagnosis: near?.diagnosis || "" };
    });
    const failed = (v.checks || []).filter((c) => c.pass === false);
    return { drops, failed, count: drops.length + failed.length, vd };
  }

  /** The picker card: which mistakes recur across the format, and the dropdown that chooses the video. */
  function renderMistakePicker() {
    const sel = $("#mistakes-select");
    if (!sel) return;
    const kind = state.mistakeFormat || "long";
    $$("#mistakes-format .chip-btn").forEach((b) => {
      const on = b.dataset.f === kind; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on));
      b.onclick = () => {
        state.mistakeFormat = b.dataset.f;
        const first = ((state.data.intel || {})[b.dataset.f] || []).slice().sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)))[0];
        renderMistakePicker();
        if (first) selectIntel(first.video_id, false);
      };
    });
    const rows = ((state.data.intel || {})[kind] || []).slice().sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    const label = kind === "long" ? "long-forms" : "Shorts";
    if (!rows.length) { sel.innerHTML = ""; $("#mistakes-recurring").innerHTML = `<div class="empty">${esc(INTEL_EMPTY)}</div>`; $("#mistakes-meta").textContent = ""; return; }
    const all = rows.map((v) => ({ v, m: mistakesFor(v) }));
    $("#mistakes-meta").textContent = `${rows.length} ${label} with a retention curve · ${all.reduce((n, x) => n + x.m.count, 0)} mistakes found`;
    sel.innerHTML = all.map(({ v, m }) => `<option value="${esc(v.video_id)}" ${v.video_id === state.intelSelected ? "selected" : ""}>${esc(truncate(v.title, 70))} · ${esc(fmtDate(v.published_at))} · ${m.count} mistake${m.count === 1 ? "" : "s"}</option>`).join("");
    sel.onchange = () => selectIntel(sel.value, false);
    // What recurs: the checks failed most often, and how often the biggest drop comes in the first minute.
    const byCheck = new Map();
    for (const { v, m } of all) for (const c of m.failed) { if (!byCheck.has(c.question)) byCheck.set(c.question, []); byCheck.get(c.question).push(v.title); }
    const top = [...byCheck.entries()].filter(([q]) => !/^Transcript available/.test(q)).sort((a, b) => b[1].length - a[1].length).slice(0, 4);
    const worst = all.map((x) => x.m.drops[0]).filter(Boolean);
    const mid = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
    const items = top.map(([q, titles]) => `<li title="${esc(titles.slice(0, 8).join(" · "))}"><b>${titles.length} of ${rows.length}</b> miss the rule “${esc(q)}”</li>`);
    if (worst.length) items.push(`<li><b>${mmss(mid(worst.map((c) => c.fromSec)))}</b> is where the biggest drop usually starts, costing a median <b>${mid(worst.map((c) => c.lostPct))} points</b></li>`);
    $("#mistakes-recurring").innerHTML = items.length ? `<div class="quick-head">The ones you keep making</div><ul>${items.join("")}</ul>` : "";
  }

  /** The mistakes block at the top of a video's detail: numbered, worst drop first, each with the script text and the fix. */
  function mistakesBlock(v) {
    const { drops, failed, count, vd } = mistakesFor(v);
    const drop = (c) => `<li class="mk drop" data-from="${c.fromSec}" data-blk="${blockSecFor(v, c.fromSec)}" title="Scroll the transcript to this moment">
        <div class="mk-head"><span class="pill fail">−${c.lostPct} points</span> <b>Viewers left at ${mmss(c.fromSec)}</b>${c.chapter ? ` <span class="hint">${esc(c.chapter)}</span>` : ""}</div>
        <blockquote class="mk-quote">“${esc(truncate(c.text, 300))}”</blockquote>
        ${c.diagnosis ? `<div class="mk-why"><b>Why</b> ${esc(c.diagnosis)}</div>` : ""}
      </li>`;
    const check = (c) => `<li class="mk">
        <div class="mk-head"><span class="pill check">rule missed</span> <b>${esc(c.question)}</b></div>
        ${c.evidence ? `<blockquote class="mk-quote">${esc(truncate(c.evidence, 300))}</blockquote>` : ""}
      </li>`;
    return `<div class="mistakes">
      <h3>${count ? `${count} mistake${count === 1 ? "" : "s"} in this video` : "No mistakes found in this video"}${vd ? ` <span class="pill ${VERDICT_PILL[vd.verdict] || "check"}">${esc(vd.verdict)}</span>` : ""}</h3>
      ${vd ? `<p class="mk-verdict">${esc(vd.headline)}${vd.verified ? "" : ` <span class="hint">(reading has an unverified quote or number)</span>`}</p>` : `<p class="hint">No script reading for this video yet; the drops and checks below come straight from the retention curve.</p>`}
      ${count ? `<ol>${drops.map(drop).join("")}${failed.map(check).join("")}</ol>` : ""}
      ${vd?.fix ? `<div class="mk-fix"><b>Fix</b> ${esc(vd.fix)}</div>` : ""}
      ${vd?.lesson ? `<div class="mk-fix"><b>Lesson</b> ${esc(vd.lesson)}</div>` : ""}
      ${vd?.why?.length ? `<details class="reco-more"><summary>The full reading: ${vd.why.length} points</summary><ul class="plain tech">${vd.why.map((w) => `<li><strong>${esc(MECH[w.mechanism] || w.mechanism.replace(/_/g, " "))}:</strong> ${esc(w.claim)}<div class="hint">${esc(w.evidence)}</div></li>`).join("")}</ul></details>` : ""}
    </div>`;
  }
  function renderVerdicts() {
    const all = Object.values(state.data.verdicts || {});
    const body = $("#verdicts-body");
    if (!all.length) return;
    const f = state.verdictFilter || "all";
    const rows = all.filter((v) => f === "all" || v.format === f || v.verdict === f);
    const n = (k) => all.filter((v) => v.verdict === k).length;
    $("#verdicts-meta").textContent = `${all.length} read: ${n("worked")} worked, ${n("partly")} partly, ${n("failed")} failed; ${all.filter((v) => !v.verified).length} with an unverified quote or number`;
    body.innerHTML = `<div class="table-wrap"><table class="data verdicts"><thead><tr><th>Verdict</th><th>Video</th><th class="num">Lifetime views</th><th class="num">Net subs</th><th>Why</th><th>Lesson</th></tr></thead><tbody>${
      rows.map((v) => `<tr data-vid="${esc(v.video_id)}" tabindex="0" title="Show retention curve and full reading">
        <td><span class="pill ${VERDICT_PILL[v.verdict] || "check"}">${esc(v.verdict)}</span>${v.verified ? "" : ` <span class="hint" title="${esc(v.problems.join("; "))}">unverified</span>`}</td>
        <td><strong>${esc(v.title)}</strong><div class="hint">${v.format === "long" ? "long-form" : "Short"}${v.failure_type ? ` · ${esc(v.failure_type)}` : ""}</div></td>
        <td class="num">${fmt(v.views)}</td><td class="num">${fmt(v.net_subs)}</td>
        <td>${esc(v.headline)}</td><td>${esc(v.lesson)}</td></tr>`).join("")
    }</tbody></table></div>`;
  }

  function verdictBlock(id) {
    const v = (state.data.verdicts || {})[id];
    if (!v) return "";
    return `<div class="verdict-detail">
      <h3><span class="pill ${VERDICT_PILL[v.verdict] || "check"}">${esc(v.verdict)}</span> ${esc(v.headline)}</h3>
      <ul>${v.why.map((w) => `<li><strong>${esc(w.mechanism.replace(/_/g, " "))}:</strong> ${esc(w.claim)}<div class="hint">${esc(w.evidence)}</div></li>`).join("")}</ul>
      ${v.cliffs.length ? `<p><strong>Where viewers left</strong></p><ul>${v.cliffs.map((c) => `<li>${esc(c.at)}, -${esc(c.lost_pts)} pts: "${esc(c.quote)}"<div class="hint">${esc(c.diagnosis)}</div></li>`).join("")}</ul>` : ""}
      <p><strong>Fix:</strong> ${esc(v.fix)}</p>
      <p><strong>Lesson:</strong> ${esc(v.lesson)}</p>
      ${v.brain_card_note ? `<p class="hint">Against the brain card (${esc(v.brain_card)}): ${esc(v.brain_card_note)}</p>` : ""}
      ${v.verified ? "" : `<p class="hint">Unverified: ${esc(v.problems.join("; "))}</p>`}
    </div>`;
  }

  function renderReco() {
    const r = state.data.reco;
    // The "make this next" and techniques cards moved to Today (decisions and evidence); only the raw signals remain here.
    const body = $("#intel-reco-body"), tech = $("#intel-techniques"), news = $("#intel-news");
    if (!r) return;
    if (body && tech) renderRecoCards(r, body, tech);
    renderRawSignals(r, news);
  }
  function renderRecoCards(r, body, tech) {
    if (!r.brief_date) { body.innerHTML = `<div class="empty">No brief yet. Run npm run daily, then /brief in Claude Code.</div>`; return; }
    $("#intel-reco-meta").textContent = `from the ${fmtDate(r.brief_date)} brief${r.trends_generated_at ? `, trends ${fmtDateTime(r.trends_generated_at)}` : ""}`;
    const card = (t, i) => `<div class="reco ${esc(t.urgency)}">
        <div class="reco-head"><span class="reco-n">${i + 1}</span><span class="pill ${t.urgency === "today" ? "fail" : t.urgency === "this_week" ? "pass" : "check"}">${esc(t.urgency.replace("_", " "))}</span><span class="pill check">${esc(t.format)}</span><span class="hint">voltage ${t.voltage_score}/5</span></div>
        <div class="reco-topic">${esc(t.topic)}</div>
        <div class="reco-make"><strong>Make:</strong> ${esc(t.recommendation)}</div>
        <div class="hint">Signal: ${esc(t.signal)}</div></div>`;
    body.innerHTML = `${r.headline ? `<p class="reco-headline">${esc(r.headline)}</p>` : ""}
      <div class="reco-grid">${(r.top3 || []).map(card).join("") || `<div class="empty">No trending items in the brief.</div>`}</div>
      ${r.more?.length ? `<details class="reco-more"><summary>${r.more.length} more from the brief</summary><ul class="plain">${r.more.map((t) => `<li><span class="pill check">${esc(t.urgency.replace("_", " "))}</span> <strong>${esc(t.topic)}</strong>: ${esc(t.recommendation)}</li>`).join("")}</ul></details>` : ""}
      ${r.skipped?.length ? `<details class="reco-more"><summary>${r.skipped.length} trending but skipped, with the reason</summary><ul class="plain">${r.skipped.map((t) => `<li><strong>${esc(t.topic)}</strong>: ${esc(t.recommendation)}</li>`).join("")}</ul></details>` : ""}`;
    tech.innerHTML = `<h3 class="sub good">Do more of this</h3><ul class="plain tech">${(r.whats_working || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>none</li>"}</ul>
      <h3 class="sub bad">Stop or fix this</h3><ul class="plain tech">${(r.whats_wrong || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>none</li>"}</ul>
      <h3 class="sub">Actions</h3><ul class="plain tech">${(r.actions || []).map((a) => `<li><span class="pill ${a.priority === "now" ? "fail" : a.priority === "this_week" ? "pass" : "check"}">${esc(a.priority.replace("_", " "))}</span> ${esc(a.action)}</li>`).join("")}</ul>`;
  }
  function renderRawSignals(r, news) {
    if (!news) return;
    const li = (arr, f) => arr.length ? `<ul class="plain tech">${arr.map(f).join("")}</ul>` : `<p class="hint">none</p>`;
    $("#intel-news-meta").textContent = `news, releases, Wikipedia spikes and dates${r.trends_generated_at ? `, run ${fmtDateTime(r.trends_generated_at)}` : ""}`;
    news.innerHTML = `<h3 class="sub">Film and series releases</h3>${li(r.releases || [], (n) => `<li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)} <span class="hint">${esc(n.source || "")}</span></li>`)}
      <h3 class="sub">Controversies and discoveries</h3>${li(r.news || [], (n) => `<li><span class="pill check">${esc(n.kind || n.class || "")}</span> ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)} <span class="hint">${esc(n.source || "")}</span></li>`)}
      <h3 class="sub">Wikipedia spikes</h3>${li(r.spikes || [], (x) => `<li><strong>${esc(x.entity)}</strong> ${esc(x.lang || "")}: ${fmt(x.views_per_day_last3)}/day, ${Number(x.ratio).toFixed(1)}x its 30-day median</li>`)}
      <h3 class="sub">Anniversaries, next 14 days</h3>${li(r.anniversaries || [], (a) => `<li><span class="hint">${esc(a.date || a.day || "")}</span> ${esc(a.text || a.title || "")}${(a.entity_match || a.entities)?.length ? ` <span class="hint">[${esc((a.entity_match || a.entities).join(", "))}]</span>` : ""}</li>`)}`;
  }

  function renderIntelTable(kind) {
    const d = state.data.intel || {};
    const table = $(`#intel-${kind}`);
    const tb = $("tbody", table);
    const cols = $$("th", table).length;
    const rows = (d[kind] || []).map(intelRow);
    const { key, asc } = state.intelSort[kind];
    rows.sort((a, b) => {
      const va = a[key] ?? (typeof a[key] === "string" ? "" : -Infinity), vb = b[key] ?? (typeof b[key] === "string" ? "" : -Infinity);
      const c = typeof va === "string" ? va.localeCompare(vb) : Number(va) - Number(vb);
      return asc ? c : -c;
    });
    $$("th[data-key]", table).forEach((th) => { th.classList.toggle("sorted", th.dataset.key === key); th.classList.toggle("asc", th.dataset.key === key && asc); });
    const med = d.medians?.[kind];
    $(`#intel-${kind}-count`).textContent = rows.length ? `${rows.length} videos with retention data${med ? `, channel median ${pct(med.avg)}` : ""}` : "";
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="${cols}"><div class="empty">${esc(INTEL_EMPTY)}</div></td></tr>`; return; }
    // Newest six by default: the question on this tab is "how did the last few do", not the whole catalogue.
    const showAll = !!(state.intelAll && state.intelAll[kind]);
    const btn = $(`#intel-${kind}-all`);
    if (btn) {
      btn.hidden = rows.length <= 6;
      btn.textContent = showAll ? "Show the newest 6" : `Show all ${rows.length}`;
      btn.onclick = () => { state.intelAll = { ...(state.intelAll || {}), [kind]: !showAll }; renderIntelTable(kind); };
    }
    tb.innerHTML = (showAll ? rows : rows.slice(0, 6)).map((r) => {
      const vs = r.vs_median === null ? "–"
        : `<span class="${r.vs_median >= 0 ? "above" : "below"}">${r.vs_median >= 0 ? "above" : "below"}</span> <span class="hint">${pct(r.ret_avg)} vs ${pct(r.channelMedian.avg)}</span>`;
      return `<tr data-id="${esc(r.video_id)}" class="${r.video_id === state.intelSelected ? "selected" : ""}">
        <td class="title">${esc(truncate(r.title, 60))}<a class="ext" href="${ytUrl(r.video_id)}" target="_blank" rel="noopener" title="Open on YouTube">↗</a></td>
        <td>${esc(fmtDate(r.published_at))}</td>
        <td class="num" title="${fmtFull(r.views)}">${fmt(r.views)}</td>
        <td class="num">${pct(r.ret_avg)}</td>
        <td class="num">${vs}</td>
        <td class="num">${r.failed ? `<span class="below">${r.failed}</span>` : "0"}</td>
        ${kind === "short" ? `<td class="tags">${r.tags_str ? r.tags_str.split("/").map((t) => `<span class="badge">${esc(t)}</span>`).join(" ") : "–"}</td>` : ""}
        <td class="verdict" title="${esc(r.verdict)}">${esc(truncate(r.verdict, 70))}</td>
      </tr>`;
    }).join("");
  }

  function selectIntel(id, scroll = true) {
    state.intelSelected = id;
    // Keep the picker on the same video, switching its format when a row from the other table was clicked.
    const picked = intelFind(id);
    if (picked && picked.kind !== (state.mistakeFormat || "long")) state.mistakeFormat = picked.kind;
    renderMistakePicker();
    $$(".intel-table tbody tr[data-id]").forEach((tr) => tr.classList.toggle("selected", tr.dataset.id === id));
    renderIntelDetail();
    fetchIntelVideo(id);
    if (scroll) $("#intel-detail").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  async function fetchIntelVideo(id) {
    if (state.intelVideo[id]) { renderScript(id); return; }
    try {
      state.intelVideo[id] = await api(`/api/intel/video?id=${encodeURIComponent(id)}`);
    } catch (e) {
      state.intelVideo[id] = { error: e.message || String(e) };
    }
    if (state.intelSelected === id) renderScript(id);
  }

  function renderIntelDetail() {
    const el = $("#intel-detail");
    const v = intelFind(state.intelSelected);
    // The panel is rebuilt from scratch, so the chart instance bound to the old #intel-curve element must go first.
    charts.get("intel-curve")?.dispose(); charts.delete("intel-curve");
    if (!v) {
      el.innerHTML = `<div class="empty">${intelAll().length ? "Select a video above to see its retention curve, cliffs, and checks." : esc(INTEL_EMPTY)}</div>`;
      return;
    }
    const r = v.retention, cm = v.channelMedian;
    const cliffs = v.cliffs || [];
    const checks = v.checks || [];
    const card = v.card_why || v.card_better || v.card_title;
    const openLabel = v.kind === "long" ? "30s" : "3s";
    el.innerHTML = `
      <div class="detail-head">
        <h2><a href="${ytUrl(v.video_id)}" target="_blank" rel="noopener">${esc(v.title)}</a></h2>
        <span class="sub">${v.kind} · ${esc(fmtDate(v.published_at))} · ${mmss(v.duration_sec)} · ${fmtFull(v.views)} views${v.avg_view_pct != null ? ` · ${Number(v.avg_view_pct).toFixed(0)}% avg viewed` : ""}${v.subs_net != null ? ` · ${v.subs_net >= 0 ? "+" : ""}${fmt(v.subs_net)} subs` : ""}${v.rel ? ` · ${Number(v.rel).toFixed(1)}x its month` : ""}</span>
      </div>
      ${mistakesBlock(v)}
      <h3 class="mk-sub">Retention curve</h3>
      <div class="chart tall" id="intel-curve"></div>
      ${r ? `<div class="ret-summary">
        <span>${openLabel} <b>${pct(r.at30s)}</b>${cm ? ` <span class="hint">(${pct(cm.at30s)})</span>` : ""}</span>
        <span>25% <b>${pct(r.at25)}</b>${cm ? ` <span class="hint">(${pct(cm.at25)})</span>` : ""}</span>
        <span>50% <b>${pct(r.at50)}</b>${cm ? ` <span class="hint">(${pct(cm.at50)})</span>` : ""}</span>
        <span>75% <b>${pct(r.at75)}</b>${cm ? ` <span class="hint">(${pct(cm.at75)})</span>` : ""}</span>
        <span>end <b>${pct(r.end)}</b></span>
        <span>average <b>${pct(r.avg)}</b>${cm ? ` <span class="hint">(channel ${pct(cm.avg)})</span>` : ""}</span>
        <span>relative <b>${Number(r.relativeAvg).toFixed(2)}</b></span>
      </div>` : ""}
      <div class="verdict-box">${esc(v.verdict)}</div>
      <div class="intel-detail ${v.kind === "long" ? "" : "single"}">
        <div>
          ${checks.some((c) => c.pass === true) ? `<h3>What it got right</h3>
          <ul class="checks">${checks.filter((c) => c.pass === true).map((c) => `<li><span class="pill pass">PASS</span><div><div class="q">${esc(c.question)}</div><div class="ev">${esc(c.evidence)}</div></div></li>`).join("")}</ul>` : ""}
          ${v.hook || v.ending ? `<h3>Hook and ending</h3>` : ""}
          ${v.hook ? `<blockquote class="quote"><span class="lbl">Hook</span>${esc(v.hook)}</blockquote>` : ""}
          ${v.ending ? `<blockquote class="quote"><span class="lbl">Ending</span>${esc(v.ending)}</blockquote>` : ""}
          ${card ? `<h3>Brain card</h3><div class="brain">
            ${v.card_why ? `<p><span class="lbl">Why</span>${esc(v.card_why)}</p>` : ""}
            ${v.card_better ? `<p><span class="lbl">Better</span>${esc(v.card_better)}</p>` : ""}
            ${v.card_title ? `<p><span class="lbl">Title proposal</span>${esc(v.card_title)}</p>` : ""}
          </div>` : ""}
        </div>
        ${v.kind === "long" ? `<div><h3>Transcript <span class="hint">cliff windows highlighted</span></h3><div class="script" id="intel-script"><div class="empty">Loading…</div></div></div>` : ""}
      </div>`;
    renderIntelCurve(v);
    if (state.intelVideo[v.video_id]) renderScript(v.video_id);
  }

  function blockSecFor(v, sec) {
    const blocks = state.intelVideo[v.video_id]?.script?.blocks || [];
    let best = null;
    for (const b of blocks) if (b.sec <= sec) best = b.sec; else break;
    return best ?? "";
  }

  function renderIntelCurve(v) {
    const t = theme();
    const curve = v.curve || [];
    if (!curve.length) { chart("intel-curve", null, { empty: true, emptyText: "No retention curve yet (Analytics lags 2 to 3 days)" }); return; }
    const medCurve = state.data.intel?.median_curves?.[v.kind] || [];
    const cliffs = v.cliffs || [];
    const bandFor = (x) => cliffs.find((c) => x >= c.fromRatio * 100 - 0.5 && x <= c.toRatio * 100 + 0.5);
    const series = [
      { name: "This video", type: "line", showSymbol: false, data: curve.map((p) => [Math.round(p.ratio * 100), Number(p.watchRatio.toFixed(3))]),
        lineStyle: { width: 2.5, color: t.accent }, itemStyle: { color: t.accent }, color: t.accent, areaStyle: { color: t.accent, opacity: 0.06 }, z: 3,
        markArea: cliffs.length ? {
          silent: true, itemStyle: { color: css("--warn"), opacity: 0.22 },
          label: { show: true, position: "insideTop", color: t.ink2, fontSize: 11, formatter: (p) => p.name },
          data: cliffs.map((c) => [{ name: `−${c.lostPct}`, xAxis: Math.round(c.fromRatio * 100) }, { xAxis: Math.round(c.toRatio * 100) }]),
        } : undefined },
    ];
    if (medCurve.length) series.push({ name: "Channel median", type: "line", showSymbol: false, data: medCurve.map((p) => [Math.round(p.ratio * 100), Number(p.watchRatio.toFixed(3))]),
      lineStyle: { width: 1.5, type: "dashed", color: t.comp }, itemStyle: { color: t.comp }, color: t.comp, z: 2 });
    chart("intel-curve", {
      ...baseOption(t),
      tooltip: { ...baseOption(t).tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps) => {
          const x = ps[0].value[0];
          const band = bandFor(x);
          return `<b>${x}% of video</b> <span style="color:${t.muted}">(${esc(mmss((x / 100) * (v.duration_sec || 0)))})</span><br>`
            + ps.map((p) => `${p.marker} ${esc(p.seriesName)}: ${Math.round(p.value[1] * 100)}%`).join("<br>")
            + (band ? `<br><span style="color:${css("--bad")}">Cliff ${esc(mmss(band.fromSec))} to ${esc(mmss(band.toSec))}: lost ${band.lostPct} points</span>${band.chapter ? `<br><span style="color:${t.muted}">${esc(band.chapter)}</span>` : ""}` : "");
        } },
      legend: { ...baseOption(t).legend, top: 0, data: series.map((s) => s.name) },
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: "value", min: 0, max: 100, ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (x) => x + "%" }, splitLine: { show: false } },
      yAxis: valueAxis(t, { min: 0, axisLabel: { color: t.muted, fontSize: 11, formatter: (y) => Math.round(y * 100) + "%" } }),
      series,
    });
  }

  function renderScript(id) {
    const box = $("#intel-script");
    if (!box) return;
    const v = intelFind(id);
    const data = state.intelVideo[id];
    if (!data) { box.innerHTML = `<div class="empty">Loading…</div>`; return; }
    if (data.error) { box.innerHTML = `<div class="error">Could not load transcript: ${esc(data.error)}</div>`; return; }
    const script = data.script;
    const blocks = script?.blocks || [];
    if (!blocks.length) {
      box.innerHTML = `<div class="empty">${script?.text ? esc(script.text) : "No transcript in the script library for this video. Run npm run library."}</div>`;
      return;
    }
    const cliffs = (v && v.cliffs) || [];
    const chapters = (script.chapters || []).slice().sort((a, b) => a.sec - b.sec);
    let ci = 0;
    const html = [];
    blocks.forEach((b, i) => {
      const next = blocks[i + 1] ? blocks[i + 1].sec : (v?.duration_sec || b.sec + 30);
      while (ci < chapters.length && chapters[ci].sec <= b.sec) { html.push(`<div class="chap">${esc(mmss(chapters[ci].sec))} ${esc(chapters[ci].title)}</div>`); ci++; }
      const inCliff = cliffs.some((c) => b.sec < c.toSec && next > c.fromSec);
      html.push(`<div class="blk ${inCliff ? "cliff" : ""}" data-sec="${b.sec}"><span class="ts">${esc(mmss(b.sec))}</span><span>${esc(b.text)}</span></div>`);
    });
    box.innerHTML = html.join("");
    // Now that blocks are known, point each cliff at its block so clicking it scrolls the transcript.
    $$("#intel-detail li[data-from]").forEach((li) => { li.dataset.blk = blockSecFor(v, Number(li.dataset.from)); });
  }

  function renderPipeline() {
    const d = state.data.pipeline || {};
    const tb = $("#intel-pipeline tbody");
    const rows = (d.pipeline || []).slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    $("#intel-pipeline-count").textContent = d.error ? `could not read: ${d.error}` : rows.length ? `${rows.length} items on disk` : "unpublished shorts scripts and long-form drafts on disk";
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="4"><div class="empty">${d.error ? esc(d.error) : "No pipeline files found in the sibling repos (config/sources.json)"}</div></td></tr>`; return; }
    tb.innerHTML = rows.map((p) => `<tr>
      <td><span class="badge">${esc(p.kind)}</span></td>
      <td>${esc(p.name)}</td>
      <td>${esc(p.status)}</td>
      <td class="path">${esc(p.path)}</td>
    </tr>`).join("");
  }


  // ---------- run bar: refresh, brief, stop ----------
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), cache: "no-store" });
    let data = null;
    try { data = await r.json(); } catch { /* empty */ }
    return { ok: r.ok, status: r.status, data };
  }
  const dur = (s) => { s = Math.max(0, Math.round(s || 0)); if (s < 60) return `${s} s`; const m = Math.floor(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const hhmm = (iso) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

  const run = { status: null, timer: null, wasRunning: null, stopped: false, logOpen: false };

  async function pollStatus() {
    if (run.stopped) return;
    clearTimeout(run.timer);
    let st = null;
    try { st = await api("/api/status"); } catch { st = null; }
    run.status = st;
    if (STATIC) {
      $("#run-dot").className = "run-dot good";
      $("#run-text").textContent = `Read-only copy · data as of ${fmtDateTime((st && st.last_refresh_ok_at) || STATIC.at)} · copied ${ago(STATIC.at)}`;
      renderBriefStatus();
      return;
    }
    renderRunBar();
    renderBriefStatus();
    const busy = !!(st && st.running);
    // A job that just ended changes what every tab shows: drop the cached tabs and reload the one on screen.
    if (run.wasRunning && !busy) onJobFinished(run.wasRunning);
    run.wasRunning = busy ? st.running.job : null;
    run.timer = setTimeout(pollStatus, busy ? 5000 : 60000);
  }

  function onJobFinished(job) {
    const current = ($(".tab.active") || {}).dataset?.tab || "brief";
    if (job === "launch") { api("/api/decisions").then((d) => { state.data.decisions = d; renderDecisions(); }).catch(() => {}); return; }
    if (job === "refresh") { Object.keys(state.loaded).forEach((k) => { if (k !== "search") state.loaded[k] = false; }); if (current !== "goal") loadGoalStrip(); }
    else state.loaded.brief = false;
    if (!state.loaded[current]) activate(current);
  }

  function renderRunBar() {
    const st = run.status;
    const text = $("#run-text"), dot = $("#run-dot");
    const bRefresh = $("#run-refresh"), bBrief = $("#run-brief"), bCancel = $("#run-cancel"), auto = $("#run-auto");
    const prog = $("#run-progress"), fill = $("#run-progress-fill");
    if (!st) {
      dot.className = "run-dot bad";
      text.textContent = "Server not reachable. Start it with the Itiha Intel icon or npm start.";
      [bRefresh, bBrief, bCancel, auto, $("#run-stop")].forEach((b) => { b.disabled = true; });
      prog.hidden = true;
      return;
    }
    [bRefresh, bBrief, auto, $("#run-stop")].forEach((b) => { b.disabled = false; });
    auto.checked = !!(st.settings && st.settings.autoBrief);
    const r = st.running;
    const other = st.other_lock;
    if (r) {
      dot.className = "run-dot busy";
      if (r.job === "refresh") {
        const p = r.progress || {};
        const idx = p.index || 0, total = p.total || (st.steps || []).length || 10;
        text.textContent = idx ? `Refreshing… step ${idx} of ${total}: ${p.step}, ${dur(r.elapsed_s)}` : `Refreshing… starting, ${dur(r.elapsed_s)}`;
        prog.hidden = false;
        fill.style.width = `${Math.max(3, Math.min(100, (Math.max(idx - 1, 0) + 0.5) / total * 100))}%`;
      } else {
        text.textContent = r.job === "launch" ? `Preparing a launch kit… ${dur(r.elapsed_s)} (Claude Code is drafting it)` : `Writing brief… ${dur(r.elapsed_s)} (Claude Code is reading the pack)`;
        prog.hidden = false;
        fill.style.width = "100%";
        fill.classList.add("indeterminate");
      }
      if (r.job === "refresh") fill.classList.remove("indeterminate");
      bRefresh.disabled = true; bBrief.disabled = true;
      bRefresh.textContent = r.job === "refresh" ? "Refreshing…" : "Refresh now";
      bBrief.textContent = r.job === "brief" ? "Writing brief…" : "Write brief now";
      bCancel.hidden = false;
    } else {
      prog.hidden = true;
      bCancel.hidden = true;
      bRefresh.textContent = "Refresh now";
      if (other) {
        dot.className = "run-dot busy";
        text.textContent = `Another process (pid ${other.pid}) is running ${other.job}, started ${ago(other.started_at)}.`;
        bRefresh.disabled = true; bBrief.disabled = true;
      } else {
        const at = st.last_refresh_ok_at;
        const h = at ? (Date.now() - Date.parse(at)) / 36e5 : null;
        const lr = st.last_refresh;
        const failed = lr && lr.ok === false && (!at || Date.parse(lr.started_at) > Date.parse(at));
        dot.className = `run-dot ${failed ? "bad" : h === null || h > (st.auto?.stale_hours || 6) ? "warn" : "good"}`;
        text.textContent = [
          at ? `Data refreshed ${ago(at)}` : "Data never refreshed",
          failed ? `last refresh ${lr.cancelled ? "cancelled" : "failed"} ${ago(lr.finished_at || lr.started_at)}, see Log` : null,
          st.last_brief && st.last_brief.ok === false && !st.brief_today?.exists ? `brief ${st.last_brief.cancelled ? "cancelled" : "failed"}${st.last_brief.reason ? ` (${st.last_brief.reason})` : ""}, see Log` : null,
        ].filter(Boolean).join(" · ");
        text.title = at ? `Last successful refresh ${fmtDateTime(at)}${st.auto?.enabled ? `. Auto mode: ${st.auto.last_decision || ""}` : ""}` : "";
      }
      bBrief.textContent = st.brief_today && st.brief_today.exists ? `Brief written ${hhmm(st.brief_today.written_at)}` : "Write brief now";
      bBrief.title = st.brief_today && st.brief_today.exists ? "Today's brief exists. Click to write it again from the newest data." : "Run /brief in Claude Code headless and render today's brief";
    }
    const logEl = $("#run-log");
    if (run.logOpen) {
      const lines = st.tail || [];
      const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
      logEl.textContent = lines.length ? lines.join("\n") : "No job has run since the server started.";
      if (atBottom) logEl.scrollTop = logEl.scrollHeight;
    }
  }

  async function startJob(job) {
    if (job === "brief" && run.status?.brief_today?.exists && !confirm("Today's brief already exists. Write it again from the newest data?")) return;
    const r = await post(`/api/run/${job}`);
    if (!r.ok && r.data && r.data.reason) alert(`Not started: ${r.data.reason}`);
    pollStatus();
  }

  $("#run-refresh").addEventListener("click", () => startJob("refresh"));
  $("#run-brief").addEventListener("click", () => startJob("brief"));
  $("#run-cancel").addEventListener("click", async () => {
    const job = run.status?.running?.job || "job";
    if (!confirm(`Cancel the running ${job}?`)) return;
    await post("/api/run/cancel");
    setTimeout(pollStatus, 800);
  });
  $("#run-auto").addEventListener("change", async (e) => {
    const r = await post("/api/settings", { autoBrief: e.target.checked });
    if (!r.ok) e.target.checked = !e.target.checked;
  });
  $("#run-log-toggle").addEventListener("click", (e) => {
    run.logOpen = !run.logOpen;
    e.currentTarget.setAttribute("aria-expanded", String(run.logOpen));
    $("#run-log").hidden = !run.logOpen;
    renderRunBar();
    if (run.logOpen) $("#run-log").scrollTop = $("#run-log").scrollHeight;
  });
  $("#run-stop").addEventListener("click", async () => {
    const busy = run.status?.running;
    const msg = busy
      ? `A ${busy.job} is running (${dur(busy.elapsed_s)}). Stop it and shut down the server?`
      : "Stop the Itiha Intel server? Start it again from the Itiha Intel icon.";
    if (!confirm(msg)) return;
    const r = await post("/api/shutdown", { force: !!busy });
    if (!r.ok) { alert((r.data && r.data.error) || "The server refused to stop."); return; }
    run.stopped = true;
    clearTimeout(run.timer);
    document.body.innerHTML = `<main><div class="card stopped"><h2>Server stopped</h2><p>You can close this tab. To start again, double-click <b>Itiha Intel</b> in the project folder, or run <code>npm start</code>.</p></div></main>`;
  });

  // ---------- Brief ----------
  // Markdown from the brief is data: Claude writes it from comments and news, so raw HTML in it is shown as
  // text, and only http(s) links survive.
  let md = null;
  function renderMd(src) {
    if (typeof marked === "undefined") return `<pre>${esc(src)}</pre>`;
    if (!md) {
      const escHtml = (t) => esc(typeof t === "string" ? t : (t && (t.raw ?? t.text)) || "");
      md = typeof marked.Marked === "function" ? new marked.Marked() : marked;
      md.use({ renderer: { html: escHtml } });
    }
    const box = document.createElement("div");
    box.innerHTML = md.parse(String(src || ""));
    box.querySelectorAll("script, iframe, object, embed, style").forEach((n) => n.remove());
    box.querySelectorAll("*").forEach((n) => { [...n.attributes].forEach((a) => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); }); });
    box.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!/^(https?:|#|\/)/i.test(href)) a.removeAttribute("href");
      else if (/^https?:/i.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    });
    return box.innerHTML;
  }

  async function loadBrief() {
    api("/api/health").then((h) => { state.data.health = h; renderHealth(); }).catch(() => {});
    api("/api/week").then((w) => { state.data.week = w; renderWeek(); }).catch(() => {});
    api("/api/inbox").then((x) => { state.data.inbox = x; renderInbox(); }).catch(() => {});
    $("#inbox-all").addEventListener("click", () => { state.inboxAll = !state.inboxAll; renderInbox(); });
    const [brief, findings, recs, decisions] = await Promise.all([
      api("/api/brief/latest").catch((e) => ({ available: false, error: e.message })),
      api("/api/findings").catch(() => ({ available: false })),
      api("/api/recommendations/history").catch(() => ({ available: false })),
      api("/api/decisions").catch(() => null),
    ]);
    Object.assign(state.data, { brief, findings, recs, decisions });
    renderBrief();
  }

  /** The parts of the Brief tab that depend on the run status; redrawn on every poll without touching the brief body. */
  function renderBriefStatus() {
    const b = state.data.brief;
    if (!b) return;
    const st = run.status || {};
    const notice = $("#brief-notice");
    const fr = st.freshness && st.freshness.available !== false ? st.freshness : null;
    const freshBits = [];
    if (st.last_refresh_ok_at) freshBits.push(`Data refreshed ${ago(st.last_refresh_ok_at)} (${fmtDateTime(st.last_refresh_ok_at)})`);
    if (fr) {
      const stale = (fr.sources || []).filter((x) => x.stale).map((x) => x.name);
      if (stale.length) freshBits.push(`stale: ${stale.join(", ")}`);
      (fr.notes || []).slice(0, 2).forEach((n) => freshBits.push(n));
    }
    $("#brief-freshness").textContent = freshBits.join(" · ");
    const busy = !!(st.running && st.running.job === "brief");
    const writeBtn = busy ? "Today's brief is being written now." : `<button type="button" class="btn" data-act="write-brief">Write today's brief</button>`;
    if (!b.available) { notice.hidden = false; notice.innerHTML = `No brief has been written. ${writeBtn}`; }
    else if (b.is_today) { notice.hidden = true; notice.innerHTML = ""; }
    else { notice.hidden = false; notice.innerHTML = `This is the brief from <b>${esc(fmtDate(b.date))}</b>, not today. ${writeBtn}`; }
    $$("#brief-notice [data-act=write-brief]").forEach((btn) => btn.addEventListener("click", () => startJob("brief")));
  }

  function renderBrief() {
    const b = state.data.brief || {};
    const doc = $("#brief-doc"), unv = $("#brief-unverified");
    renderBriefStatus();
    if (!b.available) {
      $("#brief-title").textContent = "No brief yet";
      $("#brief-meta").textContent = "";
      doc.innerHTML = `<div class="empty">The brief appears here once the refresh and /brief have run.</div>`;
      unv.hidden = true;
    } else {
      $("#brief-title").textContent = b.is_today ? "What changed" : `What changed (brief of ${fmtDate(b.date)})`;
      $("#brief-meta").textContent = `written ${fmtDateTime(b.written_at)}`;
      $("#brief-headline").textContent = b.headline || "";
      // The front page is the decisions; the brief's sections are the evidence, each closed until wanted. The
      // decisions and the housekeeping list are drawn as their own blocks, so they are left out of the sections.
      const sections = String(b.markdown || "").split(/\n(?=## )/).slice(1).map((sec) => {
        const nl = sec.indexOf("\n");
        return { title: sec.slice(3, nl < 0 ? undefined : nl).trim(), body: nl < 0 ? "" : sec.slice(nl + 1).trim() };
      }).filter((x) => !/^This week:|^Numbers not backed/.test(x.title) && !(b.has_decisions && x.title === "Housekeeping"));
      const plain = (t) => t.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
      doc.innerHTML = sections.map((x) => `<details class="ev"><summary><span class="ev-title">${esc(x.title)}</span><span class="ev-peek">${esc(plain(x.body).slice(0, 130))}…</span></summary><div class="markdown">${renderMd(x.body)}</div></details>`).join("")
        || `<div class="empty">This brief has no sections.</div>`;
      const list = Array.isArray(b.unverified) ? b.unverified : [];
      unv.hidden = !list.length;
      unv.innerHTML = list.length ? `<h3>Numbers not backed by a stored fact</h3><ul>${list.map((x) => `<li>${esc(typeof x === "string" ? x : x.text || x.claim || JSON.stringify(x))}</li>`).join("")}</ul>` : "";
    }
    renderTodayStatus();
    renderHealth();
    renderDecisions();
    renderQuickTasks();
    renderFindings();
    renderRecs();
  }

  /** Three numbers at the top of Today: where the count is, whether the month is on its path, and the lever furthest behind. */
  function renderTodayStatus() {
    const g = state.data.goal, el = $("#today-status");
    if (!el || !g || !g.current) return;
    const m = g.this_month || {};
    const ahead = (m.actual_per_day_7d ?? 0) >= (m.required_per_day ?? Infinity);
    const gap = g.required_today?.gap ?? 0;
    const worst = (g.levers || []).filter((l) => l.status === "behind").sort((a, b) => (b.target_subs - b.actual_subs) - (a.target_subs - a.actual_subs))[0];
    const tile = (label, big, small, cls = "") => `<div class="tstat ${cls}"><div class="tlabel">${esc(label)}</div><div class="tbig">${big}</div><div class="tsmall">${small}</div></div>`;
    el.innerHTML = [
      tile("Subscribers", `${esc(fmtFull(g.current.subs))} <span class="of">/ ${esc(fmtFull(g.config.target))}</span>`,
        `${esc(String(g.current.days_left))} days left · ${gap > 0 ? `${esc(fmtFull(gap))} behind the path` : "on the path"}`, gap > 0 ? "warn" : "good"),
      tile("This month's pace", `${esc(perDay(g.pace.per_day_7d))} <span class="of">of ${esc(perDay(m.required_per_day))} needed</span>`,
        m.shortfall > 0 ? `on course to finish ${esc(fmtFull(m.shortfall))} short of ${esc(fmtFull(m.milestone?.required_subs))}` : `on course for ${esc(fmtFull(m.milestone?.required_subs))}`, ahead && !(m.shortfall > 0) ? "good" : "warn"),
      worst ? tile("Biggest gap", `${esc(worst.label)} <span class="of">${esc(fmtFull(worst.actual_subs))} of ${esc(fmtFull(worst.target_subs))}</span>`, esc(String(worst.closes_gap || "").split(". ").slice(1).join(". ") || worst.closes_gap || ""), "bad")
        : tile("Levers", "All on course", "no lever is behind its target this month", "good"),
    ].join("");
    el.hidden = false;
  }

  /**
   * Channel health as graphics, the same picture the health email draws: the road to the target, the daily rate
   * against what the month needs, each lever against its target, and this week against last. Every number comes
   * from /api/goal or the stored facts; long-form and Shorts are drawn on separate scales and never added together.
   */
  function renderHealth() {
    const g = state.data.goal, h = state.data.health, card = $("#health-card");
    if (!card || !g || !g.current) return;
    const m = g.this_month || {}, v = (h && h.v) || {};
    const short = m.shortfall > 0;
    const pctOf = (a, b) => Math.max(0, Math.min(100, b ? (a / b) * 100 : 0));
    const bar = (fill, cls, mark, markLabel) => `<div class="hbar"><i class="${cls}" style="width:${fill.toFixed(1)}%"></i>${mark != null ? `<u style="left:${Math.min(100, mark).toFixed(1)}%" title="${esc(markLabel || "")}"></u>` : ""}</div>`;
    // 7-day rate over time against the rate the path asks for.
    const pts = (g.daily || []).filter((d) => d.net_7d_per_day != null);
    let spark = "";
    if (pts.length > 3) {
      const W = 320, H = 64, max = Math.max(...pts.map((d) => Math.max(d.net_7d_per_day, d.required_per_day || 0)), 1) * 1.1;
      const x = (i) => (i / (pts.length - 1)) * W, y = (val) => H - (Math.max(0, val) / max) * H;
      const line = (f) => pts.map((d, i) => (f(d) == null ? null : `${x(i).toFixed(1)},${y(f(d)).toFixed(1)}`)).filter(Boolean).join(" ");
      spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Net subscribers a day, 7-day rate, against the required rate">
        <polyline class="need" points="${line((d) => d.required_per_day)}"/><polyline class="got" points="${line((d) => d.net_7d_per_day)}"/></svg>
        <div class="spark-key"><span><i class="got"></i>7-day rate since ${esc(fmtDate(pts[0].date))}</span><span><i class="need"></i>what the path asks</span></div>`;
    }
    const paceMax = Math.max(g.pace.per_day_7d, m.required_per_day || 0, 1) * 1.2;
    const levers = leverBlocks(g, false);
    const week = (label, now, prev, wow) => {
      if (now == null || prev == null) return "";
      const mx = Math.max(now, prev, 1), up = (wow ?? 0) >= 0;
      return `<div class="week"><div class="week-top"><span class="lever-name">${label}</span><span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(wow ?? 0).toFixed(1)}%</span></div>
        <div class="week-row"><span>this week</span>${bar(pctOf(now, mx), up ? "good" : "bad")}<b>${esc(fmtFull(now))}</b></div>
        <div class="week-row"><span>last week</span>${bar(pctOf(prev, mx), "muted")}<b>${esc(fmtFull(prev))}</b></div></div>`;
    };
    const ls = v["long.net_subs_28d"], ss = v["shorts.net_subs_28d"];
    const split = ls != null && ss != null && ls + ss > 0 ? `<div class="week"><div class="week-top"><span class="lever-name">Subscribers from uploads, 28 days</span></div>
        <div class="split"><i class="a" style="width:${pctOf(ls, ls + ss).toFixed(1)}%">${pctOf(ls, ls + ss) > 18 ? `long-form ${esc(fmtFull(ls))}` : ""}</i><i class="b" style="width:${pctOf(ss, ls + ss).toFixed(1)}%">${pctOf(ss, ls + ss) > 18 ? `Shorts ${esc(fmtFull(ss))}` : ""}</i></div></div>` : "";
    $("#health-meta").textContent = `Analytics through ${g.data_through || "–"}`;
    $("#health-body").innerHTML = `
      <div class="hbanner ${short ? "bad" : "good"}"><b>${short ? "Behind pace this month" : "On pace this month"}</b><span>heading for ${esc(fmtFull(m.projected_end_subs))} by month end${short ? `, ${esc(fmtFull(m.shortfall))} short of ${esc(fmtFull(m.milestone?.required_subs))}` : ""}</span></div>
      <div class="hgrid">
        <div>
          <div class="hrow"><div class="hrow-top"><span class="lever-name">Road to ${esc(fmtFull(g.config.target))}</span><span class="lever-num"><b>${esc(fmtFull(g.current.subs))}</b> · ${pctOf(g.current.subs, g.config.target).toFixed(1)}%</span></div>
            ${bar(pctOf(g.current.subs, g.config.target), "ink", pctOf(g.required_today?.subs ?? 0, g.config.target), "where the path is today")}</div>
          <div class="hrow"><div class="hrow-top"><span class="lever-name">Subscribers a day, last 7 days</span><span class="lever-num"><b>${esc(g.pace.per_day_7d.toFixed(1))}</b> of ${esc(Number(m.required_per_day ?? 0).toFixed(1))} needed</span></div>
            ${bar(pctOf(g.pace.per_day_7d, paceMax), g.pace.per_day_7d >= (m.required_per_day ?? 0) ? "good" : "bad", pctOf(m.required_per_day ?? 0, paceMax), "needed this month")}</div>
          ${spark}
          <div class="hsub">This week against last</div>
          ${week("Long-form views", v["long.views_7d"], v["long.views_prev_7d"], v["long.views_wow_pct"])}
          ${week("Shorts views", v["shorts.views_7d"], v["shorts.views_prev_7d"], v["shorts.views_wow_pct"])}
          ${split}
        </div>
        <div>
          <div class="hsub first">Growth levers this month</div>
          <p class="lever-intro">The month's subscriber target, split by where the subscribers are meant to come from. Each bar is subscribers gained so far against that source's share of the target; the black tick is where the bar should have reached by today.</p>
          ${levers}
        </div>
      </div>`;
    card.hidden = false;
  }

  /**
   * The publishing calendar: one row per platform, a dot per item, seven days back and two weeks ahead. Filled
   * dots went out, rings are due. The platforms sit side by side and are never added together.
   */
  const LANES = [["long", "Long-form"], ["short", "Shorts"], ["ig", "Instagram"], ["date", "Dates to hit"], ["task", "Tasks"]];
  const LANE_NAME = Object.fromEntries(LANES);
  function renderWeek() {
    const w = state.data.week, card = $("#week-card");
    if (!card || !w || !Array.isArray(w.days)) return;
    const items = w.items || [];
    const dOnly = (ymd, opt) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-GB", opt);
    const diff = (ymd) => Math.round((Date.parse(ymd) - Date.parse(w.today)) / 86400000);
    const lanes = LANES.filter(([k]) => k !== "task" || items.some((i) => i.lane === "task"));
    const head = `<div class="cal-lane"></div>` + w.days.map((d) => `<div class="cal-day${d === w.today ? " today" : d < w.today ? " past" : ""}"><span>${esc(dOnly(d, { weekday: "narrow" }))}</span><b>${esc(String(Number(d.slice(8))))}</b></div>`).join("");
    const dot = (i) => {
      const late = i.state === "due" && i.lane !== "date" && /overdue/.test(i.note || "");
      const tip = `${i.title}${i.note ? ` (${i.note})` : ""}`;
      const cls = `cdot ${i.state} l-${i.lane}${late ? " late" : ""}`;
      return i.url ? `<a class="${cls}" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(tip)}"></a>` : `<i class="${cls}" title="${esc(tip)}"></i>`;
    };
    const rows = lanes.map(([k, name]) => `<div class="cal-lane">${esc(name)}</div>` + w.days.map((d) => {
      const here = items.filter((i) => i.lane === k && i.date === d);
      return `<div class="cal-cell${d === w.today ? " today" : d < w.today ? " past" : ""}">${here.slice(0, 4).map(dot).join("")}${here.length > 4 ? `<span class="cal-more">+${here.length - 4}</span>` : ""}</div>`;
    }).join("")).join("");
    $("#week-grid").innerHTML = head + rows;
    $("#week-meta").textContent = `${dOnly(w.days[0], { day: "numeric", month: "short" })} to ${dOnly(w.days[w.days.length - 1], { day: "numeric", month: "short" })} · hover a dot for its title`;

    // Coming up: every due item, by date.
    const due = items.filter((i) => i.state === "due");
    const when = (i) => { const n = diff(i.date); return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`; };
    $("#week-next").innerHTML = due.length ? due.map((i) => {
      const late = /overdue/.test(i.note || "");
      return `<div class="ag-row"><div class="ag-date${late ? " late" : ""}"><b>${esc(dOnly(i.date, { day: "numeric", month: "short" }))}</b><span>${esc(late ? "overdue" : when(i))}</span></div>
        <div class="ag-main"><div class="ag-title"><span class="badge l-${i.lane}">${esc(LANE_NAME[i.lane])}</span> ${esc(i.title)}</div><div class="hint">${esc(i.note || "")}</div></div></div>`;
    }).join("") : `<div class="empty">Nothing is due in the next two weeks.</div>`;

    // Went out: a count per platform and the best of each, never a total across them.
    const out = items.filter((i) => i.state === "out");
    $("#week-out").innerHTML = ["long", "short", "ig"].map((k) => {
      const mine = out.filter((i) => i.lane === k), best = mine.slice().sort((a, b) => (b.views || 0) - (a.views || 0))[0];
      return `<div class="ag-row"><div class="ag-count"><b>${mine.length}</b><span>${esc(LANE_NAME[k])}</span></div>
        <div class="ag-main">${best ? `<div class="ag-title"><a href="${esc(best.url || "#")}" target="_blank" rel="noopener">${esc(truncate(best.title, 70))}</a></div><div class="hint">${mine.length > 1 ? "the most watched: " : ""}${esc(best.note || "")}</div>` : `<div class="hint">Nothing went out.</div>`}</div></div>`;
    }).join("");

    // Shorts scripts on disk with no date: what could fill an empty day.
    const und = Array.isArray(w.undated) ? w.undated : [], ubox = $("#week-undated");
    const sure = und.filter((u) => !u.maybe_out), ready = sure.filter((u) => u.stage !== "written");
    ubox.hidden = !und.length;
    if (und.length) {
      const STAGE = { recorded: ["Recorded", "pass"], locked: ["Script locked", "ontrack"], written: ["Written", "check"] };
      const shown = state.weekUndAll ? und : und.slice(0, 4);
      ubox.innerHTML = `<div class="hsub">Shorts on disk with no date <span class="hint">${sure.length} not out yet, ${ready.length} of them recorded or locked</span></div>
        <div class="und">${shown.map((u) => `<div class="und-row"><span class="pill ${STAGE[u.stage][1]}">${STAGE[u.stage][0]}</span> <b>${esc(u.name)}</b>${u.maybe_out ? ` <span class="hint">may already be out as “${esc(truncate(u.maybe_out, 54))}”</span>` : ""}</div>`).join("")}</div>
        ${und.length > 4 ? `<button type="button" class="btn ghost show-all" id="week-und-all">${state.weekUndAll ? "Show fewer" : `Show all ${und.length}`}</button>` : ""}`;
      const b = $("#week-und-all"); if (b) b.addEventListener("click", () => { state.weekUndAll = !state.weekUndAll; renderWeek(); });
    }
    const shortDays = new Set(items.filter((i) => i.lane === "short" && i.date > w.today).map((i) => i.date));
    const emptyAhead = w.days.filter((d) => d > w.today && !shortDays.has(d)).length;

    const read = [];
    const overdue = due.filter((i) => /overdue/.test(i.note || ""));
    if (overdue.length) read.push(`${overdue.length} decision${overdue.length === 1 ? " is" : "s are"} past due.`);
    const nextLong = due.find((i) => i.lane === "long");
    read.push(nextLong ? `The next long-form is due ${when(nextLong)}${/no launch kit/.test(nextLong.note || "") ? ", and it has no launch kit yet" : ""}.` : "No long-form is due in the next two weeks, and long-form is what the channel is judged on.");
    const noKit = due.filter((i) => i.lane !== "long" && /no launch kit/.test(i.note || "") && diff(i.date) <= 5);
    if (noKit.length) read.push(`${noKit.length} video${noKit.length === 1 ? "" : "s"} due within five days ${noKit.length === 1 ? "has" : "have"} no launch kit.`);
    if (ready.length && emptyAhead) read.push(`${shortDays.size} of the next ${w.days.filter((d) => d > w.today).length} days have a Short due; ${ready.length} recorded or locked script${ready.length === 1 ? " has" : "s have"} no date.`);
    $("#week-do").innerHTML = `<b>Read</b> ${esc(read.join(" "))}`;

    // Click-through rate comes only from a manual Studio export; say how far it runs.
    const s = w.studio, ctr = $("#week-ctr");
    if (!s) ctr.innerHTML = `<span class="pill fail">no click-through data</span> Nothing has been exported from Studio yet. Say /studio-export in Claude Code.`;
    else if (s.days_old > 10) ctr.innerHTML = `<span class="pill fail">export due</span> Click-through data stops at ${esc(fmtDay(s.through))}, ${s.days_old} days ago. Say /studio-export in Claude Code to load the newer days.`;
    else ctr.textContent = `Click-through data runs to ${fmtDay(s.through)} (loaded ${ago(s.imported_at)}). It only arrives from a Studio export.`;
    card.hidden = false;
    // On a narrow screen the grid scrolls sideways; start it at today, not a week back.
    const wrap = $(".cal-wrap", card), tday = $(".cal-day.today", card);
    if (wrap && tday && wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = Math.max(0, tday.offsetLeft - 112);
  }

  /** The comments worth an answer, three at a time. Done records the comment as handled so it stops coming back. */
  const INBOX_KIND = { correction: ["Correction", "fail"], question: ["Question", "ontrack"], request: ["Request", "pass"], objection: ["Objection", "fail"], testimony: ["Their story", "check"] };
  function renderInbox() {
    const x = state.data.inbox, card = $("#inbox-card");
    if (!card || !x || !x.available) return;
    const items = x.items || [];
    card.hidden = !items.length;
    if (!items.length) return;
    const c = x.counts || {};
    const bits = [["correction", "corrections"], ["question", "questions"], ["request", "requests"], ["objection", "objections"]].filter(([k]) => c[k]).map(([k, n]) => `${c[k]} ${n}`);
    $("#inbox-meta").textContent = `last ${x.days} days on your own videos: ${bits.join(", ")}`;
    const LIMIT = 3, shown = state.inboxAll ? items : items.slice(0, LIMIT);
    $("#inbox-list").innerHTML = shown.map((i) => {
      const [label, cls] = INBOX_KIND[i.kind] || [i.kind, "check"];
      return `<div class="cm-row" data-id="${esc(i.id)}">
        <div class="cm-main"><div class="cm-text"><span class="pill ${cls}">${esc(label)}</span> ${esc(i.text)}</div>
          <div class="hint">${esc(i.author)}${i.superfan ? " · regular commenter" : ""}${i.likes ? ` · ${esc(fmtFull(i.likes))} likes` : ""} · ${esc(ago(i.at))} · on “${esc(truncate(i.video_title, 60))}”</div></div>
        <div class="dbtns"><a class="btn" href="${esc(ytUrl(i.video_id))}&lc=${encodeURIComponent(i.id)}" target="_blank" rel="noopener">Reply</a><button type="button" class="btn ghost" data-done>Done</button></div></div>`;
    }).join("");
    const all = $("#inbox-all"); all.hidden = items.length <= LIMIT; all.textContent = state.inboxAll ? "Show fewer" : `Show ${items.length}${x.total > items.length ? ` of ${x.total}` : ""}`;
    $$("#inbox-list button[data-done]").forEach((btn) => btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await post("/api/inbox/handled", { id: btn.closest(".cm-row").dataset.id });
      if (!r.ok) { alert("Could not save"); btn.disabled = false; return; }
      state.data.inbox = r.data; renderInbox();
    }));
  }

  /** Housekeeping from the brief: small tasks that are not worth a decision slot. A plain list, no state. */
  function renderQuickTasks() {
    const b = state.data.brief || {}, el = $("#quick-tasks");
    const tasks = b.available && b.has_decisions && Array.isArray(b.actions) ? b.actions : [];
    el.hidden = !tasks.length;
    if (!tasks.length) return;
    $("#decisions-card").hidden = false;
    el.innerHTML = `<div class="quick-head">Small tasks</div><ul>${tasks.map((a) => `<li><span class="quick-what">${esc(a.action)}</span> <span class="hint">${esc(a.rationale || "")}</span></li>`).join("")}</ul>`;
  }

  /** The decision ledger: at most three open, each with Done and Drop. Closing one is the only thing the owner has to do. */
  function renderDecisions() {
    const d = state.data.decisions;
    const card = $("#decisions-card");
    const open = d && Array.isArray(d.open) ? d.open : [];
    const closed = d && Array.isArray(d.recently_closed) ? d.recently_closed : [];
    card.hidden = !open.length && !closed.length;
    if (card.hidden) return;
    const t = (d && d.tally) || {};
    $("#decisions-meta").textContent = `${open.length} open of 3 · so far ${t.done || 0} done, ${t.dropped || 0} dropped, ${t.lapsed || 0} lapsed`;
    const busy = !!(run.status && run.status.running), preparing = busy && run.status.running.job === "launch";
    // Date-only strings: format at noon local so the day never shifts with the timezone.
    const dOnly = (ymd) => new Date(`${String(ymd).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const due = (x) => x.days_to_due < 0 ? `<span class="pill fail">${-x.days_to_due}d overdue</span>` : x.days_to_due === 0 ? `<span class="pill fail">due today</span>` : `<span class="pill ${x.days_to_due <= 2 ? "watch" : "ontrack"}">due in ${x.days_to_due}d</span>`;
    $("#decisions-open").innerHTML = open.map((x) => `<li data-id="${esc(x.id)}">
        <div class="dmain">
          <div class="dmake">${esc(x.make)}</div>
          <div class="hint">${due(x)} <span class="badge">${esc(x.format)}</span> due ${esc(dOnly(x.due))} · ${x.days_open > 0 ? `open ${x.days_open} day${x.days_open === 1 ? "" : "s"}` : "new today"}</div>
          <div class="dwhy"><b>Why</b> ${esc(x.why || "")}</div>
          <div class="dwhy"><b>First step</b> ${esc(x.first_step || "")}</div>
          ${x.launch ? (x.launch.has_kit
            ? `<details class="kit" data-key="${esc(x.launch.key)}"><summary>Launch kit ready: titles, thumbnail words, description, pinned comment, posts, schedule</summary><div class="kit-body markdown"><div class="empty">Loading…</div></div></details>`
            : `<div class="kit-none">${preparing ? `<span class="hint">A launch kit is being prepared; this row fills in when it is done.</span>` : `<button type="button" class="btn ghost" data-kit="${esc(x.id)}" ${busy ? "disabled" : ""}>Prepare launch kit</button> <span class="hint">titles, description, pinned comment and posts for each platform, drafted for pasting; a few minutes</span>`}</div>`) : ""}
        </div>
        <div class="dbtns"><button type="button" class="btn" data-state="done">Done</button><button type="button" class="btn ghost" data-state="dropped">Drop</button></div>
      </li>`).join("") || `<li class="empty">Nothing open. The next brief proposes up to three.</li>`;
    $("#decisions-closed-wrap").hidden = !closed.length;
    $("#decisions-closed-sum").textContent = `${closed.length} closed recently`;
    $("#decisions-closed").innerHTML = closed.map((x) => `<li data-id="${esc(x.id)}">
        <span class="pill ${x.state === "done" ? "pass" : x.state === "lapsed" ? "fail" : "check"}">${esc(x.state)}</span>
        <span>${esc(x.make)} <span class="hint">· ${esc(dOnly(x.closed_on))}${x.by ? ` by ${esc(x.by === "auto" ? "the system" : x.by === "brief" ? "the brief" : "you")}` : ""}${x.note ? ` · ${esc(x.note)}` : ""}</span></span>
        ${x.by === "owner" || x.state === "lapsed" ? `<button type="button" class="btn ghost" data-state="open">Reopen</button>` : ""}
      </li>`).join("");
    // Launch kits: prepare one on request; an existing one loads when its row is opened, with a copy button per block.
    $$("#decisions-card button[data-kit]").forEach((btn) => btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await post("/api/run/launch", { id: btn.dataset.kit });
      if (!r.ok) { alert(`Not started: ${(r.data && (r.data.reason || r.data.error)) || "unknown reason"}`); btn.disabled = false; return; }
      await pollStatus();
      renderDecisions();
    }));
    $$("#decisions-card details.kit").forEach((el) => el.addEventListener("toggle", async () => {
      if (!el.open || el.dataset.loaded) return;
      el.dataset.loaded = "1";
      const box = $(".kit-body", el);
      const k = await api(`/api/launch/kit?key=${encodeURIComponent(el.dataset.key)}`).catch(() => ({ available: false }));
      if (!k.available) { box.innerHTML = `<div class="empty">The kit could not be read.</div>`; return; }
      box.innerHTML = renderMd(String(k.markdown).replace(/^# .*\n/, ""));
      $$("pre", box).forEach((pre) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn ghost copy"; b.textContent = "Copy";
        b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(pre.innerText.replace(/\nCopy$/, "")); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1500); } catch { b.textContent = "Select and copy"; } });
        pre.before(b);
      });
      // The WhatsApp line opens WhatsApp with the text ready; choosing who gets it stays with the owner.
      $$("h2, h3", box).filter((h) => /whatsapp/i.test(h.textContent)).forEach((h) => {
        let n = h.nextElementSibling; while (n && n.tagName !== "PRE" && !/^H[23]$/.test(n.tagName)) n = n.nextElementSibling;
        if (!n || n.tagName !== "PRE") return;
        const a = document.createElement("a");
        a.className = "btn ghost wa"; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open in WhatsApp";
        a.href = `https://wa.me/?text=${encodeURIComponent(n.innerText.trim())}`;
        h.after(a);
      });
    }));
    $$("#decisions-card button[data-state]").forEach((btn) => btn.addEventListener("click", async () => {
      const id = btn.closest("li").dataset.id, st = btn.dataset.state;
      let note = "";
      if (st === "dropped") { note = prompt("Why drop it? (optional; the next brief reads this)"); if (note === null) return; }
      btn.disabled = true;
      try {
        const res = await fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, state: st, note }) });
        const body = await res.json();
        if (!res.ok) { alert(body.error || "Could not save"); btn.disabled = false; return; }
        state.data.decisions = body;
        renderDecisions();
      } catch (e) { alert(String(e.message || e)); btn.disabled = false; }
    }));
  }

  function renderFindings() {
    const f = state.data.findings || {};
    const box = $("#findings-body");
    if (!f.available) { box.innerHTML = `<div class="empty">Findings are not available yet.</div>`; $("#findings-meta").textContent = ""; return; }
    const all = Array.isArray(f.findings) ? f.findings : [];
    if (!all.length) { box.innerHTML = `<div class="empty">No findings stored yet. They are checked on every refresh.</div>`; return; }
    const order = { drifted: 0, live: 1, retired: 2 };
    const sorted = all.slice().sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
    const counts = ["drifted", "live", "retired"].map((k) => `${all.filter((x) => x.status === k).length} ${k}`).join(" · ");
    $("#findings-meta").textContent = counts;
    const item = (x) => {
      const hist = Array.isArray(x.history) ? x.history.slice(-12) : [];
      const spark = hist.length ? `<span class="fhist" aria-label="last ${hist.length} checks">${hist.map((h) => `<i class="${h.ok ? "ok" : "no"}" title="${esc(fmtDate(h.checked_at))}: ${esc(h.value)}"></i>`).join("")}</span>` : "";
      return `<li class="finding ${esc(x.status)}">
        <span class="pill ${x.status === "drifted" ? "fail" : x.status === "live" ? "pass" : "check"}">${esc(x.status)}</span>
        <div>
          <div class="fclaim">${esc(x.claim)}</div>
          <div class="hint">now <b>${esc(x.last_value ?? "–")}</b> · expected ${esc(x.expectation ?? "–")} · checked ${esc(x.last_checked ? ago(x.last_checked) : "never")} ${spark}</div>
        </div>
      </li>`;
    };
    const active = sorted.filter((x) => x.status !== "retired");
    const retired = sorted.filter((x) => x.status === "retired");
    box.innerHTML = `<ul class="findings">${active.map(item).join("")}</ul>` +
      (retired.length ? `<details class="reco-more"><summary>${retired.length} retired</summary><ul class="findings">${retired.map(item).join("")}</ul></details>` : "");
  }

  function renderRecs() {
    const r = state.data.recs || {};
    const tb = $("#recs-table tbody");
    if (!r.available) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">The track record is not available yet.</div></td></tr>`; return; }
    const rows = Array.isArray(r.rows) ? r.rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
    const shipped = rows.filter((x) => x.shipped_video_id).length;
    $("#recs-meta").textContent = rows.length ? `${rows.length} recommendations in 60 days, ${shipped} shipped` : "what the briefs said to make in the last 60 days, and what happened";
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">No recommendations recorded in the last 60 days.</div></td></tr>`; return; }
    tb.innerHTML = rows.map((x) => `<tr>
      <td>${esc(fmtDate(x.date))}</td>
      <td><span class="badge">${esc(x.section)}</span></td>
      <td class="title">${esc(x.title)}</td>
      <td>${esc(x.format ?? "–")}</td>
      <td>${x.shipped_video_id ? `<a href="${ytUrl(x.shipped_video_id)}" target="_blank" rel="noopener">yes ↗</a>` : `<span class="hint">no</span>`}</td>
      <td>${esc(x.outcome ?? "–")}</td>
    </tr>`).join("");
  }

  // ---------- Search ----------
  const search = { kind: "", q: "", seq: 0, timer: null, bound: false };
  const KIND_LABEL = { comments: "Comment", transcripts: "Transcript", scripts: "Script", instagram: "Instagram", news: "News", comment: "Comment", transcript: "Transcript", script: "Script", caption: "Instagram", ig_caption: "Instagram", trend: "News" };
  // Everything is escaped, then the <mark> tags the search index put around matches are let back in.
  const snippetHtml = (s) => esc(s).replace(/&lt;(\/?)mark&gt;/g, "<$1mark>");

  async function loadSearch() {
    if (!search.bound) {
      search.bound = true;
      $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); runSearch(); });
      $("#search-q").addEventListener("input", () => { clearTimeout(search.timer); search.timer = setTimeout(runSearch, 350); });
      $$("#search-kinds .chip-btn").forEach((b) => b.addEventListener("click", () => {
        search.kind = b.dataset.kind;
        $$("#search-kinds .chip-btn").forEach((x) => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); });
        runSearch();
      }));
      $("#search-examples").addEventListener("click", (e) => { const b = e.target.closest("button[data-q]"); if (!b) return; $("#search-q").value = b.dataset.q; runSearch(); });
    }
    renderSearch();
    requestAnimationFrame(() => $("#search-q").focus());
  }

  async function runSearch() {
    const q = $("#search-q").value.trim();
    search.q = q;
    const seq = ++search.seq;
    if (!q) { state.data.search = null; renderSearch(); return; }
    $("#search-meta").textContent = "Searching…";
    try {
      const d = await api(`/api/search?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(search.kind)}`);
      if (seq !== search.seq) return; // a newer query has already been sent
      state.data.search = d;
    } catch (e) {
      if (seq !== search.seq) return;
      state.data.search = { error: e.message };
    }
    renderSearch();
  }

  function renderSearch() {
    const d = state.data.search;
    const meta = $("#search-meta"), list = $("#search-results");
    $("#search-empty").hidden = !!d;
    if (!d) { meta.textContent = ""; list.innerHTML = ""; return; }
    if (d.error) { meta.textContent = `Search failed: ${d.error}`; list.innerHTML = ""; return; }
    if (d.available === false) { meta.textContent = "Search is not available yet: the search index has not been built. It is built during a refresh."; list.innerHTML = ""; return; }
    const rows = Array.isArray(d.results) ? d.results : [];
    const counts = {}; rows.forEach((r) => { const k = KIND_LABEL[r.kind] || r.kind; counts[k] = (counts[k] || 0) + 1; });
    meta.textContent = rows.length ? `${rows.length >= 50 ? "The first 50" : rows.length} results for “${d.q}”: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.toLowerCase()}${n > 1 && !/s$|Instagram/i.test(k) ? "s" : ""}`).join(", ")}` : `No results for “${d.q}”${search.kind ? ". Try All sources." : ""}`;
    list.innerHTML = rows.map((r) => {
      const link = r.video_id ? `<a href="${ytUrl(r.video_id)}" target="_blank" rel="noopener">${esc(r.title || r.video_id)} ↗</a>` : esc(r.title || "");
      return `<li class="result k-${esc(String(r.kind))}">
        <div class="result-head"><span class="badge">${esc(KIND_LABEL[r.kind] || r.kind)}</span><span class="result-title">${link}</span></div>
        <div class="result-snippet">${snippetHtml(r.snippet)}</div>
        <div class="hint">${[r.channel ? esc(r.channel) : null, r.published_at ? esc(fmtDate(r.published_at)) : null, r.likes ? `${fmtFull(r.likes)} likes` : null].filter(Boolean).join(" · ")}</div>
      </li>`;
    }).join("");
  }

  const renderers = { brief: renderBrief, goal: renderGoal, search: renderSearch, overview: renderOverview, videos: renderVideos, competitors: renderCompetitors, ideas: renderIdeas, audience: renderAudience, research: renderResearch, instagram: renderInstagram, intel: renderIntel };

  // ---------- boot ----------
  if (typeof echarts === "undefined") {
    document.body.insertAdjacentHTML("afterbegin", `<div class="error">ECharts failed to load from the CDN. Charts need network access once; tables still work.</div>`);
    window.echarts = { init: () => ({ setOption() {}, resize() {}, dispose() {}, isDisposed: () => false }) };
  }
  // Sortable headers are only mouse targets in the markup; give them a role, a tab stop and Enter/Space so
  // the tables can be re-sorted without a pointer. Their existing click handlers do the work.
  $$("table.data th[data-key]").forEach((th) => {
    th.tabIndex = 0;
    th.setAttribute("role", "button");
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); th.click(); } });
  });

  let initial = (location.hash || "").slice(1);
  // The Brief tab is the front page: the owner opens the browser to read today's brief, so a bare URL lands
  // there. A hash still deep-links any tab.
  if (!loaders[initial] || HIDDEN_TABS.includes(initial)) initial = "brief";
  activate(initial);
  if (initial !== "goal") loadGoalStrip();
  window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (loaders[t] && !HIDDEN_TABS.includes(t) && !$(`#tab-${t}.active`)) activate(t); });
  pollStatus();
})();
