import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChevronRight, Plus, Check, Target, ListChecks, Activity, X, Flame, Trophy, Minus, Settings, Clock, FastForward, Trash2, Pencil, AlertTriangle, Quote, Pin, BookOpen } from "lucide-react";

/* ============================== tokens ============================== */
const T = {
  bg: "#060B16", bg2: "#0A1220",
  card: "rgba(255,255,255,0.045)", cardLine: "rgba(255,255,255,0.09)",
  text: "#E9EFF9", muted: "#8496AE", dim: "#3E4A5C",
  blue: "#3B9CFF", blueHi: "#8FCBFF", blueDeep: "#1E6FD9",
  red: "#FF6B6B", redHi: "#FFB4B4", green: "#4ADE80", amber: "#FFB347",
};

const PTS_PER_SCREEN = 100, DOT_STEP = 25, STAGE_STEP = 100, MARCH_MS = 2000;
const STORE_KEY = "thegoal:v11";

const PRINCIPLES_NOTE = `1. Remove the desire — don't fight it
Willpower is a tug-of-war you must win every single day. That's fragile — one bad night and you lose. The strong version kills the desire itself, so there's no rope to pull in the first place.

2. I'm giving up nothing
The losing side of the scale is empty. Nothing sacrificed means nothing to endure, and nothing left for willpower to do.

3. There's no such thing as one peek
A peek refeeds the Little Monster and tells the Big Monster the old lie is still true. The only real choice on the table is trap or freedom — nothing in between.

4. Pangs are the monster dying
Withdrawal isn't damage, it's healing you can feel. Reframed this way, the same sensation flips from threat to victory sound.

5. The itch is tiny — the belief makes it loud
Dismantle the belief and the itch loses its voice entirely — it goes back to being a passing sensation, no more commanding than a stomach rumble.

6. Decide once — never doubt
The decision was made with every fact on the table. So doubt gets a standing answer: this case is closed, and it doesn't reopen on the monster's request.

7. Freedom starts at the vow
Not after 21 days, not at a milestone. You're free the moment you walk out the gate; the rest is just the body catching up.

8. No side doors
There's one exit, not a hallway of half-measures. They all stay shut — gladly, because there's nothing behind any of them worth having.

9. It causes the void it claims to fill
Use → dip → itch → "relief" — a closed loop with no outside power source. Step outside it once, and it has nothing left to run on.

10. Live fully — hide from nothing
Bunker strategies quietly admit the thing is still precious. It isn't. Live completely; there's nothing left that needs to be kept from you.`;
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const uid = () => Math.random().toString(36).slice(2, 9);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAYNAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ============================== date logic ============================== */
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((keyToDate(dayKey(a)) - keyToDate(dayKey(b))) / 86400000);
const logicalDate = (now, s) => new Date(now.getTime() - (s.dayEndHour * 60 + s.dayEndMin) * 60000);
const fmtTime = (h, m) => { const ap = h >= 12 ? "PM" : "AM"; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}:${pad(m)} ${ap}`; };

const KIND = {
  do:     { label: "DOs",        tint: T.amber, note: "Miss = lose points" },
  better: { label: "Better DOs", tint: T.green, note: "Miss = no effect" },
  dont:   { label: "Don'ts",     tint: T.red,   note: "Avoid = earn points · Do it = lose points" },
};
const sign = (t) => (t.kind === "dont" ? -1 : 1);
const dontViolated = (t) => (t.mode === "simple" ? !!t.doneToday : t.mode === "repeat" ? (t.countToday || 0) > 0 : (t.qtyToday || 0) > 0);
const dontRewardPts = (t) => (t.kind === "dont" && t.sched === "daily" && !dontViolated(t) ? t.points : 0);
const earned = (t) => {
  if (t.mode === "repeat") return sign(t) * t.points * (t.countToday || 0);
  if (t.mode === "count") return sign(t) * t.points * (t.qtyToday || 0);
  return t.doneToday ? sign(t) * t.points : 0;
};

/* ---- daily minimum for repetitive tasks ---- */
const minOf = (t) => (t.mode === "repeat" && t.kind !== "dont" ? (t.minCount || 0) : 0);
const shortfall = (t) => { const m = minOf(t); return m ? Math.max(0, m - (t.countToday || 0)) : 0; };
const shortPts = (t) => shortfall(t) * t.points;
const met = (t) => (minOf(t) ? (t.countToday || 0) >= minOf(t) : earned(t) > 0);
// points a DO stands to lose if today ends as it is right now (any logging mode, only same-day-charged tasks)
const riskPts = (t) => {
  if (t.sched !== "daily" || t.kind !== "do") return 0;
  if (minOf(t) > 0) return shortPts(t);
  return met(t) ? 0 : t.points;
};

function isDue(t, date) {
  if (t.completed) return false;
  if (t.sched === "daily" || t.sched === "once") return true;
  const c = t.custom || {};
  if (c.mode === "weekdays") return (c.days || []).includes(date.getDay());
  if (c.mode === "everyN") { const n = Math.max(1, c.everyN || 1); return ((diffDays(date, keyToDate(t.createdKey)) % n) + n) % n === 0; }
  return true;
}

function schedLabel(t) {
  const base = t.sched === "daily" ? "Daily" : t.sched === "once" ? "One-time"
    : (() => { const c = t.custom || {};
        if (c.mode === "weekdays") return (c.days || []).map((d) => DAYS[d]).join(" ") || "Custom";
        if (c.mode === "everyN") return `Every ${c.everyN} days`;
        if (c.mode === "timesWk") return `${c.timesWk}× / week`;
        return "Custom"; })();
  const m = t.mode === "repeat" ? `${t.points} pts each`
    : t.mode === "count" ? `${t.points} pt per ${t.unit || "unit"}`
    : `${t.points} pts`;
  return `${base} · ${m}`;
}

/* ---- settle days and weeks ---- */
function runRollover(tasks, fromKey, toKey) {
  const penalties = {};
  const rewards = {};
  let list = tasks.map((t) => ({ ...t }));
  let cur = keyToDate(fromKey);
  const end = keyToDate(toKey);
  let guard = 0;
  const charge = (t, amt) => { if (amt > 0) penalties[t.goalId] = (penalties[t.goalId] || 0) + amt; };
  const award = (t, amt) => { if (amt > 0) rewards[t.goalId] = (rewards[t.goalId] || 0) + amt; };

  while (cur < end && guard++ < 21) {
    list = list.map((t) => {
      if (t.completed) return t;
      const n = { ...t };
      const hasMin = minOf(t) > 0;
      if (isDue(t, cur)) {
        if (t.sched === "daily") {
          if (hasMin) charge(t, shortPts(t));                                   // missing reps cost
          else if (t.kind === "do" && earned(t) <= 0) charge(t, t.points);
          else if (t.kind === "dont" && !dontViolated(t)) award(t, t.points);  // clean don't earns at submit
          // streak: DOs/Better DOs extend it by meeting the task, Don'ts extend it by avoiding it
          const success = t.kind === "dont" ? !dontViolated(t) : met(t);
          n.streak = success ? (t.streak || 0) + 1 : 0;
        }
        if (t.sched === "custom") {
          const cm = (t.custom || {}).mode;
          if (cm === "timesWk") {
            if (hasMin) n.weekUnits = (n.weekUnits || 0) + (t.countToday || 0);
            else if (met(t)) n.weekLog = (n.weekLog || 0) + 1;
          } else {
            n.weekDue = (n.weekDue || 0) + 1;
            if (hasMin) n.weekShort = (n.weekShort || 0) + shortPts(t);
            else if (met(t)) n.weekLog = (n.weekLog || 0) + 1;
          }
        }
        if (t.sched === "once" && earned(t) > 0) n.completed = true;
      }
      n.doneToday = false; n.countToday = 0; n.qtyToday = 0;
      return n;
    });

    if (cur.getDay() === 6) {   // week closes Saturday night
      list = list.map((t) => {
        const n = { ...t };
        if (t.sched === "custom" && !t.completed) {
          const cm = (t.custom || {}).mode;
          if (minOf(t) > 0) {
            if (cm === "timesWk") {
              const expected = (t.custom.timesWk || 0) * minOf(t);
              charge(t, Math.max(0, expected - (t.weekUnits || 0)) * t.points);
            } else charge(t, t.weekShort || 0);
          } else if (t.kind === "do") {
            const expected = cm === "timesWk" ? (t.custom.timesWk || 0) : (t.weekDue || 0);
            charge(t, Math.max(0, expected - (t.weekLog || 0)) * t.points);
          }
        }
        n.weekLog = 0; n.weekDue = 0; n.weekShort = 0; n.weekUnits = 0;
        return n;
      });
    }
    cur = addDays(cur, 1);
  }
  return { tasks: list, penalties, rewards };
}

/* ==================== journey line with travel effects ==================== */
const STREAKS = [-46, -30, -16, 16, 30, 46];

function JourneyLine({ points, target, animateFrom, onArrive }) {
  const wrapRef = useRef(null);
  const [H, setH] = useState(640);
  const [shown, setShown] = useState(animateFrom ?? points);
  const [dir, setDir] = useState(0);
  const shownRef = useRef(animateFrom ?? points);
  const rafRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const set = () => setH(el.getBoundingClientRect().height || 640);
    set(); const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the ball only travels when a finished day hands us a starting point — otherwise it just sits at the truth
  useEffect(() => {
    const to = points;
    const from = animateFrom == null ? to : animateFrom;
    cancelAnimationFrame(rafRef.current);
    if (from === to) { shownRef.current = to; setShown(to); setDir(0); return; }
    setDir(to > from ? 1 : -1);
    const dur = Math.min(MARCH_MS, 900 + Math.abs(to - from) * 14);
    const t0 = performance.now();
    const step = (now) => {
      const k = clamp01((now - t0) / dur);
      shownRef.current = from + (to - from) * easeInOut(k);
      setShown(shownRef.current);
      if (k < 1) rafRef.current = requestAnimationFrame(step);
      else { shownRef.current = to; setShown(to); setTimeout(() => setDir(0), 260); onArrive && onArrive(); }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [points, animateFrom, onArrive]);

  const ppp = H / PTS_PER_SCREEN, mid = H / 2;
  const yOf = (v) => mid - (v - shown) * ppp;
  const falling = dir < 0, rising = dir > 0;
  const neg = shown < 0 || falling;
  const accent = neg ? T.red : T.blue, accentHi = neg ? T.redHi : T.blueHi;
  const lineTop = yOf(target), lineBot = yOf(0);
  const brightTop = Math.max(lineTop, -40), brightBot = Math.min(mid, lineBot);
  const dimTop = Math.max(mid, lineTop), dimBot = Math.min(lineBot, H + 40);

  const span = PTS_PER_SCREEN * 0.8;
  const lo = Math.max(0, Math.floor((shown - span) / DOT_STEP) * DOT_STEP);
  const hi = Math.min(target, Math.ceil((shown + span) / DOT_STEP) * DOT_STEP);
  const marks = []; for (let v = lo; v <= hi; v += DOT_STEP) marks.push(v);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {falling && <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 50%, rgba(255,107,107,.22), transparent 70%)", pointerEvents: "none", animation: "redwash .5s ease-out" }} />}
      <div style={{ position: "absolute", left: "50%", top: mid, transform: "translate(-50%,-50%)", width: 360, height: 360, borderRadius: "50%", pointerEvents: "none", background: `radial-gradient(circle, ${neg ? "rgba(255,107,107,.24)" : "rgba(59,156,255,.20)"} 0%, transparent 68%)`, transition: "background .3s" }} />
      {dimBot > dimTop && <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: dimTop, height: dimBot - dimTop, width: 3, borderRadius: 3, background: "linear-gradient(to bottom, rgba(255,255,255,.26), rgba(255,255,255,.08))" }} />}
      {brightBot > brightTop && <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: brightTop, height: brightBot - brightTop, width: 3.5, borderRadius: 3, background: `linear-gradient(to top, ${accentHi}, ${accent})`, boxShadow: `0 0 12px ${accent}, 0 0 34px ${neg ? "rgba(255,107,107,.55)" : "rgba(59,156,255,.5)"}`, transition: "background .3s, box-shadow .3s" }} />}

      {marks.map((v) => {
        const y = yOf(v); if (y < -60 || y > H + 60) return null;
        const isStage = v % STAGE_STEP === 0, isEnd = v === 0 || v === target;
        const passed = v <= shown, near = clamp01(1 - Math.abs(v - shown) / 42);
        return (
          <div key={v} style={{ position: "absolute", left: "50%", top: y, transform: "translate(-50%,-50%)", display: "flex", alignItems: "center", pointerEvents: "none" }}>
            <div style={{ width: isEnd ? 13 : isStage ? 10 : 5, height: isEnd ? 13 : isStage ? 10 : 5, borderRadius: "50%", background: passed ? (isStage ? accent : "rgba(255,255,255,.5)") : "rgba(255,255,255,.3)", boxShadow: passed && isStage ? `0 0 12px ${accent}` : "none", opacity: isStage ? 1 : 0.55 + near * 0.45 }} />
            {isStage && near > 0.02 && (
              <>
                <div style={{ width: 40, height: 1, background: "rgba(255,255,255,.22)", marginLeft: 5, opacity: near }} />
                <div style={{ marginLeft: 9, whiteSpace: "nowrap", opacity: near, transform: `translateX(${(1 - near) * -8}px)` }}>
                  <div style={{ color: T.text, fontSize: 19, fontWeight: 500, lineHeight: 1.1 }}>{v}</div>
                  {isEnd && <div style={{ color: T.muted, fontSize: 12.5, marginTop: 1 }}>{v === 0 ? "Start" : "Goal"}</div>}
                </div>
              </>
            )}
          </div>
        );
      })}

      {dir !== 0 && STREAKS.map((x, i) => (
        <div key={i} style={{ position: "absolute", left: `calc(50% + ${x}px)`, top: mid + (rising ? 40 : -40), width: 2, height: 46, borderRadius: 2, pointerEvents: "none",
          background: rising ? "linear-gradient(to top, rgba(143,203,255,0), rgba(143,203,255,.85))" : "linear-gradient(to bottom, rgba(255,180,180,0), rgba(255,180,180,.85))",
          animation: `${rising ? "rushUp" : "rushDown"} .7s linear ${i * 0.07}s infinite` }} />
      ))}
      {rising && [0, 1, 2, 3].map((i) => (
        <div key={`p${i}`} style={{ position: "absolute", left: `calc(50% + ${[-34, 34, -18, 18][i]}px)`, top: mid + 52, width: 26, height: 26, borderRadius: "50%", pointerEvents: "none",
          background: "radial-gradient(circle, rgba(200,228,255,.5), transparent 70%)", animation: `puff 1s ease-out ${i * 0.14}s infinite` }} />
      ))}

      <div style={{ position: "absolute", left: "50%", top: mid, transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
        <div style={{ width: 106, height: 106, borderRadius: "50%", border: `2.5px solid ${accentHi}`,
          background: `radial-gradient(circle, ${neg ? "rgba(255,107,107,.18)" : "rgba(59,156,255,.16)"}, ${T.bg} 72%)`,
          boxShadow: `0 0 ${falling ? 34 : 26}px ${accent}, 0 0 ${falling ? 78 : 62}px ${neg ? "rgba(255,107,107,.5)" : "rgba(59,156,255,.45)"}, inset 0 0 22px ${neg ? "rgba(255,107,107,.3)" : "rgba(59,156,255,.28)"}`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          animation: falling ? "shake .28s ease-in-out infinite" : rising ? "thrust .5s ease-in-out infinite" : "breathe 3.4s ease-in-out infinite",
          transition: "border-color .3s, box-shadow .3s" }}>
          <div style={{ color: "#fff", fontSize: 31, fontWeight: 500, lineHeight: 1 }}>{Math.round(shown)}</div>
          <div style={{ color: "rgba(255,255,255,.72)", fontSize: 12.5, marginTop: 3 }}>Points</div>
        </div>
      </div>

      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 150, background: `linear-gradient(to bottom, ${T.bg} 6%, rgba(6,11,22,0) 100%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 150, background: `linear-gradient(to top, ${T.bg} 6%, rgba(6,11,22,0) 100%)`, pointerEvents: "none" }} />
    </div>
  );
}

