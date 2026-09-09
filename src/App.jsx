import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { doc, collection, onSnapshot, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "./firebase";
import {
  Flame,
  Dumbbell,
  Gift,
  Check,
  Plus,
  X,
  Trophy,
  Pencil,
  Camera,
  Star,
  Info,
  Share2,
  Settings,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Award,
  Lock,
} from "lucide-react";

const DOC_REF = doc(db, "gymCouple", "shared");
const CHECKINS_COL = collection(db, "checkins");
const ME_KEY = "gc:me";

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const REACTIONS = ["🔥", "💪", "👏", "❤️"];

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function weekKey(weekStart) {
  return toISODate(weekStart);
}

function fileToCompressedDataURL(file, maxWidth = 320, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Racha hacia atrás desde "today", contando solo días donde testFn(día) es verdadero.
function computeStreak(checkinsMap, today, testFn) {
  let streak = 0;
  let cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  const todayIso = toISODate(today);
  for (let i = 0; i < 3650; i++) {
    const iso = toISODate(cursor);
    const day = checkinsMap[iso];
    const ok = day && testFn(day);
    if (ok) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (iso === todayIso) {
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// Mejor racha histórica (no solo la actual): recorre todas las fechas con
// datos y busca la corrida de días consecutivos más larga.
function bestStreakEver(checkinsMap, testFn) {
  const dates = Object.keys(checkinsMap)
    .filter((iso) => testFn(checkinsMap[iso]))
    .sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const iso of dates) {
    const d = new Date(iso + "T00:00:00");
    if (prev) {
      const diffDays = Math.round((d - prev) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildMonthGrid(monthCursor) {
  const first = startOfMonth(monthCursor);
  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
  const leadingBlanks = (first.getDay() + 6) % 7; // lunes = 0
  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const DEFAULT_DATA = {
  config: null,
  checkins: {},
  goal: 4,
  evaluatedWeeks: [],
  penalties: [],
  wishlists: {},
};

export default function GymCoupleApp() {
  const [meta, setMeta] = useState(null);
  const [checkinsMap, setCheckinsMap] = useState({});
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupNames, setSetupNames] = useState({ a: "", b: "" });
  const [goalDraft, setGoalDraft] = useState(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [penaltyForm, setPenaltyForm] = useState(null);
  const [today, setToday] = useState(new Date());
  const [viewingPhoto, setViewingPhoto] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [dayChoice, setDayChoice] = useState(null); // { dateStr, name }
  const [excuseText, setExcuseText] = useState("");
  const [reactionDraft, setReactionDraft] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null); // { dateStr, name, compressed }
  const [noteDraft, setNoteDraft] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [editingNames, setEditingNames] = useState(false);
  const [nameDraft, setNameDraft] = useState({ a: "", b: "" });
  const fileInputRef = useRef(null);
  const pendingCellRef = useRef(null);

  useEffect(() => {
    const unsubMeta = onSnapshot(
      DOC_REF,
      (snap) => {
        setMeta(snap.exists() ? { ...DEFAULT_DATA, ...snap.data() } : DEFAULT_DATA);
        setLoading(false);
      },
      (err) => {
        console.error("Error de Firestore", err);
        setLoading(false);
      }
    );
    const unsubCheckins = onSnapshot(CHECKINS_COL, (snap) => {
      const map = {};
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (!d?.date || !d?.name) return;
        if (!map[d.date]) map[d.date] = {};
        map[d.date][d.name] = {
          photo: d.photo || null,
          ts: d.ts,
          reaction: d.reaction || null,
          type: d.type || "photo",
          reason: d.reason || null,
          note: d.note || null,
        };
      });
      setCheckinsMap(map);
    });
    const savedMe = window.localStorage.getItem(ME_KEY);
    if (savedMe) setMe(savedMe);
    return () => {
      unsubMeta();
      unsubCheckins();
    };
  }, []);

  const data = meta ? { ...DEFAULT_DATA, ...meta, checkins: checkinsMap } : null;

  const persist = useCallback(async (next) => {
    const { checkins, ...metaOnly } = next;
    try {
      await setDoc(DOC_REF, metaOnly);
    } catch (e) {
      console.error("No se pudo guardar", e);
    }
  }, []);

  const chooseMe = (name) => {
    setMe(name);
    window.localStorage.setItem(ME_KEY, name);
  };

  const saveSetup = async () => {
    const a = setupNames.a.trim();
    const b = setupNames.b.trim();
    if (!a || !b) return;
    await persist({ ...DEFAULT_DATA, config: { nameA: a, nameB: b } });
  };

  const wStart = useMemo(() => startOfWeek(today), [today]);
  const wDates = useMemo(() => weekDates(wStart), [wStart]);
  const wKey = useMemo(() => weekKey(wStart), [wStart]);

  const names = data?.config ? [data.config.nameA, data.config.nameB] : [];

  const requestPhotoForCell = (dateStr, name) => {
    setCaptureError("");
    pendingCellRef.current = { dateStr, name };
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const cell = pendingCellRef.current;
    pendingCellRef.current = null;
    if (!file || !cell) return;
    setCapturing(true);
    setCaptureError("");
    try {
      const compressed = await fileToCompressedDataURL(file);
      setPendingPhoto({ dateStr: cell.dateStr, name: cell.name, compressed });
    } catch (err) {
      console.error(err);
      setCaptureError("No se pudo procesar la foto, intenta de nuevo.");
    } finally {
      setCapturing(false);
    }
  };

  const confirmPendingPhoto = async () => {
    if (!pendingPhoto) return;
    try {
      const checkinDoc = doc(db, "checkins", `${pendingPhoto.dateStr}_${pendingPhoto.name}`);
      await setDoc(checkinDoc, {
        date: pendingPhoto.dateStr,
        name: pendingPhoto.name,
        photo: pendingPhoto.compressed,
        note: noteDraft.trim() || null,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      console.error(err);
      setCaptureError("No se pudo guardar la foto, intenta de nuevo.");
    } finally {
      setPendingPhoto(null);
      setNoteDraft("");
    }
  };

  const removeCheckin = async (dateStr, name) => {
    try {
      await deleteDoc(doc(db, "checkins", `${dateStr}_${name}`));
    } catch (e) {
      console.error("No se pudo eliminar la marca", e);
    }
    setViewingPhoto(null);
  };

  const setReaction = async (dateStr, name, emoji) => {
    try {
      const checkinDoc = doc(db, "checkins", `${dateStr}_${name}`);
      await setDoc(checkinDoc, { reaction: emoji }, { merge: true });
    } catch (e) {
      console.error("No se pudo guardar la reacción", e);
    }
  };

  const saveExcuse = async (dateStr, name, reason) => {
    try {
      const checkinDoc = doc(db, "checkins", `${dateStr}_${name}`);
      await setDoc(checkinDoc, {
        date: dateStr,
        name,
        type: "excuse",
        reason: reason.trim() || "Día justificado",
        ts: new Date().toISOString(),
      });
    } catch (e) {
      console.error("No se pudo guardar la justificación", e);
    }
  };

  const countForWeek = (name) => {
    if (!data) return 0;
    return wDates.reduce((acc, d) => {
      const iso = toISODate(d);
      return acc + (data.checkins[iso]?.[name] ? 1 : 0);
    }, 0);
  };

  const comboStreak = useMemo(() => {
    if (!data || names.length < 2) return 0;
    return computeStreak(data.checkins, today, (day) => names.every((n) => day[n] && day[n].type !== "excuse"));
  }, [data, names, today]);

  const individualStreak = (name) => {
    if (!data) return 0;
    return computeStreak(data.checkins, today, (day) => day[name] && day[name].type !== "excuse");
  };

  const bestComboStreakEver = useMemo(() => {
    if (!data || names.length < 2) return 0;
    return bestStreakEver(data.checkins, (day) => names.every((n) => day[n] && day[n].type !== "excuse"));
  }, [data, names]);

  const totalTrained = (name) => {
    if (!data) return 0;
    return Object.values(data.checkins).filter((day) => day[name] && day[name].type !== "excuse").length;
  };

  const wishlistFor = (name) => data?.wishlists?.[name] || [];

  const addWish = (name, text) => {
    const t = text.trim();
    if (!t) return;
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t };
    const next = { ...data.wishlists, [name]: [...wishlistFor(name), item] };
    persist({ ...data, wishlists: next });
  };

  const removeWish = (name, id) => {
    const next = { ...data.wishlists, [name]: wishlistFor(name).filter((w) => w.id !== id) };
    persist({ ...data, wishlists: next });
  };

  const claimWishOrDefault = (winnerName, wishlistsSnapshot) => {
    const list = wishlistsSnapshot[winnerName] || [];
    if (list.length === 0) return { prize: "un premio sorpresa", wishlists: wishlistsSnapshot };
    const [first, ...rest] = list;
    return { prize: first.text, wishlists: { ...wishlistsSnapshot, [winnerName]: rest } };
  };

  const addPenalty = (from, to, prize) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from,
      to,
      prize: prize || "un premio sorpresa",
      done: false,
      date: toISODate(new Date()),
    };
    persist({ ...data, penalties: [entry, ...data.penalties] });
  };

  const evaluateWeek = () => {
    if (!data || data.evaluatedWeeks.includes(wKey)) return;
    const [nameA, nameB] = names;
    const countA = countForWeek(nameA);
    const countB = countForWeek(nameB);
    const goal = data.goal;
    let wishlists = { ...data.wishlists };
    const newPenalties = [];

    if (countA < goal && countB >= goal) {
      const { prize, wishlists: w2 } = claimWishOrDefault(nameB, wishlists);
      wishlists = w2;
      newPenalties.push({
        id: `${Date.now()}-a`,
        from: nameA,
        to: nameB,
        prize,
        reason: `no llegó a ${goal} días esta semana (${countA}/${goal})`,
        done: false,
        date: toISODate(new Date()),
      });
    }
    if (countB < goal && countA >= goal) {
      const { prize, wishlists: w2 } = claimWishOrDefault(nameA, wishlists);
      wishlists = w2;
      newPenalties.push({
        id: `${Date.now()}-b`,
        from: nameB,
        to: nameA,
        prize,
        reason: `no llegó a ${goal} días esta semana (${countB}/${goal})`,
        done: false,
        date: toISODate(new Date()),
      });
    }

    persist({
      ...data,
      evaluatedWeeks: [...data.evaluatedWeeks, wKey],
      penalties: [...newPenalties, ...data.penalties],
      wishlists,
    });
  };

  const togglePenaltyDone = (id) => {
    const next = {
      ...data,
      penalties: data.penalties.map((p) => (p.id === id ? { ...p, done: !p.done } : p)),
    };
    persist(next);
  };

  const removePenalty = (id) => {
    persist({ ...data, penalties: data.penalties.filter((p) => p.id !== id) });
  };

  const saveGoal = () => {
    const g = parseInt(goalDraft, 10);
    if (!g || g < 1 || g > 7) return;
    persist({ ...data, goal: g });
    setEditingGoal(false);
  };

  const saveNames = () => {
    const a = nameDraft.a.trim();
    const b = nameDraft.b.trim();
    if (!a || !b) return;
    persist({ ...data, config: { nameA: a, nameB: b } });
    setEditingNames(false);
  };

  const shareProgress = () => {
    if (!data?.config) return;
    const [nA, nB] = names;
    const cA = countForWeek(nA);
    const cB = countForWeek(nB);
    const lines = [
      "💪 Rutina en Pareja",
      `Racha juntos: ${comboStreak} días 🔥`,
      `Esta semana: ${nA} ${cA}/${data.goal} · ${nB} ${cB}/${data.goal}`,
    ];
    const pending = data.penalties.filter((p) => !p.done);
    if (pending.length > 0) {
      lines.push("Premios pendientes:");
      pending.forEach((p) => lines.push(`- ${p.from} le debe a ${p.to}: ${p.prize}`));
    }
    const text = lines.join("\n");
    if (navigator.share) {
      navigator.share({ text, title: "Rutina en Pareja" }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="gc-app gc-center">
        <style>{css}</style>
        <Dumbbell className="gc-spin" size={28} />
      </div>
    );
  }

  if (!data.config) {
    return (
      <div className="gc-app gc-center">
        <style>{css}</style>
        <div className="gc-panel gc-setup">
          <Dumbbell size={30} className="gc-accent-icon" />
          <h1>Empecemos</h1>
          <p className="gc-muted">Ingresa los nombres de los dos para llevar el registro juntos.</p>
          <input
            className="gc-input"
            placeholder="Tu nombre"
            value={setupNames.a}
            onChange={(e) => setSetupNames((s) => ({ ...s, a: e.target.value }))}
          />
          <input
            className="gc-input"
            placeholder="Nombre de tu pareja"
            value={setupNames.b}
            onChange={(e) => setSetupNames((s) => ({ ...s, b: e.target.value }))}
          />
          <button className="gc-btn gc-btn-primary" onClick={saveSetup}>
            Crear
          </button>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="gc-app gc-center">
        <style>{css}</style>
        <div className="gc-panel gc-setup">
          <h1>¿Quién eres?</h1>
          <p className="gc-muted">Esto queda guardado en este dispositivo.</p>
          <div className="gc-who-row">
            <button className="gc-btn gc-btn-a" onClick={() => chooseMe(data.config.nameA)}>
              {data.config.nameA}
            </button>
            <button className="gc-btn gc-btn-b" onClick={() => chooseMe(data.config.nameB)}>
              {data.config.nameB}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const [nameA, nameB] = names;
  const countA = countForWeek(nameA);
  const countB = countForWeek(nameB);
  const goal = data.goal;
  const alreadyEvaluated = data.evaluatedWeeks.includes(wKey);
  const pendingPenalties = data.penalties.filter((p) => !p.done);
  const resolvedPenalties = data.penalties.filter((p) => p.done);
  const myWishlist = wishlistFor(me);
  const partnerName = me === nameA ? nameB : nameA;
  const partnerWishlist = wishlistFor(partnerName);
  const toWishlist = penaltyForm ? wishlistFor(penaltyForm.to) : [];
  const todayIso = toISODate(today);
  const iCheckedInToday = !!data.checkins[todayIso]?.[me];
  const showReminder = !iCheckedInToday && today.getHours() >= 18;
  const monthWeeks = buildMonthGrid(monthCursor);
  const isCurrentMonth = monthCursor.getFullYear() === today.getFullYear() && monthCursor.getMonth() === today.getMonth();

  const ACHIEVEMENTS = [
    {
      id: "streak7",
      icon: "🔥",
      label: "Racha de 7 días",
      shared: true,
      earned: bestComboStreakEver >= 7,
    },
    {
      id: "streak30",
      icon: "🔥🔥",
      label: "Racha de 30 días",
      shared: true,
      earned: bestComboStreakEver >= 30,
    },
    {
      id: "weeks1",
      icon: "🏆",
      label: "Primera semana evaluada",
      shared: true,
      earned: data.evaluatedWeeks.length >= 1,
    },
    {
      id: "weeks5",
      icon: "🏆🏆",
      label: "5 semanas evaluadas",
      shared: true,
      earned: data.evaluatedWeeks.length >= 5,
    },
    { id: "trained10", icon: "📸", label: "10 entrenamientos", earned10: true },
    { id: "trained50", icon: "📸📸", label: "50 entrenamientos", earned50: true },
  ];

  return (
    <div className="gc-app">
      <style>{css}</style>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFileChosen}
      />

      <header className="gc-header">
        <div>
          <div className="gc-title-row">
            <Dumbbell size={20} />
            <span className="gc-app-name">Rutina en Pareja</span>
          </div>
          <div className="gc-subtitle">
            {nameA} &amp; {nameB} · tú eres {me}
          </div>
        </div>
        <div className="gc-header-right">
          <button
            className="gc-icon-btn"
            onClick={() => {
              setNameDraft({ a: nameA, b: nameB });
              setEditingNames(true);
            }}
            title="Editar nombres"
          >
            <Settings size={16} />
          </button>
          <button className="gc-icon-btn" onClick={shareProgress} title="Compartir progreso">
            <Share2 size={16} />
          </button>
          <div className="gc-streak">
            <Flame size={28} className={comboStreak > 0 ? "gc-flame-lit" : "gc-flame"} />
            <div>
              <div className="gc-streak-num">{comboStreak}</div>
              <div className="gc-streak-label">días seguidos juntos</div>
            </div>
          </div>
        </div>
      </header>

      {showReminder && (
        <div className="gc-reminder">
          ⏰ Todavía no marcas tu día de hoy. ¿Vas a ir al gym?
        </div>
      )}

      <section className="gc-panel gc-week">
        <p className="gc-hint gc-hint-top">
          <Camera size={13} /> Toca tu día para tomarte una foto o justificarlo.
        </p>
        <div className="gc-week-grid">
          <div className="gc-week-row gc-week-row-labels">
            <div className="gc-week-name-spacer" />
            {wDates.map((d, i) => (
              <div key={i} className="gc-day-label">
                <div>{DAY_LABELS[i]}</div>
                <div className="gc-day-num">{d.getDate()}</div>
              </div>
            ))}
          </div>
          {names.map((name, idx) => (
            <div className="gc-week-row" key={name}>
              <div className={`gc-week-name ${idx === 0 ? "gc-text-a" : "gc-text-b"}`}>
                {name}
                <span className="gc-mini-streak" title="Racha individual">
                  🔥{individualStreak(name)}
                </span>
              </div>
              {wDates.map((d) => {
                const iso = toISODate(d);
                const entry = data.checkins[iso]?.[name];
                const checked = !!entry;
                const isExcuse = entry?.type === "excuse";
                const isMe = name === me;
                const isFuture = d > today && iso !== toISODate(today);
                const canView = checked;

                return (
                  <button
                    key={iso}
                    disabled={(!isMe && !canView) || (isFuture && !checked)}
                    onClick={() => {
                      if (checked) {
                        if (canView) setViewingPhoto({ name, date: iso });
                      } else if (isMe) {
                        setDayChoice({ dateStr: iso, name });
                      }
                    }}
                    style={
                      checked && entry?.photo
                        ? { backgroundImage: `url(${entry.photo})`, backgroundSize: "cover", backgroundPosition: "center" }
                        : undefined
                    }
                    className={`gc-day-cell ${
                      checked ? (isExcuse ? "gc-cell-excuse" : idx === 0 ? "gc-cell-a" : "gc-cell-b") : ""
                    } ${!isMe ? "gc-cell-readonly" : ""}`}
                    title={
                      checked
                        ? isExcuse
                          ? "Día justificado"
                          : "Ver foto"
                        : isMe
                        ? "Marcar este día"
                        : `Solo ${name} puede marcar esto`
                    }
                  >
                    {checked ? (
                      isExcuse ? (
                        <Info size={14} />
                      ) : (
                        <span className="gc-cell-check">
                          <Check size={14} />
                        </span>
                      )
                    ) : isMe && !isFuture ? (
                      <Camera size={14} className="gc-cell-camera-hint" />
                    ) : null}
                    {entry?.reaction && <span className="gc-cell-reaction">{entry.reaction}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {capturing && <p className="gc-hint gc-hint-status">Procesando foto…</p>}
        {captureError && <p className="gc-hint gc-hint-error">{captureError}</p>}
      </section>

      <section className="gc-panel gc-month">
        <div className="gc-goal-title">
          <BarChart3 size={18} />
          <span>Vista mensual</span>
        </div>
        <div className="gc-month-nav">
          <button
            className="gc-icon-btn"
            onClick={() => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="gc-month-label">
            {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
          </span>
          <button
            className="gc-icon-btn"
            onClick={() => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="gc-month-daylabels">
          {DAY_LABELS.map((l) => (
            <span key={l}>{l[0]}</span>
          ))}
        </div>
        {monthWeeks.map((week, wi) => (
          <div className="gc-month-row" key={wi}>
            {week.map((d, di) => {
              if (!d) return <div className="gc-month-cell gc-month-blank" key={di} />;
              const iso = toISODate(d);
              const isToday = isCurrentMonth && d.getDate() === today.getDate();
              const dayEntry = data.checkins[iso] || {};
              return (
                <div className={`gc-month-cell ${isToday ? "gc-month-today" : ""}`} key={di}>
                  <span className="gc-month-daynum">{d.getDate()}</span>
                  <div className="gc-month-dots">
                    <span className={`gc-dot gc-dot-a ${dayEntry[nameA] ? "gc-dot-filled" : ""}`} />
                    <span className={`gc-dot gc-dot-b ${dayEntry[nameB] ? "gc-dot-filled" : ""}`} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="gc-panel gc-stats">
        <div className="gc-goal-title">
          <Trophy size={18} />
          <span>Estadísticas</span>
        </div>
        <div className="gc-stats-grid">
          <div className="gc-stat">
            <div className="gc-stat-num">{comboStreak}</div>
            <div className="gc-stat-label">Racha actual</div>
          </div>
          <div className="gc-stat">
            <div className="gc-stat-num">{bestComboStreakEver}</div>
            <div className="gc-stat-label">Mejor racha histórica</div>
          </div>
          <div className="gc-stat">
            <div className="gc-stat-num gc-text-a">{totalTrained(nameA)}</div>
            <div className="gc-stat-label">Días de {nameA}</div>
          </div>
          <div className="gc-stat">
            <div className="gc-stat-num gc-text-b">{totalTrained(nameB)}</div>
            <div className="gc-stat-label">Días de {nameB}</div>
          </div>
          <div className="gc-stat">
            <div className="gc-stat-num">{data.evaluatedWeeks.length}</div>
            <div className="gc-stat-label">Semanas evaluadas</div>
          </div>
          <div className="gc-stat">
            <div className="gc-stat-num">{resolvedPenalties.length}</div>
            <div className="gc-stat-label">Premios cobrados</div>
          </div>
        </div>
      </section>

      <section className="gc-panel gc-achievements">
        <div className="gc-goal-title">
          <Award size={18} />
          <span>Logros</span>
        </div>
        <div className="gc-achv-grid">
          {ACHIEVEMENTS.filter((a) => a.shared).map((a) => (
            <div className={`gc-achv ${a.earned ? "gc-achv-earned" : ""}`} key={a.id}>
              <span className="gc-achv-icon">{a.earned ? a.icon : <Lock size={16} />}</span>
              <span className="gc-achv-label">{a.label}</span>
            </div>
          ))}
          {names.map((name) => (
            <div className={`gc-achv ${totalTrained(name) >= 10 ? "gc-achv-earned" : ""}`} key={`${name}-10`}>
              <span className="gc-achv-icon">{totalTrained(name) >= 10 ? "📸" : <Lock size={16} />}</span>
              <span className="gc-achv-label">{name}: 10 entrenamientos</span>
            </div>
          ))}
          {names.map((name) => (
            <div className={`gc-achv ${totalTrained(name) >= 50 ? "gc-achv-earned" : ""}`} key={`${name}-50`}>
              <span className="gc-achv-icon">{totalTrained(name) >= 50 ? "📸📸" : <Lock size={16} />}</span>
              <span className="gc-achv-label">{name}: 50 entrenamientos</span>
            </div>
          ))}
        </div>
      </section>

      <section className="gc-panel gc-goal">
        <div className="gc-goal-header">
          <div className="gc-goal-title">
            <Trophy size={18} />
            <span>Meta semanal: {goal} días</span>
          </div>
          {!editingGoal ? (
            <button
              className="gc-icon-btn"
              onClick={() => {
                setGoalDraft(String(goal));
                setEditingGoal(true);
              }}
            >
              <Pencil size={14} />
            </button>
          ) : (
            <div className="gc-goal-edit">
              <input
                className="gc-input gc-input-small"
                type="number"
                min={1}
                max={7}
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
              />
              <button className="gc-btn gc-btn-tiny gc-btn-primary" onClick={saveGoal}>
                Ok
              </button>
            </div>
          )}
        </div>

        <div className="gc-goal-bars">
          <GoalBar name={nameA} count={countA} goal={goal} variant="a" />
          <GoalBar name={nameB} count={countB} goal={goal} variant="b" />
        </div>

        <button className="gc-btn gc-btn-outline" disabled={alreadyEvaluated} onClick={evaluateWeek}>
          {alreadyEvaluated ? "Semana ya evaluada" : "Evaluar semana"}
        </button>
        <p className="gc-hint">
          Si alguien no llega a la meta, le queda debiendo al otro el primer premio de su lista de deseos.
        </p>
      </section>

      <section className="gc-panel gc-wishlist">
        <div className="gc-goal-title">
          <Star size={18} />
          <span>Lista de premios</span>
        </div>
        <p className="gc-hint gc-hint-top">Lo que cada quien quiere recibir si gana.</p>

        <WishColumn
          label={`${me} (tú)`}
          variant={me === nameA ? "a" : "b"}
          items={myWishlist}
          editable
          onAdd={(text) => addWish(me, text)}
          onRemove={(id) => removeWish(me, id)}
        />
        <WishColumn
          label={partnerName}
          variant={partnerName === nameA ? "a" : "b"}
          items={partnerWishlist}
          editable={false}
        />
      </section>

      <section className="gc-panel gc-penalties">
        <div className="gc-goal-title">
          <Gift size={18} />
          <span>Premios pendientes</span>
        </div>

        {pendingPenalties.length === 0 && <p className="gc-muted gc-empty">Nadie le debe nada a nadie… por ahora.</p>}

        {pendingPenalties.map((p) => (
          <div className="gc-penalty-row" key={p.id}>
            <div>
              <span className={p.from === nameA ? "gc-text-a" : "gc-text-b"}>{p.from}</span>
              {" le debe a "}
              <span className={p.to === nameA ? "gc-text-a" : "gc-text-b"}>{p.to}</span>
              {": "}
              <strong>{p.prize}</strong>
              {p.reason && <div className="gc-penalty-reason">{p.reason}</div>}
            </div>
            <div className="gc-penalty-actions">
              <button className="gc-icon-btn" onClick={() => togglePenaltyDone(p.id)} title="Marcar como pagado">
                <Check size={16} />
              </button>
              <button className="gc-icon-btn gc-icon-btn-danger" onClick={() => removePenalty(p.id)} title="Eliminar">
                <X size={16} />
              </button>
            </div>
          </div>
        ))}

        {resolvedPenalties.length > 0 && (
          <details className="gc-resolved">
            <summary>Historial de premios cobrados ({resolvedPenalties.length})</summary>
            {resolvedPenalties.map((p) => (
              <div className="gc-penalty-row gc-penalty-row-done" key={p.id}>
                <div>
                  {p.from} → {p.to}: <strong>{p.prize}</strong>
                  <div className="gc-penalty-reason">{p.date}</div>
                </div>
              </div>
            ))}
          </details>
        )}

        {!penaltyForm ? (
          <button
            className="gc-btn gc-btn-outline gc-btn-add"
            onClick={() => setPenaltyForm({ from: nameA, to: nameB, prize: "" })}
          >
            <Plus size={14} /> Agregar premio pendiente
          </button>
        ) : (
          <div className="gc-penalty-form">
            <select
              className="gc-input"
              value={penaltyForm.from}
              onChange={(e) =>
                setPenaltyForm((f) => ({
                  ...f,
                  from: e.target.value,
                  to: e.target.value === nameA ? nameB : nameA,
                  prize: "",
                }))
              }
            >
              <option value={nameA}>{nameA}</option>
              <option value={nameB}>{nameB}</option>
            </select>
            <span className="gc-muted">le debe a {penaltyForm.to}</span>

            {toWishlist.length > 0 ? (
              <select
                className="gc-input"
                value={penaltyForm.prize}
                onChange={(e) => setPenaltyForm((f) => ({ ...f, prize: e.target.value }))}
              >
                <option value="">Elegir de la lista de {penaltyForm.to}…</option>
                {toWishlist.map((w) => (
                  <option key={w.id} value={w.text}>
                    {w.text}
                  </option>
                ))}
                <option value="__custom__">Otro (escribir)…</option>
              </select>
            ) : null}

            {(toWishlist.length === 0 || penaltyForm.prize === "__custom__") && (
              <input
                className="gc-input"
                placeholder="¿Qué premio le debe?"
                value={penaltyForm.prize === "__custom__" ? "" : penaltyForm.prize}
                onChange={(e) => setPenaltyForm((f) => ({ ...f, prize: e.target.value }))}
              />
            )}

            <div className="gc-row-gap">
              <button
                className="gc-btn gc-btn-primary"
                onClick={() => {
                  const prize = penaltyForm.prize === "__custom__" ? "" : penaltyForm.prize;
                  addPenalty(penaltyForm.from, penaltyForm.to, prize);
                  setPenaltyForm(null);
                }}
              >
                Guardar
              </button>
              <button className="gc-btn gc-btn-outline" onClick={() => setPenaltyForm(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      {editingNames && (
        <div className="gc-lightbox" onClick={() => setEditingNames(false)}>
          <div className="gc-lightbox-inner gc-choice-inner" onClick={(e) => e.stopPropagation()}>
            <div className="gc-lightbox-footer">
              <span>Editar nombres</span>
              <input
                className="gc-input"
                value={nameDraft.a}
                onChange={(e) => setNameDraft((n) => ({ ...n, a: e.target.value }))}
              />
              <input
                className="gc-input"
                value={nameDraft.b}
                onChange={(e) => setNameDraft((n) => ({ ...n, b: e.target.value }))}
              />
              <p className="gc-hint">
                Cambiar un nombre aquí no le cambia el nombre a los días que ya marcaste con el nombre anterior.
              </p>
              <div className="gc-row-gap">
                <button className="gc-btn gc-btn-primary" onClick={saveNames}>
                  Guardar
                </button>
                <button className="gc-btn gc-btn-outline" onClick={() => setEditingNames(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingPhoto && (
        <div
          className="gc-lightbox"
          onClick={() => {
            setPendingPhoto(null);
            setNoteDraft("");
          }}
        >
          <div className="gc-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <img src={pendingPhoto.compressed} alt="Vista previa" />
            <div className="gc-lightbox-footer">
              <span>¿Agregas una nota? (opcional)</span>
              <input
                className="gc-input"
                placeholder="Ej. piernas hoy 🦵"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <div className="gc-row-gap">
                <button className="gc-btn gc-btn-primary" onClick={confirmPendingPhoto}>
                  Guardar
                </button>
                <button
                  className="gc-btn gc-btn-outline"
                  onClick={() => {
                    setPendingPhoto(null);
                    setNoteDraft("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dayChoice && (
        <div
          className="gc-lightbox"
          onClick={() => {
            setDayChoice(null);
            setExcuseText("");
          }}
        >
          <div className="gc-lightbox-inner gc-choice-inner" onClick={(e) => e.stopPropagation()}>
            <div className="gc-lightbox-footer">
              <span>¿Cómo marcamos este día?</span>
              <div className="gc-row-gap">
                <button
                  className="gc-btn gc-btn-primary"
                  onClick={() => {
                    requestPhotoForCell(dayChoice.dateStr, dayChoice.name);
                    setDayChoice(null);
                  }}
                >
                  <Camera size={14} /> Tomar foto
                </button>
              </div>
              <p className="gc-hint gc-choice-or">o si no pudiste ir:</p>
              <input
                className="gc-input"
                placeholder="Motivo (ej. lesión, viaje)"
                value={excuseText}
                onChange={(e) => setExcuseText(e.target.value)}
              />
              <div className="gc-row-gap">
                <button
                  className="gc-btn gc-btn-outline"
                  onClick={() => {
                    saveExcuse(dayChoice.dateStr, dayChoice.name, excuseText);
                    setDayChoice(null);
                    setExcuseText("");
                  }}
                >
                  <Info size={14} /> Justificar día
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingPhoto &&
        (() => {
          const viewEntry = data.checkins[viewingPhoto.date]?.[viewingPhoto.name];
          if (!viewEntry) return null;
          const isMyPhoto = viewingPhoto.name === me;
          const isExcuse = viewEntry.type === "excuse";
          return (
            <div
              className="gc-lightbox"
              onClick={() => {
                setViewingPhoto(null);
                setReactionDraft("");
              }}
            >
              <div className="gc-lightbox-inner" onClick={(e) => e.stopPropagation()}>
                {isExcuse ? (
                  <div className="gc-excuse-view">
                    <Info size={22} />
                    <p>{viewEntry.reason}</p>
                  </div>
                ) : (
                  <img src={viewEntry.photo} alt={`${viewingPhoto.name} en el gym`} />
                )}
                <div className="gc-lightbox-footer">
                  <span>
                    {viewingPhoto.name} · {viewingPhoto.date} {isExcuse && "· justificado"}
                  </span>

                  {!isExcuse && viewEntry.note && <p className="gc-checkin-note">"{viewEntry.note}"</p>}

                  {isMyPhoto && !isExcuse && viewEntry.reaction && (
                    <p className="gc-current-reaction">
                      Tu pareja reaccionó: <span className="gc-reaction-emoji-big">{viewEntry.reaction}</span>
                    </p>
                  )}

                  {!isMyPhoto && !isExcuse && (
                    <>
                      <div className="gc-reaction-row">
                        {REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            className={`gc-reaction-btn ${viewEntry.reaction === emoji ? "gc-reaction-active" : ""}`}
                            onClick={() =>
                              setReaction(viewingPhoto.date, viewingPhoto.name, viewEntry.reaction === emoji ? null : emoji)
                            }
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                      <div className="gc-reaction-custom">
                        <input
                          className="gc-input gc-input-emoji"
                          placeholder="Otro emoji…"
                          value={reactionDraft}
                          onChange={(e) => setReactionDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && reactionDraft.trim()) {
                              setReaction(viewingPhoto.date, viewingPhoto.name, reactionDraft.trim());
                              setReactionDraft("");
                            }
                          }}
                          onBlur={() => {
                            if (reactionDraft.trim()) {
                              setReaction(viewingPhoto.date, viewingPhoto.name, reactionDraft.trim());
                              setReactionDraft("");
                            }
                          }}
                        />
                        <button
                          className="gc-icon-btn"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (reactionDraft.trim()) {
                              setReaction(viewingPhoto.date, viewingPhoto.name, reactionDraft.trim());
                              setReactionDraft("");
                            }
                          }}
                        >
                          <Check size={14} />
                        </button>
                      </div>
                      {viewEntry.reaction && !REACTIONS.includes(viewEntry.reaction) && (
                        <p className="gc-hint gc-current-reaction">Reacción actual: {viewEntry.reaction}</p>
                      )}
                    </>
                  )}

                  <div className="gc-row-gap">
                    {isMyPhoto && (
                      <button
                        className="gc-btn gc-btn-tiny gc-btn-outline"
                        onClick={() => removeCheckin(viewingPhoto.date, viewingPhoto.name)}
                      >
                        Eliminar marca
                      </button>
                    )}
                    <button
                      className="gc-btn gc-btn-tiny gc-btn-primary"
                      onClick={() => {
                        setViewingPhoto(null);
                        setReactionDraft("");
                      }}
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function WishColumn({ label, variant, items, editable, onAdd, onRemove }) {
  const [text, setText] = useState("");
  return (
    <div className="gc-wish-col">
      <div className={`gc-wish-label ${variant === "a" ? "gc-text-a" : "gc-text-b"}`}>{label}</div>
      {items.length === 0 && <p className="gc-muted gc-wish-empty">Todavía no agregó nada.</p>}
      <ul className="gc-wish-list">
        {items.map((w) => (
          <li key={w.id}>
            <span>{w.text}</span>
            {editable && (
              <button className="gc-icon-btn" onClick={() => onRemove(w.id)} title="Quitar">
                <X size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="gc-wish-add">
          <input
            className="gc-input gc-input-wish"
            placeholder="Ej. una cena, unos tenis…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                onAdd(text);
                setText("");
              }
            }}
          />
          <button
            className="gc-icon-btn"
            onClick={() => {
              if (text.trim()) {
                onAdd(text);
                setText("");
              }
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function GoalBar({ name, count, goal, variant }) {
  const pct = Math.min(100, Math.round((count / goal) * 100));
  const met = count >= goal;
  return (
    <div className="gc-goal-bar-wrap">
      <div className="gc-goal-bar-label">
        <span className={variant === "a" ? "gc-text-a" : "gc-text-b"}>{name}</span>
        <span className="gc-muted">
          {count}/{goal} {met && "✓"}
        </span>
      </div>
      <div className="gc-goal-bar-track">
        <div className={`gc-goal-bar-fill ${variant === "a" ? "gc-fill-a" : "gc-fill-b"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const css = `
.gc-app {
  --bg: #17181a;
  --panel: #1f2123;
  --panel-2: #26282b;
  --accent-a: #f2a93b;
  --accent-a-dim: rgba(242, 169, 59, 0.16);
  --accent-b: #2fb6a8;
  --accent-b-dim: rgba(47, 182, 168, 0.16);
  --text: #f2efe9;
  --muted: #9a9c9e;
  --success: #7cc576;
  --danger: #e85d4e;
  --border: rgba(255,255,255,0.09);

  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  padding: 20px 16px 40px;
  min-height: 100vh;
  box-sizing: border-box;
  max-width: 480px;
  margin: 0 auto;
  position: relative;
}
.gc-app * { box-sizing: border-box; }
.gc-center { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.gc-spin { animation: gc-spin 1s linear infinite; color: var(--accent-a); }
@keyframes gc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.gc-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 14px;
}

.gc-setup { text-align: center; width: 320px; }
.gc-setup h1 { font-size: 22px; margin: 10px 0 4px; }
.gc-accent-icon { color: var(--accent-a); }
.gc-muted { color: var(--muted); font-size: 13px; }
.gc-input {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  margin-top: 10px;
}
.gc-input-small { width: 70px; margin-top: 0; padding: 6px 8px; }
.gc-input-wish { margin-top: 0; }
.gc-btn {
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text);
  background: var(--panel-2);
}
.gc-btn-primary { background: var(--accent-a); color: #201203; }
.gc-btn-outline { background: transparent; border: 1px solid var(--border); width: 100%; margin-top: 10px; }
.gc-btn-outline:disabled { opacity: 0.5; cursor: default; }
.gc-btn-add { display: flex; align-items: center; justify-content: center; gap: 6px; }
.gc-btn-tiny { padding: 6px 10px; font-size: 13px; width: auto; margin-top: 0; }
.gc-who-row { display: flex; gap: 10px; margin-top: 14px; justify-content: center; }
.gc-btn-a { background: var(--accent-a); color: #201203; }
.gc-btn-b { background: var(--accent-b); color: #06231f; }

.gc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; }
.gc-header-right { display: flex; align-items: center; gap: 10px; }
.gc-title-row { display: flex; align-items: center; gap: 8px; }
.gc-app-name { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.gc-subtitle { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.gc-streak { display: flex; align-items: center; gap: 8px; }
.gc-flame { color: var(--muted); }
.gc-flame-lit { color: #ff8a3d; filter: drop-shadow(0 0 6px rgba(255,138,61,0.5)); }
.gc-streak-num { font-size: 24px; font-weight: 800; line-height: 1; text-align: right; }
.gc-streak-label { font-size: 10.5px; color: var(--muted); text-align: right; max-width: 90px; }

.gc-reminder {
  background: var(--accent-a-dim); border: 1px solid var(--accent-a);
  color: var(--text); border-radius: 10px; padding: 10px 14px;
  font-size: 13px; margin-bottom: 14px;
}

.gc-hint-top { display: flex; align-items: center; gap: 6px; margin: 0 0 12px; }
.gc-week-grid { display: flex; flex-direction: column; gap: 8px; }
.gc-week-row { display: grid; grid-template-columns: 64px repeat(7, 1fr); gap: 6px; align-items: center; }
.gc-week-name-spacer { width: 64px; }
.gc-day-label { text-align: center; font-size: 11px; color: var(--muted); }
.gc-day-num { font-size: 12px; color: var(--text); font-weight: 600; }
.gc-week-name { font-size: 13px; font-weight: 700; display: flex; align-items: baseline; gap: 5px; }
.gc-mini-streak { font-size: 10px; font-weight: 600; color: var(--muted); }
.gc-text-a { color: var(--accent-a); }
.gc-text-b { color: var(--accent-b); }
.gc-day-cell {
  aspect-ratio: 1;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  display: flex; align-items: center; justify-content: center;
  color: transparent;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.gc-day-cell:disabled { cursor: default; }
.gc-day-cell.gc-cell-readonly { opacity: 0.85; }
.gc-cell-camera-hint { color: var(--muted); }
.gc-cell-check {
  background: rgba(0,0,0,0.45);
  border-radius: 999px;
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
}
.gc-cell-a:not([style*="background-image"]) { background: var(--accent-a); border-color: var(--accent-a); }
.gc-cell-b:not([style*="background-image"]) { background: var(--accent-b); border-color: var(--accent-b); }
.gc-cell-reaction {
  position: absolute; bottom: 2px; right: 2px;
  font-size: 12px; line-height: 1;
  background: rgba(0,0,0,0.55); border-radius: 999px;
  width: 17px; height: 17px; display: flex; align-items: center; justify-content: center;
}
.gc-cell-excuse {
  background: repeating-linear-gradient(45deg, var(--panel-2), var(--panel-2) 6px, #2f3134 6px, #2f3134 12px);
  color: var(--muted);
}

.gc-month-nav { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 10px 0; }
.gc-month-label { font-size: 13.5px; font-weight: 700; min-width: 140px; text-align: center; }
.gc-month-daylabels {
  display: grid; grid-template-columns: repeat(7, 1fr); text-align: center;
  font-size: 10px; color: var(--muted); margin-bottom: 4px;
}
.gc-month-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-bottom: 3px; }
.gc-month-cell {
  aspect-ratio: 1; border-radius: 6px; background: var(--panel-2);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  font-size: 10px; color: var(--muted);
}
.gc-month-blank { background: transparent; }
.gc-month-today { border: 1px solid var(--accent-a); }
.gc-month-daynum { font-size: 10px; }
.gc-month-dots { display: flex; gap: 2px; }
.gc-dot { width: 5px; height: 5px; border-radius: 999px; border: 1px solid var(--muted); background: transparent; }
.gc-dot-filled.gc-dot-a { background: var(--accent-a); border-color: var(--accent-a); }
.gc-dot-filled.gc-dot-b { background: var(--accent-b); border-color: var(--accent-b); }

.gc-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px; }
.gc-stat { text-align: center; }
.gc-stat-num { font-size: 20px; font-weight: 800; }
.gc-stat-label { font-size: 10px; color: var(--muted); margin-top: 2px; }

.gc-achv-grid { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.gc-achv {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  background: var(--panel-2); border-radius: 8px; opacity: 0.5; font-size: 13px;
}
.gc-achv-earned { opacity: 1; }
.gc-achv-icon { font-size: 16px; width: 22px; text-align: center; color: var(--muted); }

.gc-goal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.gc-goal-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14.5px; }
.gc-goal-edit { display: flex; align-items: center; gap: 6px; }
.gc-icon-btn {
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px;
  padding: 5px; color: var(--text); cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.gc-icon-btn-danger:hover { color: var(--danger); }
.gc-goal-bars { display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px; }
.gc-goal-bar-label { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
.gc-goal-bar-track { height: 8px; border-radius: 5px; background: var(--panel-2); overflow: hidden; }
.gc-goal-bar-fill { height: 100%; border-radius: 5px; transition: width 0.3s ease; }
.gc-fill-a { background: var(--accent-a); }
.gc-fill-b { background: var(--accent-b); }
.gc-hint { font-size: 12px; color: var(--muted); margin-top: 8px; margin-bottom: 0; display: flex; align-items: center; gap: 5px; }
.gc-hint-status { color: var(--accent-a); }
.gc-hint-error { color: var(--danger); }

.gc-wish-col { margin-bottom: 14px; }
.gc-wish-col:last-child { margin-bottom: 0; }
.gc-wish-label { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.gc-wish-empty { margin: 0 0 6px; }
.gc-wish-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.gc-wish-list li {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
  padding: 7px 10px; font-size: 13.5px;
}
.gc-wish-add { display: flex; gap: 6px; margin-top: 8px; }
.gc-wish-add .gc-input { flex: 1; }

.gc-empty { padding: 6px 0 4px; }
.gc-penalty-row {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
  padding: 10px 0; border-top: 1px solid var(--border); font-size: 13.5px;
}
.gc-penalty-row-done { opacity: 0.55; }
.gc-penalty-reason { color: var(--muted); font-size: 12px; margin-top: 2px; }
.gc-penalty-actions { display: flex; gap: 6px; flex-shrink: 0; }
.gc-resolved { margin-top: 6px; font-size: 12.5px; color: var(--muted); }
.gc-resolved summary { cursor: pointer; padding: 6px 0; }
.gc-penalty-form { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.gc-row-gap { display: flex; gap: 8px; }
.gc-row-gap .gc-btn { flex: 1; }

.gc-lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,0.75);
  display: flex; align-items: center; justify-content: center;
  z-index: 50; padding: 20px;
}
.gc-lightbox-inner {
  background: var(--panel); border-radius: 14px; overflow: hidden;
  max-width: 340px; width: 100%;
}
.gc-lightbox-inner img { width: 100%; display: block; max-height: 360px; object-fit: cover; }
.gc-lightbox-footer { padding: 12px 14px; font-size: 13px; }
.gc-lightbox-footer > span { display: block; margin-bottom: 8px; color: var(--muted); }
.gc-checkin-note { margin: 0 0 10px; font-style: italic; color: var(--text); }
.gc-reaction-row { display: flex; gap: 8px; margin-bottom: 10px; }
.gc-reaction-btn {
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
  font-size: 18px; padding: 6px 10px; cursor: pointer; line-height: 1;
}
.gc-reaction-active { background: var(--accent-a-dim); border-color: var(--accent-a); }
.gc-reaction-custom { display: flex; gap: 6px; margin-bottom: 10px; }
.gc-input-emoji { margin-top: 0; font-size: 16px; }
.gc-current-reaction { margin: 0 0 10px; }
.gc-reaction-emoji-big { font-size: 20px; vertical-align: middle; }

.gc-choice-inner { max-width: 300px; }
.gc-choice-or { justify-content: center; margin: 10px 0; }
.gc-btn-primary, .gc-btn-outline { display: flex; align-items: center; justify-content: center; gap: 6px; }
.gc-excuse-view {
  padding: 30px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px;
  color: var(--muted); text-align: center;
}
.gc-excuse-view p { margin: 0; color: var(--text); font-size: 14px; }
`;