/* ============================== seed ============================== */
const seedState = (todayKey) => ({
  goals: [{ id: "g1", name: "The Goal", target: 1000, achieved: 240 }],
  tasks: [
    { id: "t0", goalId: "g1", title: "Read the Principles", points: 25, kind: "do", mode: "simple", sched: "daily", createdKey: todayKey, fixed: true, richContent: "principles", note: "Ten bedrock principles, illustrated — tap to read the full set." },
    { id: "t1", goalId: "g1", title: "Morning workout", points: 40, kind: "do", mode: "simple", sched: "daily", createdKey: todayKey, streak: 5, note: "You've never regretted one once it's done. Future you is already thanking you." },
    { id: "t2", goalId: "g1", title: "Glasses of water", points: 3, minCount: 8, kind: "do", mode: "repeat", sched: "daily", createdKey: todayKey, streak: 2 },
    { id: "t3", goalId: "g1", title: "Gym session", points: 50, kind: "do", mode: "simple", sched: "custom", custom: { mode: "weekdays", days: [1, 3, 5] }, createdKey: todayKey },
    { id: "t4", goalId: "g1", title: "Long run", points: 60, kind: "do", mode: "simple", sched: "custom", custom: { mode: "timesWk", timesWk: 3 }, createdKey: todayKey },
    { id: "t5", goalId: "g1", title: "Workout", points: 1, unit: "min", kind: "better", mode: "count", sched: "daily", createdKey: todayKey },
    { id: "t6", goalId: "g1", title: "Kind gesture", points: 10, kind: "better", mode: "repeat", sched: "daily", createdKey: todayKey },
    { id: "t7", goalId: "g1", title: "Cigarette", points: 15, kind: "dont", mode: "repeat", sched: "daily", createdKey: todayKey, streak: 9, note: "9 days clean. Don't trade that for one." },
  ].map((t) => ({ streak: 0, note: "", fixed: false, ...t, doneToday: false, countToday: 0, qtyToday: 0, weekLog: 0, weekDue: 0, weekShort: 0, weekUnits: 0, completed: false })),
  settings: { dayEndHour: 3, dayEndMin: 0 },
  lastDayKey: todayKey,
  dayOffset: 0,
});

/* ============================== app ============================== */
export default function TheGoalApp() {
  const [ready, setReady] = useState(false);
  const [goals, setGoals] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [settings, setSettings] = useState({ dayEndHour: 3, dayEndMin: 0 });
  const [lastDayKey, setLastDayKey] = useState(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [verseSeen, setVerseSeen] = useState(null);   // dayKey the verse was dismissed on

  const [activeId, setActiveId] = useState("g1");
  const [view, setView] = useState("journey");
  const [modal, setModal] = useState(null);
  const [burst, setBurst] = useState(null);
  const [toast, setToast] = useState(null);
  const [march, setMarch] = useState({});   // goalId -> points before the day settled

  const now = new Date(Date.now() + dayOffset * 86400000);
  const today = logicalDate(now, settings);
  const todayKey = dayKey(today);

  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(null), 2600); }, []);

  useEffect(() => {
    let s = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) s = JSON.parse(raw);
    } catch { /* first run */ }
    const k = dayKey(logicalDate(new Date(), { dayEndHour: 3, dayEndMin: 0 }));
    if (!s) s = seedState(k);
    setGoals(s.goals); setTasks(s.tasks); setSettings(s.settings);
    setLastDayKey(s.lastDayKey); setDayOffset(s.dayOffset || 0); setVerseSeen(s.verseSeen || null);
    setActiveId(s.goals[0]?.id || "g1");
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ goals, tasks, settings, lastDayKey, dayOffset, verseSeen }));
      } catch { /* storage full or unavailable */ }
    }, 250);
    return () => clearTimeout(id);
  }, [ready, goals, tasks, settings, lastDayKey, dayOffset, verseSeen]);

  const pendingSubmit = !!(lastDayKey && todayKey > lastDayKey);
  const activeDay = pendingSubmit ? keyToDate(lastDayKey) : today;
  const activeDayKey = pendingSubmit ? lastDayKey : todayKey;

  const goal = goals.find((g) => g.id === activeId) || goals[0];
  const gAll = goal ? tasks.filter((t) => t.goalId === goal.id && !t.completed) : [];
  const gToday = gAll.filter((t) => isDue(t, activeDay));
  const todayPoints = gToday.reduce((s, t) => s + earned(t), 0);
  const atRisk = gToday.reduce((s, t) => s + riskPts(t), 0);

  const submitPreview = useMemo(() => {
    if (!pendingSubmit || !goal) return { pen: 0, rew: 0 };
    const { penalties, rewards } = runRollover(JSON.parse(JSON.stringify(tasks)), lastDayKey, todayKey);
    return { pen: penalties[goal.id] || 0, rew: rewards[goal.id] || 0 };
  }, [pendingSubmit, tasks, lastDayKey, todayKey, goal]);

  const bump = (gid, d) => { if (d) setGoals((gs) => gs.map((g) => (g.id === gid ? { ...g, achieved: g.achieved + d } : g))); };
  const openJourney = () => setView("journey");
  const marchFrom = goal ? march[goal.id] : undefined;
  const arrive = useCallback(() => {
    setMarch((m) => { if (!goal || m[goal.id] == null) return m; const n = { ...m }; delete n[goal.id]; return n; });
  }, [goal]);

  const submitDay = useCallback(() => {
    if (!pendingSubmit) return;
    const { tasks: next, penalties, rewards } = runRollover(tasks, lastDayKey, todayKey);
    setTasks(next);
    const before = {};
    setGoals((gs) => gs.map((g) => {
      const pen = penalties[g.id] || 0;
      const rew = rewards[g.id] || 0;
      if (pen || rew) before[g.id] = g.achieved;
      return { ...g, achieved: g.achieved + rew - pen };
    }));
    if (Object.keys(before).length) setMarch(before);
    setLastDayKey(todayKey);
    const totalPen = Object.values(penalties).reduce((a, b) => a + b, 0);
    const totalRew = Object.values(rewards).reduce((a, b) => a + b, 0);
    const parts = [];
    if (totalRew > 0) parts.push(`+${totalRew} earned`);
    if (totalPen > 0) parts.push(`−${totalPen} shortfalls`);
    flash(parts.length ? `Day submitted · ${parts.join(" · ")}` : "Day submitted · slate is clean");
  }, [pendingSubmit, tasks, lastDayKey, todayKey, flash]);

  const showBurst = (delta) => {
    if (!delta) return;
    const b = { id: uid(), text: `${delta > 0 ? "+" : ""}${delta}`, pos: delta > 0 };
    setBurst(b);
    setTimeout(() => setBurst((c) => (c && c.id === b.id ? null : c)), 1100);
  };

  const applyTask = (t, patch) => {
    const next = { ...t, ...patch };
    const delta = earned(next) - earned(t);
    bump(t.goalId, delta);
    setTasks((ts) => ts.map((x) => (x.id === t.id ? next : x)));
    showBurst(delta);
  };

  const saveTask = (fields, existing) => {
    if (existing) {
      const next = { ...existing, ...fields };
      bump(existing.goalId, earned(next) - earned(existing));
      setTasks((ts) => ts.map((x) => (x.id === existing.id ? next : x)));
      flash("Task updated");
    } else {
      setTasks((ts) => [...ts, { note: "", fixed: false, ...fields, id: uid(), goalId: goal.id, createdKey: todayKey, doneToday: false, countToday: 0, qtyToday: 0, weekLog: 0, weekDue: 0, weekShort: 0, weekUnits: 0, streak: 0, completed: false }]);
      flash("Task added");
    }
    setModal(null);
  };

  const delTask = (t) => {
    if (t.fixed) { flash("This task is fixed and can't be deleted"); return; }
    bump(t.goalId, -earned(t)); setTasks((ts) => ts.filter((x) => x.id !== t.id)); setModal(null); flash("Task deleted");
  };

  const saveGoal = (fields, existing) => {
    if (existing) { setGoals((gs) => gs.map((g) => (g.id === existing.id ? { ...g, ...fields } : g))); flash("Goal updated"); }
    else { const id = uid(); setGoals((gs) => [...gs, { id, ...fields, achieved: 0 }]); setActiveId(id); openJourney(); flash("New goal started"); }
    setModal(null);
  };

  const delGoal = (g) => {
    if (goals.length <= 1) { flash("Keep at least one goal"); return; }
    setTasks((ts) => ts.filter((t) => t.goalId !== g.id));
    const rest = goals.filter((x) => x.id !== g.id);
    setGoals(rest); if (activeId === g.id) setActiveId(rest[0].id);
    setModal(null); flash("Goal deleted");
  };

  const resetAll = () => {
    const s = seedState(dayKey(logicalDate(new Date(), settings)));
    setGoals(s.goals); setTasks(s.tasks); setSettings(s.settings); setLastDayKey(s.lastDayKey); setDayOffset(0);
    setActiveId("g1"); setModal(null); flash("Everything reset");
  };

  if (!ready || !goal) {
    return <div style={{ height: "100dvh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", color: T.muted, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const prog = clamp01(goal.achieved / goal.target), pct = Math.round(prog * 100);

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", minHeight: "100vh", overflow: "hidden", background: T.bg, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap');
        @keyframes breathe{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
        @keyframes thrust{0%,100%{filter:brightness(1.15)}50%{filter:brightness(1.5)}}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
        @keyframes rushUp{0%{transform:translateY(0);opacity:0}20%{opacity:.9}100%{transform:translateY(-130px);opacity:0}}
        @keyframes rushDown{0%{transform:translateY(0);opacity:0}20%{opacity:.9}100%{transform:translateY(130px);opacity:0}}
        @keyframes puff{0%{opacity:0;transform:scale(.4) translateY(0)}30%{opacity:.6}100%{opacity:0;transform:scale(1.7) translateY(46px)}}
        @keyframes redwash{0%{opacity:0}30%{opacity:1}100%{opacity:0}}
        @keyframes burst{0%{opacity:0;transform:translate(-50%,10px) scale(.7)}22%{opacity:1}100%{opacity:0;transform:translate(-50%,-52px) scale(1.2)}}
        @keyframes pop{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes verseIn{from{opacity:0;transform:translateY(26px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes verseOut{to{opacity:0;transform:translateY(14px) scale(.97)}}
        @media (prefers-reduced-motion:reduce){*{animation:none!important}}
        ::-webkit-scrollbar{width:0}
      `}</style>

      {/* ============ JOURNEY ============ */}
      {view === "journey" && (
        <div style={{ position: "absolute", inset: 0, bottom: 72 }}>
          <JourneyLine points={goal.achieved} target={goal.target} animateFrom={marchFrom} onArrive={arrive} />
          <div style={{ position: "absolute", top: 16, left: 18, right: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => setModal({ type: "goal", payload: goal })} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}>
              <div style={{ color: T.text, fontSize: 17, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>{goal.name} <Pencil size={13} color={T.dim} /></div>
              <div style={{ color: T.muted, fontSize: 12.5, marginTop: 2 }}>{goal.achieved} / {goal.target} · {pct}%</div>
            </button>
            <div style={{ textAlign: "right" }}>
              <div style={{ background: T.card, border: `1px solid ${T.cardLine}`, borderRadius: 20, padding: "6px 13px", color: todayPoints < 0 ? T.red : T.blue, fontSize: 14, fontWeight: 600 }}>
                {marchFrom != null ? "settling…" : `${todayPoints >= 0 ? "+" : ""}${todayPoints} today`}
              </div>
              {atRisk > 0 && <div style={{ color: T.red, fontSize: 11.5, marginTop: 5, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}><AlertTriangle size={11} /> −{atRisk} at risk</div>}
            </div>
          </div>
          {burst && <div key={burst.id} style={{ position: "absolute", left: "50%", top: "34%", color: burst.pos ? T.blueHi : T.red, fontSize: 34, fontWeight: 600, animation: "burst 1.1s ease-out forwards", pointerEvents: "none" }}>{burst.text}</div>}
          {verseSeen !== activeDayKey && marchFrom == null && (
            <DailyVerse dayKeyStr={activeDayKey} onDismiss={() => setVerseSeen(activeDayKey)} />
          )}
        </div>
      )}

      {/* ============ TASKS ============ */}
      {view === "tasks" && (
        <div style={{ position: "absolute", inset: 0, bottom: 72, display: "flex", flexDirection: "column" }}>
          <button onClick={openJourney} style={{ position: "relative", flexShrink: 0, background: "none", border: "none", borderBottom: `1px solid ${T.cardLine}`, cursor: "pointer", padding: "18px 22px 16px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
            <div style={{ textAlign: "left" }}>
              <div style={{ color: T.muted, fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>COLLECTED TODAY</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                <span style={{ color: todayPoints < 0 ? T.red : todayPoints > 0 ? T.blueHi : T.muted, fontSize: 40, fontWeight: 600, lineHeight: 1, letterSpacing: "-.02em", textShadow: todayPoints > 0 ? `0 0 22px rgba(59,156,255,.45)` : "none" }}>
                  {todayPoints > 0 ? "+" : ""}{todayPoints}
                </span>
                <span style={{ color: T.muted, fontSize: 14 }}>pts</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: T.text, fontSize: 14, fontWeight: 500 }}>{goal.name}</div>
              <div style={{ color: T.muted, fontSize: 12, marginTop: 3 }}>{goal.achieved} / {goal.target}</div>
              <div style={{ color: T.blue, fontSize: 11.5, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>Journey <ChevronRight size={13} /></div>
            </div>
            {burst && <div key={burst.id} style={{ position: "absolute", left: 90, top: 40, color: burst.pos ? T.blueHi : T.red, fontSize: 24, fontWeight: 600, animation: "burst 1.1s ease-out forwards", pointerEvents: "none" }}>{burst.text}</div>}
          </button>

          <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px 24px" }}>
            {pendingSubmit && (
              <div style={{ background: "rgba(59,156,255,.1)", border: "1px solid rgba(59,156,255,.35)", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
                <div style={{ color: T.blueHi, fontSize: 13.5, fontWeight: 600, lineHeight: 1.45 }}>Your day ended — review your tasks, then submit.</div>
                <div style={{ color: T.muted, fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
                  {submitPreview.rew > 0 && <span style={{ color: T.green }}>+{submitPreview.rew} from clean Don'ts</span>}
                  {submitPreview.rew > 0 && submitPreview.pen > 0 && <span> · </span>}
                  {submitPreview.pen > 0 && <span style={{ color: T.red }}>−{submitPreview.pen} from shortfalls</span>}
                  {!submitPreview.rew && !submitPreview.pen && "No settlement points pending."}
                </div>
                <button onClick={submitDay} style={{ width: "100%", marginTop: 12, background: T.blue, color: "#04101F", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>
                  Submit day
                </button>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ color: T.text, fontSize: 21, fontWeight: 500 }}>
                  {DAYNAMES[activeDay.getDay()]}'s tasks{pendingSubmit ? " · ready to submit" : ""}
                </div>
                <div style={{ color: T.dim, fontSize: 11.5, marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={12} /> {pendingSubmit ? "Review and submit when ready" : `Day closes at ${fmtTime(settings.dayEndHour, settings.dayEndMin)}`}
                </div>
              </div>
              <button onClick={() => setModal({ type: "task" })} style={{ background: T.blue, color: "#04101F", border: "none", borderRadius: 11, padding: "9px 14px", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}><Plus size={16} /> Add</button>
            </div>

            {["do", "better", "dont"].map((k) => (
              <Group key={k} kind={k} tasks={gToday.filter((t) => t.kind === k)} onApply={applyTask} onEdit={(t) => setModal({ type: "task", payload: t })} />
            ))}

            {gAll.length > gToday.length && (
              <div style={{ color: T.dim, fontSize: 12, textAlign: "center", padding: "6px 0 4px" }}>
                {gAll.length - gToday.length} task{gAll.length - gToday.length > 1 ? "s" : ""} not scheduled for today
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ GOALS ============ */}
      {view === "goals" && (
        <div style={{ position: "absolute", inset: 0, bottom: 72, overflowY: "auto", padding: "22px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ color: T.text, fontSize: 24, fontWeight: 500 }}>Your goals</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setModal({ type: "settings" })} style={{ background: T.card, border: `1px solid ${T.cardLine}`, borderRadius: 11, padding: "9px 11px", color: T.muted, cursor: "pointer", display: "flex" }}><Settings size={17} /></button>
              <button onClick={() => setModal({ type: "goal" })} style={{ background: T.blue, color: "#04101F", border: "none", borderRadius: 11, padding: "9px 14px", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}><Plus size={16} /> New</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <Mini icon={<Flame size={15} />} v={gToday.filter((t) => met(t)).length} l="Met today" />
            <Mini icon={<Check size={15} />} v={gToday.length} l="Due today" />
            <Mini icon={<Trophy size={15} />} v={goals.filter((g) => g.achieved >= g.target).length} l="Reached" />
          </div>
          {goals.map((g) => {
            const p = clamp01(g.achieved / g.target), on = g.id === activeId;
            return (
              <div key={g.id} onClick={() => { setActiveId(g.id); openJourney(); }} style={{ background: T.card, border: `1px solid ${on ? "rgba(59,156,255,.55)" : T.cardLine}`, borderRadius: 16, padding: 17, marginBottom: 11, cursor: "pointer", boxShadow: on ? "0 0 22px rgba(59,156,255,.15)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
                  <span style={{ color: T.text, fontSize: 17, fontWeight: 500, flex: 1, minWidth: 0 }}>{g.name}</span>
                  <span style={{ color: g.achieved < 0 ? T.red : T.blue, fontSize: 14, fontWeight: 600 }}>{g.achieved} / {g.target}</span>
                  <button onClick={(e) => { e.stopPropagation(); setModal({ type: "goal", payload: g }); }} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", padding: 2, display: "flex" }}><Pencil size={15} /></button>
                </div>
                <div style={{ height: 5, background: "rgba(255,255,255,.09)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${p * 100}%`, height: "100%", background: g.achieved < 0 ? T.red : `linear-gradient(90deg, ${T.blueDeep}, ${T.blueHi})`, boxShadow: `0 0 10px ${T.blue}`, transition: "width .5s" }} />
                </div>
                <div style={{ color: T.muted, fontSize: 12, marginTop: 9 }}>{Math.round(p * 100)}% · {tasks.filter((t) => t.goalId === g.id && !t.completed).length} tasks</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============ nav ============ */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 72, background: "rgba(6,11,22,.92)", backdropFilter: "blur(12px)", borderTop: `1px solid ${T.cardLine}`, display: "flex", padding: "8px 10px" }}>
        {[{ k: "goals", i: <Target size={21} />, l: "Goals" }, { k: "tasks", i: <ListChecks size={21} />, l: "Tasks" }, { k: "journey", i: <Activity size={21} />, l: "Journey" }].map((n) => {
          const on = view === n.k;
          return (
            <button key={n.k} onClick={() => (n.k === "journey" ? openJourney() : setView(n.k))} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: on ? T.blue : T.dim }}>
              {n.i}<span style={{ fontSize: 11, fontWeight: on ? 700 : 500 }}>{n.l}</span>
            </button>
          );
        })}
      </div>

      {toast && <div style={{ position: "absolute", bottom: 88, left: "50%", transform: "translateX(-50%)", background: "rgba(20,30,48,.96)", border: `1px solid ${T.cardLine}`, color: T.text, padding: "11px 20px", borderRadius: 30, fontSize: 13, fontWeight: 500, animation: "pop .25s ease", whiteSpace: "nowrap", zIndex: 40 }}>{toast}</div>}

      {modal?.type === "goal" && <GoalModal initial={modal.payload} onClose={() => setModal(null)} onSave={saveGoal} onDelete={delGoal} canDelete={goals.length > 1} />}
      {modal?.type === "task" && <TaskModal goalName={goal.name} initial={modal.payload} onClose={() => setModal(null)} onSave={saveTask} onDelete={delTask} />}
      {modal?.type === "settings" && (
        <SettingsModal settings={settings} onChange={setSettings} onClose={() => setModal(null)}
          onAdvance={() => { setDayOffset((d) => d + 1); setModal(null); }}
          onReset={resetAll} todayLabel={`${DAYNAMES[today.getDay()]} ${todayKey}`} />
      )}
    </div>
  );
}

/* ============================== task list ============================== */
function Group({ kind, tasks, onApply, onEdit }) {
  const meta = KIND[kind];
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: meta.tint, boxShadow: `0 0 8px ${meta.tint}` }} />
        <span style={{ color: T.text, fontSize: 13.5, fontWeight: 600 }}>{meta.label}</span>
      </div>
      {tasks.length === 0 && <div style={{ color: T.dim, fontSize: 13, padding: "2px 2px 6px" }}>Nothing due today.</div>}
      {tasks.map((t) => <Row key={t.id} t={t} onApply={onApply} onEdit={onEdit} />)}
    </div>
  );
}

const rndBtn = { width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,.06)", border: `1px solid ${T.cardLine}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

function NumStepper({ value, onChange, min = 0, max = 9999, step = 1, compact, accent }) {
  const v = value ?? 0;
  const dec = () => onChange(Math.max(min, v - step));
  const inc = () => onChange(Math.min(max, v + step));
  const tint = accent || T.blue;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8, width: compact ? undefined : "100%" }}>
      <button type="button" onClick={dec} disabled={v <= min} style={{ ...rndBtn, opacity: v <= min ? 0.35 : 1, cursor: v <= min ? "default" : "pointer" }}><Minus size={14} color={T.muted} /></button>
      <span style={{ color: T.text, fontSize: compact ? 15 : 16, fontWeight: 700, minWidth: compact ? 24 : 40, textAlign: "center", flex: compact ? undefined : 1 }}>{v}</span>
      <button type="button" onClick={inc} disabled={v >= max} style={{ ...rndBtn, borderColor: tint, opacity: v >= max ? 0.35 : 1, cursor: v >= max ? "default" : "pointer" }}><Plus size={14} color={tint} /></button>
    </div>
  );
}

function Row({ t, onApply, onEdit }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const meta = KIND[t.kind];
  const val = earned(t);
  const active = val !== 0;
  const negKind = t.kind === "dont";
  const m = minOf(t);
  const weekly = t.sched === "custom" && (t.custom || {}).mode === "timesWk";
  const border = active ? (val < 0 ? "rgba(255,107,107,.45)" : "rgba(59,156,255,.3)") : T.cardLine;
  const hasNote = !!(t.note && t.note.trim());
  const isLongNote = hasNote && (t.note.length > 110 || t.note.includes("\n") || !!t.richContent);

  return (
    <div style={{ background: T.card, border: `1px solid ${border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {t.mode === "simple" && (
          <button onClick={() => onApply(t, { doneToday: !t.doneToday })} style={{ width: 27, height: 27, borderRadius: "50%", border: `2px solid ${t.doneToday ? meta.tint : "rgba(255,255,255,.22)"}`, background: t.doneToday ? meta.tint : "transparent", boxShadow: t.doneToday ? `0 0 14px ${meta.tint}` : "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {t.doneToday && <Check size={16} color="#04101F" strokeWidth={3} />}
          </button>
        )}
        {t.mode === "repeat" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={() => onApply(t, { countToday: Math.max(0, (t.countToday || 0) - 1) })} style={rndBtn}><Minus size={14} color={T.muted} /></button>
            <span style={{ color: (t.countToday || 0) > 0 ? meta.tint : T.dim, fontSize: 16, fontWeight: 700, minWidth: m ? 34 : 16, textAlign: "center" }}>
              {t.countToday || 0}{m ? <span style={{ color: T.dim, fontSize: 12, fontWeight: 600 }}>/{m}</span> : null}
            </span>
            <button onClick={() => onApply(t, { countToday: (t.countToday || 0) + 1 })} style={{ ...rndBtn, borderColor: meta.tint }}><Plus size={14} color={meta.tint} /></button>
          </div>
        )}
        {t.mode === "count" && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <NumStepper value={t.qtyToday || 0} onChange={(v) => onApply(t, { qtyToday: v })} min={0} compact accent={meta.tint} />
            <span style={{ color: T.dim, fontSize: 11 }}>{t.unit || "unit"}</span>
          </div>
        )}

        <button onClick={() => onEdit(t)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ color: T.text, fontSize: 15, fontWeight: 500, opacity: t.mode === "simple" && t.doneToday && !negKind ? 0.6 : 1, textDecoration: t.mode === "simple" && t.doneToday && !negKind ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
            {t.fixed && <Pin size={11} color={T.dim} style={{ flexShrink: 0 }} />}
            {t.sched === "daily" && (t.streak || 0) > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2, background: "rgba(255,179,71,.14)", border: "1px solid rgba(255,179,71,.35)", borderRadius: 8, padding: "1px 6px", flexShrink: 0 }}>
                <span style={{ fontSize: 11 }}>⚡</span>
                <span style={{ color: T.amber, fontSize: 11.5, fontWeight: 700 }}>{t.streak}</span>
              </span>
            )}
          </div>
          <div style={{ color: T.dim, fontSize: 11.5, marginTop: 2 }}>
            {schedLabel(t)}{m ? ` · min ${m}/day` : ""}{weekly ? ` · ${t.weekLog || 0}/${t.custom.timesWk} this week` : ""}
          </div>
        </button>

        <span style={{ color: val > 0 ? T.blue : val < 0 ? T.red : negKind ? T.green : T.muted, fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
          {val > 0 ? `+${val}` : val < 0 ? `${val}` : negKind ? `+${t.points}` : `${t.points}`}
        </span>
      </div>

      {hasNote && (
        <button onClick={() => (isLongNote ? setNoteOpen(true) : onEdit(t))} style={{ display: "flex", alignItems: "flex-start", gap: 5, marginTop: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${T.cardLine}`, borderRadius: 8, padding: "5px 8px", width: "100%", textAlign: "left", cursor: "pointer" }}>
          <Quote size={10} color={T.dim} style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: T.muted, fontSize: 10.5, fontStyle: "italic", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.note}</span>
            {isLongNote && <span style={{ display: "block", color: T.blueHi, fontSize: 10, fontWeight: 600, marginTop: 2, fontStyle: "normal" }}>Read in full →</span>}
          </span>
        </button>
      )}

      {noteOpen && <NoteModal task={t} onClose={() => setNoteOpen(false)} onEdit={() => { setNoteOpen(false); onEdit(t); }} />}
    </div>
  );
}

/* ============================== bedrock principles (illustrated) ============================== */
/* ============================== daily verse / hadith ============================== */
const DAILY_TEXTS = [
  { t: "وَقُلِ اعْمَلُوا فَسَيَرَى اللَّهُ عَمَلَكُمْ وَرَسُولُهُ وَالْمُؤْمِنُونَ", s: "التوبة: 105", q: true },
  { t: "وَأَنْ لَيْسَ لِلْإِنْسَانِ إِلَّا مَا سَعَى * وَأَنَّ سَعْيَهُ سَوْفَ يُرَى", s: "النجم: 39-40", q: true },
  { t: "إن الله يحب إذا عمل أحدكم عملا أن يتقنه", s: "حديث حسن" },
  { t: "فَإِذَا قُضِيَتِ الصَّلَاةُ فَانْتَشِرُوا فِي الْأَرْضِ وَابْتَغُوا مِنْ فَضْلِ اللَّهِ", s: "الجمعة: 10", q: true },
  { t: "ما أكل أحد طعاماً قط خيراً من أن يأكل من عمل يده", s: "رواه البخاري" },
  { t: "إِنَّا لَا نُضِيعُ أَجْرَ مَنْ أَحْسَنَ عَمَلًا", s: "الكهف: 30", q: true },
  { t: "لأن يأخذ أحدكم حبله فيحتطب على ظهره خير له من أن يأتي رجلا فيسأله", s: "رواه البخاري" },
  { t: "فَمَنْ يَعْمَلْ مِثْقَالَ ذَرَّةٍ خَيْرًا يَرَهُ", s: "الزلزلة: 7", q: true },
  { t: "إن قامت الساعة وفي يد أحدكم فسيلة، فإن استطاع ألا تقوم حتى يغرسها فليغرسها", s: "رواه أحمد" },
  { t: "وَتَعَاوَنُوا عَلَى الْبِرِّ وَالتَّقْوَى", s: "المائدة: 2", q: true },
  { t: "احرص على ما ينفعك، واستعن بالله ولا تعجز", s: "رواه مسلم" },
  { t: "مَنْ عَمِلَ صَالِحًا مِنْ ذَكَرٍ أَوْ أُنْثَى وَهُوَ مُؤْمِنٌ فَلَنُحْيِيَنَّهُ حَيَاةً طَيِّبَةً", s: "النحل: 97", q: true },
  { t: "اليد العليا خير من اليد السفلى", s: "متفق عليه" },
  { t: "وَلِكُلٍّ دَرَجَاتٌ مِمَّا عَمِلُوا وَمَا رَبُّكَ بِغَافِلٍ عَمَّا يَعْمَلُونَ", s: "الأنعام: 132", q: true },
  { t: "اغتنم خمسا قبل خمس: شبابك قبل هرمك، وصحتك قبل سقمك، وغناك قبل فقرك، وفراغك قبل شغلك، وحياتك قبل موتك", s: "رواه الحاكم" },
  { t: "وَمَا تُقَدِّمُوا لِأَنْفُسِكُمْ مِنْ خَيْرٍ تَجِدُوهُ عِنْدَ اللَّهِ", s: "البقرة: 110", q: true },
  { t: "أحب الأعمال إلى الله أدومها وإن قل", s: "رواه مسلم" },
  { t: "الَّذِي خَلَقَ الْمَوْتَ وَالْحَيَاةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا", s: "الملك: 2", q: true },
  { t: "وَمَنْ أَرَادَ الْآخِرَةَ وَسَعَى لَهَا سَعْيَهَا وَهُوَ مُؤْمِنٌ فَأُولَئِكَ كَانَ سَعْيُهُمْ مَشْكُورًا", s: "الإسراء: 19", q: true },
  { t: "بادروا بالأعمال سبعاً", s: "رواه الترمذي" },
  { t: "لِيَبْلُوَكُمْ فِي مَا آتَاكُمْ فَاسْتَبِقُوا الْخَيْرَاتِ", s: "المائدة: 48", q: true },
  { t: "خير الناس أنفعهم للناس", s: "رواه الطبراني" },
  { t: "وَافْعَلُوا الْخَيْرَ لَعَلَّكُمْ تُفْلِحُونَ", s: "الحج: 77", q: true },
  { t: "اللهم إني أعوذ بك من العجز والكسل", s: "رواه مسلم" },
  { t: "فَمَنْ كَانَ يَرْجُو لِقَاءَ رَبِّهِ فَلْيَعْمَلْ عَمَلًا صَالِحًا", s: "الكهف: 110", q: true },
  { t: "كل سلامى من الناس عليه صدقة، كل يوم تطلع فيه الشمس", s: "متفق عليه" },
  { t: "وَلِكُلٍّ وِجْهَةٌ هُوَ مُوَلِّيهَا فَاسْتَبِقُوا الْخَيْرَاتِ", s: "البقرة: 148", q: true },
  { t: "إذا مات الإنسان انقطع عنه عمله إلا من ثلاثة: إلا من صدقة جارية، أو علم ينتفع به، أو ولد صالح يدعو له", s: "رواه مسلم" },
  { t: "إِنَّ الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ سَيَجْعَلُ لَهُمُ الرَّحْمَنُ وُدًّا", s: "مريم: 96", q: true },
  { t: "إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى", s: "متفق عليه" },
  { t: "هُوَ الَّذِي جَعَلَ لَكُمُ الْأَرْضَ ذَلُولًا فَامْشُوا فِي مَنَاكِبِهَا وَكُلُوا مِنْ رِزْقِهِ", s: "الملك: 15", q: true },
  { t: "كلكم راع وكلكم مسئول عن رعيته", s: "متفق عليه" },
  { t: "وَمَا تَفْعَلُوا مِنْ خَيْرٍ يَعْلَمْهُ اللَّهُ", s: "البقرة: 197", q: true },
  { t: "المؤمن القوي خير وأحب إلى الله من المؤمن الضعيف", s: "رواه مسلم" },
  { t: "يَا أَيُّهَا الَّذِينَ آمَنُوا اسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ إِنَّ اللَّهَ مَعَ الصَّابِرِينَ", s: "البقرة: 153", q: true },
  { t: "إِنَّمَا يُوَفَّى الصَّابِرُونَ أَجْرَهُمْ بِغَيْرِ حِسَابٍ", s: "الزمر: 10", q: true },
  { t: "عجباً لأمر المؤمن إن أمره كله خير… وإن أصابته ضراء صبر فكان خيراً له", s: "رواه مسلم" },
  { t: "وَلَمَنْ صَبَرَ وَغَفَرَ إِنَّ ذَلِكَ لَمِنْ عَزْمِ الْأُمُورِ", s: "الشورى: 43", q: true },
  { t: "فَاصْبِرْ إِنَّ وَعْدَ اللَّهِ حَقٌّ وَلَا يَسْتَخِفَّنَّكَ الَّذِينَ لَا يُوقِنُونَ", s: "الروم: 60", q: true },
  { t: "ومن يتصبر يصبره الله، وما أعطي أحد عطاء خيرا وأوسع من الصبر", s: "متفق عليه" },
  { t: "وَبَشِّرِ الصَّابِرِينَ * الَّذِينَ إِذَا أَصَابَتْهُمْ مُصِيبَةٌ قَالُوا إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ", s: "البقرة: 155-156", q: true },
  { t: "وَاللَّهُ يُحِبُّ الصَّابِرِينَ", s: "آل عمران: 146", q: true },
  { t: "وَاصْبِرْ وَمَا صَبْرُكَ إِلَّا بِاللَّهِ", s: "النحل: 127", q: true },
  { t: "ما يصيب المسلم من نصب ولا وصب ولا هم ولا حزن ولا أذى ولا غم إلا كفر الله بها من خطاياه", s: "متفق عليه" },
  { t: "فَاصْبِرْ صَبْرًا جَمِيلًا", s: "المعارج: 5", q: true },
  { t: "وَاصْبِرْ لِحُكْمِ رَبِّكَ فَإِنَّكَ بِأَعْيُنِنَا", s: "الطور: 48", q: true },
  { t: "إِنَّهُ مَنْ يَتَّقِ وَيَصْبِرْ فَإِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ الْمُحْسِنِينَ", s: "يوسف: 90", q: true },
  { t: "الصبر ضياء", s: "رواه مسلم" },
  { t: "وَلَنَبْلُوَنَّكُمْ بِشَيْءٍ مِنَ الْخَوْفِ وَالْجُوعِ وَنَقْصٍ مِنَ الْأَمْوَالِ وَالْأَنْفُسِ وَالثَّمَرَاتِ", s: "البقرة: 155", q: true },
  { t: "يَا أَيُّهَا الَّذِينَ آمَنُوا اصْبِرُوا وَصَابِرُوا وَرَابِطُوا وَاتَّقُوا اللَّهَ لَعَلَّكُمْ تُفْلِحُونَ", s: "آل عمران: 200", q: true },
  { t: "إن عظم الجزاء مع عظم البلاء", s: "رواه الترمذي" },
  { t: "وَجَعَلْنَا مِنْهُمْ أَئِمَّةً يَهْدُونَ بِأَمْرِنَا لَمَّا صَبَرُوا", s: "السجدة: 24", q: true },
  { t: "وَلَنَجْزِيَنَّ الَّذِينَ صَبَرُوا أَجْرَهُمْ بِأَحْسَنِ مَا كَانُوا يَعْمَلُونَ", s: "النحل: 96", q: true },
  { t: "فَاصْبِرْ كَمَا صَبَرَ أُولُو الْعَزْمِ مِنَ الرُّسُلِ", s: "الأحقاف: 35", q: true },
  { t: "لا يزال البلاء بالمؤمن والمؤمنة في جسده، أو في ماله، أو في ولده حتى يلقى الله سبحانه وما عليه خطيئة", s: "رواه أحمد" },
  { t: "وَتِلْكَ الْأَيَّامُ نُدَاوِلُهَا بَيْنَ النَّاسِ", s: "آل عمران: 140", q: true },
  { t: "أَمْ حَسِبْتُمْ أَنْ تَدْخُلُوا الْجَنَّةَ وَلَمَّا يَأْتِكُمْ مَثَلُ الَّذِينَ خَلَوْا مِنْ قَبْلِكُمْ", s: "البقرة: 214", q: true },
  { t: "واعلم أن النصر مع الصبر، وأن الفرج مع الكرب، وأن مع العسر يسراً", s: "رواه أحمد" },
  { t: "فَإِنَّ مَعَ الْعُسْرِ يُسْرًا * إِنَّ مَعَ الْعُسْرِ يُسْرًا", s: "الشرح: 5-6", q: true },
  { t: "سَيَجْعَلُ اللَّهُ بَعْدَ عُسْرٍ يُسْرًا", s: "الطلاق: 7", q: true },
  { t: "إِنِّي جَزَيْتُهُمُ الْيَوْمَ بِمَا صَبَرُوا أَنَّهُمْ هُمُ الْفَائِزُونَ", s: "المؤمنون: 111", q: true },
  { t: "سَلَامٌ عَلَيْكُمْ بِمَا صَبَرْتُمْ فَنِعْمَ عُقْبَى الدَّارِ", s: "الرعد: 24", q: true },
  { t: "وَمَا يُلَقَّاهَا إِلَّا الَّذِينَ صَبَرُوا وَمَا يُلَقَّاهَا إِلَّا ذُو حَظٍّ عَظِيمٍ", s: "فصلت: 35", q: true },
  { t: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ وَإِنَّهَا لَكَبِيرَةٌ إِلَّا عَلَى الْخَاشِعِينَ", s: "البقرة: 45", q: true },
  { t: "فَصَبْرٌ جَمِيلٌ وَاللَّهُ الْمُسْتَعَانُ عَلَى مَا تَصِفُونَ", s: "يوسف: 18", q: true },
  { t: "المؤمن الذي يخالط الناس ويصبر على أذاهم خير من المؤمن الذي لا يخالط الناس ولا يصبر على أذاهم", s: "رواه ابن ماجه" },
  { t: "إِلَّا الَّذِينَ صَبَرُوا وَعَمِلُوا الصَّالِحَاتِ أُولَئِكَ لَهُمْ مَغْفِرَةٌ وَأَجْرٌ كَبِيرٌ", s: "هود: 11", q: true },
  { t: "وَمَنْ يَتَّقِ اللَّهَ يَجْعَلْ لَهُ مَخْرَجًا * وَيَرْزُقْهُ مِنْ حَيْثُ لَا يَحْتَسِبُ", s: "الطلاق: 2-3", q: true },
  { t: "وَمَنْ يَتَّقِ اللَّهَ يَجْعَلْ لَهُ مِنْ أَمْرِهِ يُسْرًا", s: "الطلاق: 4", q: true },
  { t: "اتق الله حيثما كنت، وأتبع السيئة الحسنة تمحها، وخالق الناس بخلق حسن", s: "رواه الترمذي" },
  { t: "وَلَوْ أَنَّ أَهْلَ الْقُرَى آمَنُوا وَاتَّقَوْا لَفَتَحْنَا عَلَيْهِمْ بَرَكَاتٍ مِنَ السَّمَاءِ وَالْأَرْضِ", s: "الأعراف: 96", q: true },
  { t: "يَا أَيُّهَا الَّذِينَ آمَنُوا إِنْ تَتَّقُوا اللَّهَ يَجْعَلْ لَكُمْ فُرْقَانًا", s: "الأنفال: 29", q: true },
  { t: "احفظ الله يحفظك، احفظ الله تجده تجاهك", s: "رواه الترمذي" },
  { t: "إِنَّ الْمُتَّقِينَ فِي جَنَّاتٍ وَنَهَرٍ * فِي مَقْعَدِ صِدْقٍ عِنْدَ مَلِيكٍ مُقْتَدِرٍ", s: "القمر: 54-55", q: true },
  { t: "وَاتَّقُوا اللَّهَ وَيُعَلِّمُكُمُ اللَّهُ وَاللَّهُ بِكُلِّ شَيْءٍ عَلِيمٌ", s: "البقرة: 282", q: true },
  { t: "لا تحقرن من المعروف شيئا ولو أن تلقى أخاك بوجه طلق", s: "رواه مسلم" },
  { t: "وَسَارِعُوا إِلَى مَغْفِرَةٍ مِنْ رَبِّكُمْ وَجَنَّةٍ عَرْضُهَا السَّمَاوَاتُ وَالْأَرْضُ أُعِدَّتْ لِلْمُتَّقِينَ", s: "آل عمران: 133", q: true },
  { t: "إِنَّ أَكْرَمَكُمْ عِنْدَ اللَّهِ أَتْقَاكُمْ إِنَّ اللَّهَ عَلِيمٌ خَبِيرٌ", s: "الحجرات: 13", q: true },
  { t: "إن الله لا ينظر إلى صوركم وأموالكم، ولكن ينظر إلى قلوبكم وأعمالكم", s: "رواه مسلم" },
  { t: "يَا أَيُّهَا النَّاسُ اتَّقُوا رَبَّكُمْ إِنَّ زَلْزَلَةَ السَّاعَةِ شَيْءٌ عَظِيمٌ", s: "الحج: 1", q: true },
  { t: "وَاتَّقُوا يَوْمًا تُرْجَعُونَ فِيهِ إِلَى اللَّهِ ثُمَّ تُوَفَّى كُلُّ نَفْسٍ مَا كَسَبَتْ وَهُمْ لَا يُظْلَمُونَ", s: "البقرة: 281", q: true },
  { t: "تِلْكَ الْجَنَّةُ الَّتِي نُورِثُ مِنْ عِبَادِنَا مَنْ كَانَ تَقِيًّا", s: "مريم: 63", q: true },
  { t: "من بطأ به عمله لم يسرع به نسبه", s: "رواه مسلم" },
  { t: "إِنَّمَا يَتَقَبَّلُ اللَّهُ مِنَ الْمُتَّقِينَ", s: "المائدة: 27", q: true },
  { t: "وَالَّذِينَ اتَّقَوْا فَوْقَهُمْ يَوْمَ الْقِيَامَةِ", s: "البقرة: 212", q: true },
  { t: "إن الدين يسر، ولن يشاد الدين أحد إلا غلبه، فسددوا وقاربوا، وأبشروا", s: "رواه البخاري" },
  { t: "أَلَا إِنَّ أَوْلِيَاءَ اللَّهِ لَا خَوْفٌ عَلَيْهِمْ وَلَا هُمْ يَحْزَنُونَ * الَّذِينَ آمَنُوا وَكَانُوا يَتَّقُونَ", s: "يونس: 62-63", q: true },
  { t: "فَأَمَّا مَنْ أَعْطَى وَاتَّقَى * وَصَدَّقَ بِالْحُسْنَى * فَسَنُيَسِّرُهُ لِلْيُسْرَى", s: "الليل: 5-7", q: true },
  { t: "استعن بالله ولا تعجز", s: "رواه مسلم" },
  { t: "لِلَّذِينَ أَحْسَنُوا فِي هَذِهِ الدُّنْيَا حَسَنَةٌ وَلَدَارُ الْآخِرَةِ خَيْرٌ وَلَنِعْمَ دَارُ الْمُتَّقِينَ", s: "النحل: 30", q: true },
  { t: "وَقِيلَ لِلَّذِينَ اتَّقَوْا مَاذَا أَنْزَلَ رَبُّكُمْ قَالُوا خَيْرًا", s: "النحل: 30", q: true },
  { t: "لا حسد إلا في اثنتين: رجل آتاه الله مالا فسلط على هلكته في الحق، ورجل آتاه الله الحكمة فهو يقضي بها ويعلمها", s: "رواه البخاري" },
  { t: "وَالْعَاقِبَةُ لِلْمُتَّقِينَ", s: "القصص: 83", q: true },
  { t: "يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللَّهَ وَقُولُوا قَوْلًا سَدِيدًا * يُصْلِحْ لَكُمْ أَعْمَالَكُمْ", s: "الأحزاب: 70-71", q: true },
  { t: "وَمَنْ يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ", s: "الطلاق: 3", q: true },
  { t: "فَاتَّقُوا اللَّهَ مَا اسْتَطَعْتُمْ وَاسْمَعُوا وَأَطِيعُوا وَأَنْفِقُوا خَيْرًا لِأَنْفُسِكُمْ", s: "التغابن: 16", q: true },
  { t: "وَلِبَاسُ التَّقْوَى ذَلِكَ خَيْرٌ", s: "الأعراف: 26", q: true },
  { t: "إن الله عز وجل يبسط يده بالليل ليتوب مسيء النهار", s: "رواه مسلم" },
  { t: "يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللَّهَ وَلْتَنْظُرْ نَفْسٌ مَا قَدَّمَتْ لِغَدٍ", s: "الحشر: 18", q: true },
  { t: "وَمَنْ يُطِعِ اللَّهَ وَرَسُولَهُ وَيَخْشَ اللَّهَ وَيَتَّقْهِ فَأُولَئِكَ هُمُ الْفَائِزُونَ", s: "النور: 52", q: true },
];

// deterministic shuffle so every text is seen once before any repeats
function dailyText(key) {
  const dayNum = Math.floor(keyToDate(key).getTime() / 86400000);
  const n = DAILY_TEXTS.length;
  const cycle = Math.floor(dayNum / n);
  const pos = ((dayNum % n) + n) % n;
  const deck = DAILY_TEXTS.map((_, i) => i);
  let seed = (cycle + 1) * 9301 + 49297;
  for (let i = n - 1; i > 0; i--) {           // seeded Fisher–Yates
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return DAILY_TEXTS[deck[pos]];
}

function DailyVerse({ dayKeyStr, onDismiss }) {
  const [leaving, setLeaving] = useState(false);
  const item = dailyText(dayKeyStr);
  const close = () => { setLeaving(true); setTimeout(onDismiss, 260); };
  return (
    <button onClick={close} style={{
      position: "absolute", left: 16, right: 16, bottom: 18, zIndex: 15,
      background: "rgba(12,20,34,.93)", backdropFilter: "blur(14px)",
      border: "1px solid rgba(59,156,255,.28)", borderRadius: 18,
      padding: "15px 17px 13px", cursor: "pointer", textAlign: "center",
      boxShadow: "0 12px 40px rgba(0,0,0,.5), 0 0 30px rgba(59,156,255,.12)",
      animation: leaving ? "verseOut .26s ease-in forwards" : "verseIn .5s cubic-bezier(.2,.9,.3,1)",
    }}>
      <div dir="rtl" style={{
        color: item.q ? T.blueHi : T.text, fontSize: item.t.length > 90 ? 14.5 : 16.5,
        lineHeight: 1.95, fontWeight: 500,
        fontFamily: "'Amiri', 'Scheherazade New', 'Traditional Arabic', Georgia, serif",
      }}>
        {item.q ? `﴿${item.t}﴾` : `«${item.t}»`}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 }}>
        <span style={{ height: 1, width: 20, background: "rgba(255,255,255,.16)" }} />
        <span dir="rtl" style={{ color: T.muted, fontSize: 11.5, fontWeight: 600 }}>{item.s}</span>
        <span style={{ height: 1, width: 20, background: "rgba(255,255,255,.16)" }} />
      </div>
      <div style={{ color: T.dim, fontSize: 10.5, marginTop: 8 }}>tap to dismiss</div>
    </button>
  );
}

const PRINCIPLES = [
  {
    n: 1,
    title: `Remove the desire — don't fight it`,
    fragile: `Grit your teeth and resist the urge, every day, forever.`,
    solid: `Dismantle the desire itself — with nothing wanted, there's nothing to resist.`,
    desc: `Willpower is a tug-of-war you must win every single day. That's fragile — one bad night and you lose. The strong version kills the desire itself, so there's no rope to pull in the first place.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="Tug of war versus no rope at all">
        <circle cx="28" cy="40" r="9" fill="none" stroke="#B4552D" strokeWidth="2" />
        <circle cx="118" cy="40" r="9" fill="none" stroke="#B4552D" strokeWidth="2" />
        <path d="M38 40 l8 -5 8 10 8 -10 8 10 8 -10 8 10 8 -5" fill="none" stroke="#B4552D" strokeWidth="2" />
        <path d="M16 40 h-9 m4 -4 l-4 4 4 4" stroke="#B4552D" strokeWidth="1.6" fill="none" />
        <path d="M130 40 h9 m-4 -4 l4 4 -4 4" stroke="#B4552D" strokeWidth="1.6" fill="none" />
        <text x="73" y="70" fontSize="9.5" fill="#B4552D" fontWeight="700" textAnchor="middle">willpower: pull forever</text>
        <text x="73" y="84" fontSize="8" fill="#B4552D" fontWeight="700" textAnchor="middle">(fragile — one bad night loses)</text>
        <line x1="150" y1="14" x2="150" y2="90" stroke="#DCE7E2" />
        <circle cx="225" cy="40" r="9" fill="none" stroke="#177E6B" strokeWidth="2" />
        <path d="M245 36 l5 6 9 -11" fill="none" stroke="#177E6B" strokeWidth="2.4" strokeLinecap="round" />
        <text x="225" y="70" fontSize="9.5" fill="#177E6B" fontWeight="700" textAnchor="middle">desire removed: no rope</text>
        <text x="225" y="84" fontSize="8" fill="#177E6B" fontWeight="700" textAnchor="middle">(nothing left to fight)</text>
      </svg>
    ),
  },
  {
    n: 2,
    title: `I'm giving up nothing`,
    fragile: `Quitting is a sacrifice I have to endure.`,
    solid: `No pleasure lost, no relief lost — a parasite is removed, not a gift.`,
    desc: `The losing side of the scale is empty. Nothing sacrificed means nothing to endure, and nothing left for willpower to do.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="Scale showing nothing lost, much gained">
        <path d="M142 78 l8 -14 8 14 z" fill="#4E6660" />
        <line x1="75" y1="42" x2="225" y2="58" stroke="#16302B" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="75" y1="42" x2="75" y2="52" stroke="#4E6660" strokeWidth="1.4" />
        <circle cx="75" cy="62" r="12" fill="none" stroke="#4E6660" strokeWidth="1.6" strokeDasharray="3 3" />
        <text x="75" y="65.5" fontSize="11" fill="#4E6660" fontWeight="700" textAnchor="middle">0</text>
        <text x="75" y="90" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">what you lose</text>
        <line x1="225" y1="58" x2="225" y2="66" stroke="#4E6660" strokeWidth="1.4" />
        <circle cx="225" cy="76" r="13" fill="#E1EFEA" stroke="#177E6B" strokeWidth="2" />
        <text x="225" y="80" fontSize="14" fill="#177E6B" fontWeight="700" textAnchor="middle">+</text>
        <text x="225" y="99" fontSize="8.5" fill="#177E6B" fontWeight="700" textAnchor="middle">time · energy · confidence · you</text>
        <text x="150" y="16" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">the honest accounting</text>
      </svg>
    ),
  },
  {
    n: 3,
    title: `There's no such thing as one peek`,
    fragile: `One peek is harmless if I'm mostly clean.`,
    solid: `One peek doesn't satisfy the craving — it reinstalls the whole trap.`,
    desc: `A peek refeeds the Little Monster and tells the Big Monster the old lie is still true. The only real choice on the table is trap or freedom — nothing in between.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="One peek leads back to the whole trap">
        <circle cx="30" cy="46" r="3.5" fill="#DEA02C" />
        <text x="30" y="72" fontSize="8.5" fill="#B57F1A" fontWeight="700" textAnchor="middle">1 peek</text>
        <path d="M42 46 h18 m-5 -4 l5 4 -5 4" stroke="#4E6660" strokeWidth="1.4" fill="none" />
        <circle cx="86" cy="46" r="7" fill="none" stroke="#B57F1A" strokeWidth="2" />
        <text x="86" y="72" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">craving</text>
        <path d="M100 46 h18 m-5 -4 l5 4 -5 4" stroke="#4E6660" strokeWidth="1.4" fill="none" />
        <circle cx="146" cy="46" r="11" fill="none" stroke="#B4552D" strokeWidth="2" />
        <text x="146" y="72" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">habit</text>
        <path d="M164 46 h18 m-5 -4 l5 4 -5 4" stroke="#4E6660" strokeWidth="1.4" fill="none" />
        <rect x="198" y="24" width="76" height="44" rx="6" fill="none" stroke="#B4552D" strokeWidth="2" />
        <line x1="212" y1="24" x2="212" y2="68" stroke="#B4552D" strokeWidth="1.2" />
        <line x1="226" y1="24" x2="226" y2="68" stroke="#B4552D" strokeWidth="1.2" />
        <line x1="240" y1="24" x2="240" y2="68" stroke="#B4552D" strokeWidth="1.2" />
        <line x1="254" y1="24" x2="254" y2="68" stroke="#B4552D" strokeWidth="1.2" />
        <text x="236" y="84" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">the whole trap, back</text>
        <text x="150" y="14" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">a peek is never small</text>
      </svg>
    ),
  },
  {
    n: 4,
    title: `Pangs are the monster dying`,
    fragile: `A craving means something is wrong with me.`,
    solid: `A pang is the parasite starving — it's what healing feels like.`,
    desc: `Withdrawal isn't damage, it's healing you can feel. Reframed this way, the same sensation flips from threat to victory sound.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="Pang strength fading to zero over 21 days">
        <line x1="22" y1="76" x2="282" y2="76" stroke="#4E6660" strokeWidth="1.2" />
        <line x1="22" y1="76" x2="22" y2="80" stroke="#4E6660" /><text x="22" y="92" fontSize="8" fill="#4E6660" fontWeight="700" textAnchor="middle">0</text>
        <line x1="105" y1="76" x2="105" y2="80" stroke="#4E6660" /><text x="105" y="92" fontSize="8" fill="#4E6660" fontWeight="700" textAnchor="middle">7</text>
        <line x1="188" y1="76" x2="188" y2="80" stroke="#4E6660" /><text x="188" y="92" fontSize="8" fill="#4E6660" fontWeight="700" textAnchor="middle">14</text>
        <line x1="270" y1="76" x2="270" y2="80" stroke="#4E6660" /><text x="262" y="92" fontSize="8" fill="#4E6660" fontWeight="700" textAnchor="middle">21 days</text>
        <path d="M25 26 C 80 30, 120 58, 200 72 S 260 75, 275 75.5" fill="none" stroke="#177E6B" strokeWidth="2.2" />
        <circle cx="40" cy="29" r="7" fill="#B4552D" opacity="0.85" />
        <circle cx="100" cy="44" r="5" fill="#B4552D" opacity="0.6" />
        <circle cx="160" cy="63" r="3.5" fill="#B4552D" opacity="0.4" />
        <circle cx="215" cy="72" r="2" fill="#B4552D" opacity="0.25" />
        <text x="252" y="62" fontSize="9.5" fill="#177E6B" fontWeight="700" textAnchor="middle">✕ starved</text>
        <text x="70" y="14" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="start">pang strength while the monster dies</text>
      </svg>
    ),
  },
  {
    n: 5,
    title: `The itch is tiny — the belief makes it loud`,
    fragile: `This feeling is powerful and I must fight it.`,
    solid: `The body's pang is barely an itch — only the belief translates it into "I need it."`,
    desc: `Dismantle the belief and the itch loses its voice entirely — it goes back to being a passing sensation, no more commanding than a stomach rumble.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="A tiny itch amplified by a loud installed belief">
        <circle cx="36" cy="48" r="3.5" fill="#16302B" />
        <text x="36" y="74" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">the itch</text>
        <text x="36" y="86" fontSize="7.5" fill="#4E6660" fontWeight="700" textAnchor="middle">(tiny, physical)</text>
        <path d="M62 42 v12 l62 18 v-48 z" fill="#FBF1DC" stroke="#DEA02C" strokeWidth="1.6" />
        <text x="95" y="52" fontSize="8.5" fill="#B57F1A" fontWeight="700" textAnchor="middle">belief</text>
        <path d="M202 34 l14 8 16 -6 -4 14 12 10 -16 3 -3 15 -12 -10 -15 6 5 -14 -11 -11 15 -2 z" fill="none" stroke="#B4552D" strokeWidth="1.8" />
        <text x="215" y="62" fontSize="9" fill="#B4552D" fontWeight="700" textAnchor="middle">"I NEED IT"</text>
        <text x="215" y="88" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">the lie (loud)</text>
        <text x="95" y="20" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="start">kill the translator, not yourself</text>
      </svg>
    ),
  },
  {
    n: 6,
    title: `Decide once — never doubt`,
    fragile: `Re-decide every night when the pang argues its case.`,
    solid: `Settled once, by you, at your clearest — 1 a.m. adds no new facts.`,
    desc: `The decision was made with every fact on the table. So doubt gets a standing answer: this case is closed, and it doesn't reopen on the monster's request.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="A settled decision versus a 1am doubt with no new information">
        <circle cx="66" cy="44" r="23" fill="#E1EFEA" stroke="#177E6B" strokeWidth="2.4" />
        <path d="M55 44 l8 9 15 -18" fill="none" stroke="#177E6B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M56 65 l-6 18 12 -7 M76 65 l6 18 -12 -7" fill="none" stroke="#177E6B" strokeWidth="2" />
        <text x="66" y="99" fontSize="8.5" fill="#177E6B" fontWeight="700" textAnchor="middle">decided once, at your clearest</text>
        <circle cx="185" cy="40" r="12" fill="none" stroke="#4E6660" strokeWidth="1.6" />
        <path d="M185 33 v7 l5 4" fill="none" stroke="#4E6660" strokeWidth="1.6" />
        <text x="233" y="44" fontSize="9" fill="#4E6660" fontWeight="700" textAnchor="middle">1 a.m. doubts</text>
        <line x1="168" y1="30" x2="270" y2="52" stroke="#B4552D" strokeWidth="2" />
        <text x="222" y="70" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">no new information</text>
      </svg>
    ),
  },
  {
    n: 7,
    title: `Freedom starts at the vow`,
    fragile: `Count the days and wait to "become" free someday.`,
    solid: `Freedom starts at day zero — withdrawal happens on the free side of the gate.`,
    desc: `Not after 21 days, not at a milestone. You're free the moment you walk out the gate; the rest is just the body catching up.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="Freedom begins at day zero, the vow, not at day 21">
        <line x1="25" y1="58" x2="278" y2="58" stroke="#4E6660" strokeWidth="1.4" />
        <line x1="48" y1="54" x2="48" y2="62" stroke="#16302B" strokeWidth="2" />
        <line x1="240" y1="54" x2="240" y2="62" stroke="#4E6660" strokeWidth="1.4" />
        <line x1="48" y1="54" x2="48" y2="20" stroke="#B57F1A" strokeWidth="2" />
        <path d="M48 20 l30 6 -30 6 z" fill="#DEA02C" />
        <text x="52" y="14" fontSize="9" fill="#B57F1A" fontWeight="700" textAnchor="start">FREE — the vow, day 0</text>
        <text x="48" y="76" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">0</text>
        <text x="240" y="76" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">~21</text>
        <path d="M60 40 h172" stroke="#177E6B" strokeWidth="1.4" strokeDasharray="4 4" />
        <text x="146" y="94" fontSize="8.5" fill="#177E6B" fontWeight="700" textAnchor="middle">monster starving — on the free side of the gate</text>
        <text x="258" y="44" fontSize="8.5" fill="#177E6B" fontWeight="700" textAnchor="middle">✕ gone</text>
      </svg>
    ),
  },
  {
    n: 8,
    title: `No side doors`,
    fragile: `Cutting down, substitutes, or "only sometimes" feel like safe compromises.`,
    solid: `Every side door keeps both monsters alive — none of them lead anywhere but back in.`,
    desc: `There's one exit, not a hallway of half-measures. They all stay shut — gladly, because there's nothing behind any of them worth having.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="Cutting down, substitutes, and sometimes are all closed doors">
        <g>
          <rect x="20" y="26" width="50" height="52" rx="4" fill="none" stroke="#4E6660" strokeWidth="1.6" />
          <circle cx="62" cy="52" r="1.8" fill="#4E6660" />
          <line x1="28" y1="34" x2="62" y2="70" stroke="#B4552D" strokeWidth="2.2" />
          <line x1="62" y1="34" x2="28" y2="70" stroke="#B4552D" strokeWidth="2.2" />
          <text x="45" y="92" fontSize="8" fill="#4E6660" fontWeight="700" textAnchor="middle">cut down</text>
        </g>
        <g>
          <rect x="88" y="26" width="50" height="52" rx="4" fill="none" stroke="#4E6660" strokeWidth="1.6" />
          <circle cx="130" cy="52" r="1.8" fill="#4E6660" />
          <line x1="96" y1="34" x2="130" y2="70" stroke="#B4552D" strokeWidth="2.2" />
          <line x1="130" y1="34" x2="96" y2="70" stroke="#B4552D" strokeWidth="2.2" />
          <text x="113" y="92" fontSize="8" fill="#4E6660" fontWeight="700" textAnchor="middle">substitute</text>
        </g>
        <g>
          <rect x="156" y="26" width="50" height="52" rx="4" fill="none" stroke="#4E6660" strokeWidth="1.6" />
          <circle cx="198" cy="52" r="1.8" fill="#4E6660" />
          <line x1="164" y1="34" x2="198" y2="70" stroke="#B4552D" strokeWidth="2.2" />
          <line x1="198" y1="34" x2="164" y2="70" stroke="#B4552D" strokeWidth="2.2" />
          <text x="181" y="92" fontSize="8" fill="#4E6660" fontWeight="700" textAnchor="middle">'sometimes'</text>
        </g>
        <rect x="234" y="26" width="46" height="52" rx="4" fill="#FBF1DC" stroke="#DEA02C" strokeWidth="2" />
        <path d="M247 52 h16 m-6 -5 l6 5 -6 5" stroke="#B57F1A" strokeWidth="2" fill="none" />
        <text x="257" y="92" fontSize="8" fill="#B57F1A" fontWeight="700" textAnchor="middle">the way out</text>
        <text x="150" y="16" fontSize="8.5" fill="#4E6660" fontWeight="700" textAnchor="middle">side doors keep the monsters alive</text>
      </svg>
    ),
  },
  {
    n: 9,
    title: `It causes the void it claims to fill`,
    fragile: `It relieves my stress and fills a real need.`,
    solid: `The "relief" only relieves the itch the last session created.`,
    desc: `Use → dip → itch → "relief" — a closed loop with no outside power source. Step outside it once, and it has nothing left to run on.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="The use, dip, itch, relief loop broken by stepping outside it">
        <path d="M118 50 a34 34 0 1 1 -10 -24" fill="none" stroke="#B4552D" strokeWidth="2" />
        <path d="M108 26 l4 -8 m-4 8 l8 2" stroke="#B4552D" strokeWidth="1.6" fill="none" />
        <text x="84" y="10" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">use</text>
        <text x="132" y="38" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">dip</text>
        <text x="84" y="98" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">itch</text>
        <text x="36" y="38" fontSize="8.5" fill="#B4552D" fontWeight="700" textAnchor="middle">"relief"</text>
        <path d="M122 52 h130 m-8 -5 l8 5 -8 5" stroke="#177E6B" strokeWidth="2" fill="none" />
        <text x="200" y="42" fontSize="8.5" fill="#177E6B" fontWeight="700" textAnchor="middle">step out once — loop loses power</text>
        <path d="M258 46 l5 6 9 -11" fill="none" stroke="#177E6B" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    n: 10,
    title: `Live fully — hide from nothing`,
    fragile: `Avoid being alone, avoid the phone at night, avoid, avoid, avoid.`,
    solid: `A free person meets boredom, stress, and solitude like weather — nothing to resist.`,
    desc: `Bunker strategies quietly admit the thing is still precious. It isn't. Live completely; there's nothing left that needs to be kept from you.`,
    svg: (
      <svg viewBox="0 0 300 104" role="img" aria-label="A free person meeting boredom and solitude like weather">
        <line x1="18" y1="70" x2="282" y2="70" stroke="#4E6660" strokeWidth="1.4" />
        <path d="M118 70 a32 32 0 0 1 64 0 z" fill="#FBF1DC" stroke="#DEA02C" strokeWidth="2" />
        <line x1="150" y1="24" x2="150" y2="12" stroke="#DEA02C" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="118" y1="38" x2="108" y2="28" stroke="#DEA02C" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="182" y1="38" x2="192" y2="28" stroke="#DEA02C" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="104" y1="58" x2="90" y2="54" stroke="#DEA02C" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="196" y1="58" x2="210" y2="54" stroke="#DEA02C" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="242" cy="46" r="6" fill="none" stroke="#177E6B" strokeWidth="2" />
        <line x1="242" y1="52" x2="242" y2="66" stroke="#177E6B" strokeWidth="2" />
        <path d="M242 56 l-9 -7 M242 56 l9 -7" stroke="#177E6B" strokeWidth="2" strokeLinecap="round" />
        <text x="150" y="92" fontSize="8.5" fill="#177E6B" fontWeight="700" textAnchor="middle">boredom, stress, solitude — just weather now</text>
      </svg>
    ),
  },
];

function PrincipleCard({ p }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #DCE7E2", borderRadius: 16, padding: "16px 16px 18px", marginBottom: 13 }}>
      <div style={{ marginBottom: 2 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 7, background: "#E1EFEA", color: "#0F5A4C", fontSize: 11, fontWeight: 800, marginRight: 9, verticalAlign: "middle" }}>{p.n}</span>
        <span style={{ fontSize: 16.5, fontWeight: 700, color: "#16302B", verticalAlign: "middle", lineHeight: 1.3 }}>{p.title}</span>
      </div>
      <div style={{ margin: "12px 0 10px", borderRadius: 10, overflow: "hidden", background: "#F3F7F5" }}>{p.svg}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <div style={{ borderRadius: 9, padding: "9px 10px" }}>
          <span style={{ display: "block", fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#B4552D", marginBottom: 3 }}>Fragile</span>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: "#8A4429" }}>{p.fragile}</span>
        </div>
        <div style={{ borderRadius: 9, padding: "9px 10px", background: "#E1EFEA" }}>
          <span style={{ display: "block", fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#177E6B", marginBottom: 3 }}>Solid</span>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: "#0F5A4C" }}>{p.solid}</span>
        </div>
      </div>
      <p style={{ fontSize: 13, color: "#2B443E", lineHeight: 1.65, margin: 0 }}>{p.desc}</p>
    </div>
  );
}

function PrinciplesBook() {
  return (
    <div style={{ background: "#F3F7F5", borderRadius: 18, padding: "18px 12px 8px" }}>
      <div style={{ textAlign: "center", marginBottom: 16, padding: "0 8px" }}>
        <div style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: "#177E6B", fontWeight: 700, marginBottom: 6 }}>Bedrock Principles</div>
        <p style={{ fontSize: 12.5, color: "#4E6660", lineHeight: 1.6, margin: "0 auto", maxWidth: 340 }}>
          Ten load-bearing ideas — each true whether or not you feel strong today. Fragile principles collapse at the first bad night, so none of them made this list.
        </p>
      </div>
      {PRINCIPLES.map((p) => <PrincipleCard key={p.n} p={p} />)}
      <div style={{ textAlign: "center", fontSize: 11, color: "#4E6660", padding: "6px 10px 16px", lineHeight: 1.6 }}>
        A principle only belongs on this list if it's true whether or not you feel strong today.
      </div>
    </div>
  );
}

function NoteModal({ task, onClose, onEdit }) {
  const meta = KIND[task.kind];
  const rich = task.richContent === "principles";
  const [asText, setAsText] = useState(false);
  const showText = !rich || asText;

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(3,7,14,.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 35 }}>
      <div style={{ width: "100%", maxWidth: 460, background: T.bg2, border: `1px solid ${T.cardLine}`, borderRadius: "24px 24px 0 0", padding: rich && !showText ? "22px 14px" : 22, maxHeight: "88%", overflowY: "auto", animation: "pop .25s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 14, padding: rich && !showText ? "0 8px" : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <BookOpen size={17} color={meta.tint} style={{ flexShrink: 0 }} />
            <span style={{ color: T.text, fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
            {task.fixed && <Pin size={13} color={T.dim} style={{ flexShrink: 0 }} />}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", flexShrink: 0 }}><X size={22} /></button>
        </div>

        {showText ? (
          <div style={{ color: T.muted, fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{rich ? PRINCIPLES_NOTE : task.note}</div>
        ) : (
          <PrinciplesBook />
        )}

        <div style={{ padding: rich && !showText ? "4px 8px 0" : 0, display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
          {rich && (
            <button onClick={() => setAsText((v) => !v)} style={{ width: "100%", background: "rgba(255,255,255,.06)", color: T.text, border: `1px solid ${T.cardLine}`, borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <Quote size={14} /> {showText ? "Show illustrated" : "Show as plain text"}
            </button>
          )}
          <button onClick={onEdit} style={{ width: "100%", background: "rgba(255,255,255,.06)", color: T.text, border: `1px solid ${T.cardLine}`, borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <Pencil size={14} /> Edit task
          </button>
        </div>
      </div>
    </div>
  );
}

function Mini({ icon, v, l }) {
  return (
    <div style={{ flex: 1, background: T.card, border: `1px solid ${T.cardLine}`, borderRadius: 14, padding: "13px 8px", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: T.text }}>
        <span style={{ color: T.blue }}>{icon}</span><span style={{ fontSize: 18, fontWeight: 600 }}>{v}</span>
      </div>
      <div style={{ color: T.muted, fontSize: 10.5, marginTop: 3 }}>{l}</div>
    </div>
  );
}

const inp = { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.05)", border: `1px solid ${T.cardLine}`, borderRadius: 11, padding: "12px 14px", fontSize: 15, color: T.text, outline: "none" };

function Shell({ title, onClose, children, footer }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(3,7,14,.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 30 }}>
      <div style={{ width: "100%", maxWidth: 460, background: T.bg2, border: `1px solid ${T.cardLine}`, borderRadius: "24px 24px 0 0", padding: 22, maxHeight: "92%", overflowY: "auto", animation: "pop .25s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ color: T.text, fontSize: 20, fontWeight: 500 }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer" }}><X size={22} /></button>
        </div>
        {children}{footer}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return <div style={{ marginBottom: 15 }}><div style={{ color: T.muted, fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>{label}</div>{children}</div>;
}
const dangerBtn = { width: "100%", marginTop: 10, background: "rgba(255,107,107,.1)", color: T.red, border: `1px solid rgba(255,107,107,.35)`, borderRadius: 12, padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 };

function SettingsModal({ settings, onChange, onClose, onAdvance, onReset, todayLabel }) {
  return (
    <Shell title="Settings" onClose={onClose}>
      <Field label="Day ends at">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={settings.dayEndHour} onChange={(e) => onChange({ ...settings, dayEndHour: Number(e.target.value) })} style={{ ...inp, flex: 1, appearance: "none" }}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h} style={{ background: T.bg2 }}>{fmtTime(h, 0).replace(":00", "")}</option>)}
          </select>
          <select value={settings.dayEndMin} onChange={(e) => onChange({ ...settings, dayEndMin: Number(e.target.value) })} style={{ ...inp, width: 100, appearance: "none" }}>
            {[0, 15, 30, 45].map((m) => <option key={m} value={m} style={{ background: T.bg2 }}>:{pad(m)}</option>)}
          </select>
        </div>
        <div style={{ color: T.dim, fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
          When the day ends, review your tasks and tap Submit day. Unmet daily DOs, unreached minimums, and clean Don't rewards settle then. Weekday, every-N and ×/week tasks settle when the week ends.
        </div>
      </Field>

      <div style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${T.cardLine}`, borderRadius: 13, padding: 14, marginBottom: 8 }}>
        <div style={{ color: T.muted, fontSize: 12, marginBottom: 10 }}>Current day: <b style={{ color: T.text }}>{todayLabel}</b></div>
        <button onClick={onAdvance} style={{ width: "100%", background: "rgba(59,156,255,.14)", color: T.blueHi, border: `1px solid rgba(59,156,255,.4)`, borderRadius: 12, padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <FastForward size={16} /> Skip ahead one day (test)
        </button>
      </div>

      <button onClick={onReset} style={dangerBtn}><Trash2 size={15} /> Reset all data</button>
    </Shell>
  );
}

function GoalModal({ initial, onClose, onSave, onDelete, canDelete }) {
  const [name, setName] = useState(initial?.name || "");
  const [target, setTarget] = useState(initial?.target || 1000);
  const ok = name.trim().length > 0;
  return (
    <Shell title={initial ? "Edit goal" : "New goal"} onClose={onClose} footer={
      <>
        <button onClick={() => ok && onSave({ name: name.trim(), target: Math.max(1, target) }, initial)} style={{ width: "100%", marginTop: 4, background: ok ? T.blue : "rgba(255,255,255,.08)", color: ok ? "#04101F" : T.dim, border: "none", borderRadius: 14, padding: "15px 0", fontSize: 15, fontWeight: 700, cursor: ok ? "pointer" : "default" }}>
          {initial ? "Save changes" : "Create goal"}
        </button>
        {initial && canDelete && <button onClick={() => onDelete(initial)} style={dangerBtn}><Trash2 size={15} /> Delete goal and its tasks</button>}
      </>}>
      <Field label="Goal name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Learn Spanish" style={inp} /></Field>
      <Field label="Target points"><NumStepper value={target} onChange={setTarget} min={1} max={999999} /></Field>
      {initial && <div style={{ color: T.dim, fontSize: 11.5, marginTop: -6, lineHeight: 1.5 }}>Achieved points stay as they are — changing the target just moves the finish line.</div>}
    </Shell>
  );
}

function TaskModal({ goalName, initial, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [points, setPoints] = useState(initial?.points ?? 20);
  const [unit, setUnit] = useState(initial?.unit || "min");
  const [minCount, setMinCount] = useState(initial?.minCount ?? 0);
  const [noteText, setNoteText] = useState(initial?.note || "");
  const [kind, setKind] = useState(initial?.kind || "do");
  const [mode, setMode] = useState(initial?.mode || "simple");
  const [sched, setSched] = useState(initial?.sched || "daily");
  const [cmode, setCmode] = useState(initial?.custom?.mode || "weekdays");
  const [days, setDays] = useState(initial?.custom?.days || [1, 3, 5]);
  const [everyN, setEveryN] = useState(initial?.custom?.everyN ?? 2);
  const [timesWk, setTimesWk] = useState(initial?.custom?.timesWk ?? 3);
  const ok = title.trim().length > 0;
  const isFixed = !!initial?.fixed;

  const seg = (v, cur, set, label) => (
    <button key={v} onClick={() => set(v)} style={{ flex: 1, padding: "10px 2px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: cur === v ? T.blue : "rgba(255,255,255,.06)", color: cur === v ? "#04101F" : T.muted }}>{label}</button>
  );
  const kindBtn = (k, name, note) => (
    <button onClick={() => setKind(k)} style={{ flex: 1, textAlign: "center", padding: "11px 4px", borderRadius: 12, cursor: "pointer", border: `1.5px solid ${kind === k ? KIND[k].tint : T.cardLine}`, background: kind === k ? `${KIND[k].tint}1F` : "rgba(255,255,255,.04)" }}>
      <div style={{ color: T.text, fontSize: 13, fontWeight: 700 }}>{name}</div>
      <div style={{ color: T.muted, fontSize: 10, marginTop: 2 }}>{note}</div>
    </button>
  );

  const mc = Math.max(0, minCount);
  const pv = Math.max(1, points);
  const showMin = mode === "repeat" && kind !== "dont";

  const save = () => {
    if (!ok) return;
    const t = { title: title.trim(), points: pv, kind: isFixed ? "do" : kind, mode, sched, note: noteText.trim() };
    if (isFixed) t.fixed = true;
    t.unit = mode === "count" ? (unit.trim() || "unit") : undefined;
    t.minCount = showMin ? mc : 0;
    t.custom = sched === "custom"
      ? (cmode === "weekdays" ? { mode: "weekdays", days } : cmode === "everyN" ? { mode: "everyN", everyN: Math.max(1, everyN) } : { mode: "timesWk", timesWk: Math.max(1, timesWk) })
      : undefined;
    onSave(t, initial);
  };

  const ptsLabel = mode === "repeat" ? "Points each time" : mode === "count" ? "Points per unit" : "Points";

  return (
    <Shell title={initial ? "Edit task" : "Add task"} onClose={onClose} footer={
      <>
        <button onClick={save} style={{ width: "100%", marginTop: 4, background: ok ? T.blue : "rgba(255,255,255,.08)", color: ok ? "#04101F" : T.dim, border: "none", borderRadius: 14, padding: "15px 0", fontSize: 15, fontWeight: 700, cursor: ok ? "pointer" : "default" }}>
          {initial ? "Save changes" : `Add to ${goalName}`}
        </button>
        {initial && !isFixed && <button onClick={() => onDelete(initial)} style={dangerBtn}><Trash2 size={15} /> Delete task</button>}
      </>}>
      <Field label="What's the task?"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 30-min run" style={inp} /></Field>

      <Field label="Category">
        {isFixed ? (
          <div style={{ display: "flex", alignItems: "center", gap: 9, background: `${T.amber}1A`, border: `1.5px solid ${T.amber}`, borderRadius: 12, padding: "11px 14px" }}>
            <Pin size={15} color={T.amber} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ color: T.text, fontSize: 13, fontWeight: 700 }}>DO · fixed</div>
              <div style={{ color: T.muted, fontSize: 11, marginTop: 2 }}>This task is pinned and can't be recategorized or deleted.</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            {kindBtn("do", "DO", "miss = −pts")}
            {kindBtn("better", "Better DO", "miss = nothing")}
            {kindBtn("dont", "Don't", "avoid = +pts")}
          </div>
        )}
      </Field>

      <Field label="Logging">
        <div style={{ display: "flex", gap: 7 }}>
          {seg("simple", mode, setMode, "Once")}
          {seg("repeat", mode, setMode, "Repetitive")}
          {seg("count", mode, setMode, "Countative")}
        </div>
        <div style={{ color: T.dim, fontSize: 11.5, marginTop: 8, lineHeight: 1.45 }}>
          {mode === "simple" && "A single check-off for the day."}
          {mode === "repeat" && "Log it as many times as it happens — each one moves your points."}
          {mode === "count" && "Log a quantity. Points = quantity × rate (e.g. 1 min = 1 point)."}
        </div>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}><Field label={ptsLabel}><NumStepper value={points} onChange={setPoints} min={1} max={9999} /></Field></div>
        {mode === "count" && <div style={{ flex: 1 }}><Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="min, page, rep" style={inp} /></Field></div>}
        {showMin && <div style={{ flex: 1 }}><Field label="Minimum per day"><NumStepper value={minCount} onChange={setMinCount} min={0} max={999} /></Field></div>}
      </div>

      <Field label="Repeat"><div style={{ display: "flex", gap: 7 }}>{seg("daily", sched, setSched, "Daily")}{seg("once", sched, setSched, "One-time")}{seg("custom", sched, setSched, "Custom")}</div></Field>
      {sched === "custom" && (
        <div style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${T.cardLine}`, borderRadius: 13, padding: 14, marginTop: -4 }}>
          <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>{seg("weekdays", cmode, setCmode, "Weekdays")}{seg("everyN", cmode, setCmode, "Every N")}{seg("timesWk", cmode, setCmode, "× / week")}</div>
          {cmode === "weekdays" && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              {DAYS.map((d, i) => (
                <button key={i} onClick={() => setDays((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort()))} style={{ width: 37, height: 37, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: days.includes(i) ? T.blue : "rgba(255,255,255,.07)", color: days.includes(i) ? "#04101F" : T.muted }}>{d}</button>
              ))}
            </div>
          )}
          {cmode === "everyN" && <div style={{ display: "flex", alignItems: "center", gap: 11 }}><span style={{ color: T.muted, fontSize: 14 }}>Every</span><NumStepper value={everyN} onChange={setEveryN} min={1} max={365} compact /><span style={{ color: T.muted, fontSize: 14 }}>days</span></div>}
          {cmode === "timesWk" && <div style={{ display: "flex", alignItems: "center", gap: 11 }}><NumStepper value={timesWk} onChange={setTimesWk} min={1} max={7} compact /><span style={{ color: T.muted, fontSize: 14 }}>times per week</span></div>}
          <div style={{ color: T.dim, fontSize: 11, marginTop: 10, lineHeight: 1.45 }}>Custom schedules settle at the end of the week, not each day.</div>
        </div>
      )}

      <div style={{ marginTop: 15 }}>
        <Field label="Note or principle (optional)">
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Why this matters, or something to read when you don't feel like it…" rows={3}
            style={{ ...inp, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
        </Field>
        <div style={{ color: T.dim, fontSize: 11.5, marginTop: -9, lineHeight: 1.5 }}>Shows on the task card as a quiet reminder — yours to read whenever you need the nudge.</div>
      </div>
    </Shell>
  );
}
