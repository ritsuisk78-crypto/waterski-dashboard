import React, { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = "https://scoggdtvfvkecudbxztw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjb2dnZHR2ZnZrZWN1ZGJ4enR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NDQ1NjUsImV4cCI6MjA5NjUyMDU2NX0.2NLXTp2rO-4NWU3vlEbLhzKoeqH5MMrxMcsWUPuojOM";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── 選手実績ローダー ───────────────────────────────────────────
async function loadPlayerByKanji(kanjiInput) {
  const kanji = kanjiInput
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[　\s]/g, "")
    .trim();
  if (!kanji) return null;
  try {
    const rows = await sbFetch("players?select=*");
    if (!rows || rows.length === 0) return null;
    const exact = rows.find(p => p.kanji && p.kanji === kanji);
    if (exact) return exact;
    const partial = rows.find(p => p.kanji && p.kanji.includes(kanji));
    return partial || null;
  } catch(e) { console.error("loadPlayerByKanji", e); return null; }
}

function safeJsonParse(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

async function loadPlayerResults(playerId) {
  try {
    const rows = await sbFetch(
      `player_results?player_id=eq.${playerId}&select=*,competitions(name,short,held_date)&order=competitions(held_date)`
    );
    return rows || [];
  } catch(e) { console.error("loadPlayerResults", e); return []; }
}

function formatScore(event, scoreRaw) {
  if (!scoreRaw || scoreRaw === "null") return null;
  if (event === "slalom") {
    const p = scoreRaw.split("/");
    if (p.length === 3) {
      const rope = parseFloat(p[2]);
      if (rope < 18.25) return `${p[0]}ブイ @${p[2]}m`;
      return `${p[0]}ブイ @${p[1]}km`;
    }
    if (p.length === 2) return `${p[0]}ブイ @${p[1]}km`;
    return scoreRaw;
  }
  if (event === "trick") return `${Number(scoreRaw).toLocaleString()}点`;
  if (event === "jump")  return `${scoreRaw}m`;
  return scoreRaw;
}

async function loadAllScores(initialData) {
  try {
    const rows = await sbFetch("scores?select=*");
    const data = JSON.parse(JSON.stringify(initialData));
    for (const row of rows || []) {
      const { gender, event, school, skier_index, name, planned, actual } = row;
      if (data[gender]?.[event]?.[school]?.[skier_index] !== undefined) {
        data[gender][event][school][skier_index] = {
          name: name || "", planned: planned || "", actual: actual || ""
        };
      }
    }
    return data;
  } catch(e) { console.error("loadAllScores error", e); return initialData; }
}

async function saveSkier(gender, event, school, idx, skier) {
  try {
    await sbFetch("scores?on_conflict=gender,event,school,skier_index", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({
        gender, event, school, skier_index: idx,
        name: skier.name, planned: skier.planned, actual: skier.actual,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch(e) { console.error("saveSkier error", e); }
}

async function loadConfig() {
  try {
    const rows = await sbFetch("app_config?select=*");
    if (rows && rows.length > 0) return JSON.parse(rows[0].value);
  } catch {}
  return null;
}

async function saveConfig(config) {
  try {
    await sbFetch("app_config?on_conflict=key", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "config", value: JSON.stringify(config) }),
    });
  } catch(e) { console.error("saveConfig error", e); }
}

// ─── 大会コード設定（Supabase） ──────────────────────────────────
async function loadCompConfig() {
  try {
    const rows = await sbFetch("app_config?key=eq.comp_config&select=*");
    if (rows && rows.length > 0) return JSON.parse(rows[0].value);
  } catch {}
  return null;
}

async function saveCompConfig(compConfig) {
  try {
    await sbFetch("app_config?on_conflict=key", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "comp_config", value: JSON.stringify(compConfig) }),
    });
  } catch(e) { console.error("saveCompConfig error", e); }
}

const C = {
  bg: "#08101e", surface: "#0f1c2e", surface2: "#162438",
  border: "#1e3050", slalom: "#00d4ff", trick: "#ff6b35",
  jump: "#a3e635", text: "#e8edf5", muted: "#6b84a0",
  accent: "#ffd700", men: "#4e9eff", women: "#ff6eb4",
  keio: "#00a0e9", positive: "#4ade80", negative: "#f87171",
  overlay: "rgba(4,10,20,0.88)",
};

const SCHOOLS = ["慶應", "法政", "立教", "福大", "学習院"];
const EVENTS  = ["slalom", "trick", "jump"];
const ECFG = {
  slalom: { label: "スラローム", short: "S", color: C.slalom, unit: "ブイ", icon: "🌊", step: "0.5" },
  trick:  { label: "トリック",   short: "T", color: C.trick,  unit: "点",   icon: "🔄", step: "100" },
  jump:   { label: "ジャンプ",   short: "J", color: C.jump,   unit: "m",    icon: "🚀", step: "0.5" },
};

const COMP_ORDER = ["cs1_2025","cs2_2025","inkare_2025","shinjin_2025","cs1_2026","cs2_2026"];
const COMP_SHORT = {
  cs1_2025:"CS1'25", cs2_2025:"CS2'25",
  inkare_2025:"全日'25", shinjin_2025:"新人'25",
  cs1_2026:"CS1'26", cs2_2026:"CS2'26",
};

const DEFAULT_CONFIG = {
  men:   { pin: { slalom: 65, trick: 10000, jump: 62 }, topN: 3, out: 4, handicap: 15, label: "男子", icon: "👨", color: C.men },
  women: { pin: { slalom: 58, trick: 8500,  jump: 44 }, topN: 2, out: 3, handicap: 10, label: "女子", icon: "👩", color: C.women },
};

function buildSkiers(count) {
  return Array.from({ length: count }, () => ({ name: "", planned: "", actual: "" }));
}
function buildInitialData() {
  const data = { men: {}, women: {} };
  for (const g of ["men", "women"]) {
    const cfg = DEFAULT_CONFIG[g];
    for (const e of EVENTS) {
      data[g][e] = {};
      for (const s of SCHOOLS) { data[g][e][s] = buildSkiers(cfg.out); }
    }
  }
  return data;
}

function applyHandicap(score, event, handicap) {
  if (event !== "jump") return score;
  const v = parseFloat(score);
  if (isNaN(v)) return null;
  return Math.max(0, v - handicap);
}

function calcConv(rawScore, event, pin, handicap) {
  const score = applyHandicap(rawScore, event, handicap);
  if (score === null || score === undefined) return null;
  const v = parseFloat(score);
  const effectivePin = event === "jump" ? Math.max(0, parseFloat(pin) - parseFloat(handicap)) : parseFloat(pin);
  if (isNaN(v) || isNaN(effectivePin) || effectivePin <= 0) return null;
  return Math.min(Math.round((v * 1000) / effectivePin), 1000);
}

function getEffectiveScore(sk, mode) {
  const a = sk.actual !== "" ? sk.actual : null;
  const p = sk.planned !== "" ? sk.planned : null;
  if (mode === "A") return a;
  return a !== null ? a : p;
}

function calcEventResult(skiers, event, pin, topN, mode, handicap) {
  const list = skiers.map((sk, i) => {
    const score = getEffectiveScore(sk, mode);
    const pts   = score !== null ? calcConv(score, event, pin, handicap) : null;
    return { idx: i, score, pts, hasActual: sk.actual !== "" };
  });
  const valid = list.filter(s => s.pts !== null).sort((a, b) => b.pts - a.pts);
  const adopted = new Set(valid.slice(0, topN).map(s => s.idx));
  const top = valid.slice(0, topN);
  const filledActual = skiers.filter(sk => sk.actual !== "").length;
  return {
    list, adopted,
    totalScore: top.length ? top.reduce((a, s) => a + parseFloat(s.score), 0) : null,
    totalPts:   top.length ? top.reduce((a, s) => a + s.pts, 0) : null,
    filledActual, total: skiers.length,
  };
}

function calcSchoolResult(schoolName, cfg, mode, data) {
  const ev = {};
  let grandTotal = null;
  for (const e of EVENTS) {
    const skiers = data[e]?.[schoolName] || [];
    ev[e] = calcEventResult(skiers, e, cfg.pin[e], cfg.topN, mode, cfg.handicap);
    if (ev[e].totalPts !== null) grandTotal = (grandTotal ?? 0) + ev[e].totalPts;
  }
  return { ev, grandTotal };
}

function getCompletedEvents(gender, data) {
  return EVENTS.filter(e =>
    SCHOOLS.every(s => {
      const skiers = data[e]?.[s] || [];
      return skiers.length > 0 && skiers.every(sk => sk.actual !== "");
    })
  );
}

function ptToUnit(ptDiff, pinVal) { return Math.abs((ptDiff * pinVal) / 1000).toFixed(1); }
function signStr(v, suffix = "") {
  if (v === null || v === undefined) return "—";
  return (v >= 0 ? "+" : "") + v + suffix;
}
function diffColor(v) { return v === null ? C.muted : v >= 0 ? C.positive : C.negative; }

const LS_KEY_DATA   = "waterski_data_v2";
const LS_KEY_CONFIG = "waterski_config_v2";

function loadFromStorage() {
  try {
    const d = localStorage.getItem(LS_KEY_DATA);
    const c = localStorage.getItem(LS_KEY_CONFIG);
    return { data: d ? JSON.parse(d) : null, config: c ? JSON.parse(c) : null };
  } catch { return { data: null, config: null }; }
}
function saveToStorage(data, config) {
  try {
    localStorage.setItem(LS_KEY_DATA, JSON.stringify(data));
    localStorage.setItem(LS_KEY_CONFIG, JSON.stringify(config));
  } catch {}
}
function clearStorage() {
  try {
    localStorage.removeItem(LS_KEY_DATA);
    localStorage.removeItem(LS_KEY_CONFIG);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────
// PLAYER HISTORY POPUP
// ─────────────────────────────────────────────────────────────────
function PlayerHistoryPopup({ kanjiInput, onClose }) {
  const [player,  setPlayer]  = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const displayName = kanjiInput.replace(/[（(]\d+[）)]/g, "").trim();

  useEffect(() => {
    if (!kanjiInput) return;
    setLoading(true);
    setError(null);
    loadPlayerByKanji(kanjiInput).then(async (p) => {
      if (!p) {
        setError(`「${displayName}」の記録が見つかりません`);
        setLoading(false);
        return;
      }
      setPlayer(p);
      const r = await loadPlayerResults(p.id);
      setResults(r);
      setLoading(false);
    });
  }, [kanjiInput]);

  const matrix = {};
  for (const r of results) {
    if (!matrix[r.competition_id]) matrix[r.competition_id] = {};
    matrix[r.competition_id][r.event] = r.score_raw;
  }

  const compIds = COMP_ORDER.filter(cid => matrix[cid]);
  const latestComp = compIds[compIds.length - 1];
  const playerEvents = player ? safeJsonParse(player.events) : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: C.overlay, backdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.surface,
          border: `1px solid ${C.accent}33`,
          borderRadius: "20px 20px 0 0",
          width: "100%", maxWidth: 600,
          padding: "20px 16px 44px",
          maxHeight: "80vh", overflowY: "auto",
        }}
      >
        <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
            background: C.men + "22", border: `1px solid ${C.men}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: C.men,
          }}>
            {displayName.charAt(0)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{displayName}</div>
            {player && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {player.school}　{player.grade}　
                <span style={{ color: player.gender === "men" ? C.men : C.women }}>
                  {player.gender === "men" ? "男子" : "女子"}
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        {playerEvents.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {playerEvents.map(e => (
              <span key={e} style={{
                fontSize: 11, padding: "3px 10px",
                background: ECFG[e].color + "22",
                border: `1px solid ${ECFG[e].color}55`,
                borderRadius: 20, color: ECFG[e].color, fontWeight: 700,
              }}>{ECFG[e].label}</span>
            ))}
          </div>
        )}
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🌊</div>
            <div style={{ fontSize: 13 }}>読み込み中...</div>
          </div>
        )}
        {!loading && error && (
          <div style={{ background: C.negative + "22", border: `1px solid ${C.negative}44`, borderRadius: 10, padding: 14, color: C.negative, fontSize: 13 }}>
            {error}
          </div>
        )}
        {!loading && !error && compIds.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 13 }}>
            過去の大会記録がありません
          </div>
        )}
        {!loading && !error && compIds.map(cid => {
          const isLatest = cid === latestComp;
          return (
            <div key={cid} style={{
              background: C.surface2,
              border: `1px solid ${isLatest ? C.accent + "55" : C.border}`,
              borderRadius: 12, padding: "12px 14px", marginBottom: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>{COMP_SHORT[cid] || cid}</span>
                {isLatest && (
                  <span style={{ fontSize: 10, background: C.accent + "22", color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 10, padding: "1px 7px" }}>最新</span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {EVENTS.map(ev => {
                  const score = matrix[cid]?.[ev];
                  const hasScore = score && score !== "null";
                  const formatted = hasScore ? formatScore(ev, score) : null;
                  return (
                    <div key={ev} style={{
                      background: hasScore ? ECFG[ev].color + "11" : C.bg,
                      border: `1px solid ${hasScore ? ECFG[ev].color + "44" : C.border}`,
                      borderRadius: 8, padding: "8px 10px",
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: hasScore ? ECFG[ev].color : C.muted, marginBottom: 4 }}>{ECFG[ev].label}</div>
                      <div style={{ fontSize: 12, fontFamily: "monospace", color: hasScore ? C.text : C.muted, fontWeight: hasScore ? 700 : 400, lineHeight: 1.4 }}>
                        {formatted || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {player?.en_names && !loading && (
          <div style={{ marginTop: 10, fontSize: 10, color: C.muted + "99", textAlign: "center" }}>
            {safeJsonParse(player.en_names).join(" / ")}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SHARED UI
// ─────────────────────────────────────────────────────────────────
function AppTab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: "none", border: "none",
      borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
      color: active ? C.accent : C.muted,
      fontSize: 13, fontWeight: active ? 700 : 400,
      padding: "10px 0", cursor: "pointer", transition: "color 0.2s",
    }}>{label}</button>
  );
}

function GenderToggle({ gender, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {[{ key: "men", label: "👨 男子", color: C.men }, { key: "women", label: "👩 女子", color: C.women }].map(g => (
        <button key={g.key} onClick={() => onChange(g.key)} style={{
          flex: 1,
          background: gender === g.key ? g.color + "22" : C.surface,
          border: `1px solid ${gender === g.key ? g.color : C.border}`,
          borderRadius: 10, color: gender === g.key ? g.color : C.muted,
          fontSize: 14, fontWeight: gender === g.key ? 700 : 400,
          padding: "10px", cursor: "pointer", transition: "all 0.2s",
        }}>{g.label}</button>
      ))}
    </div>
  );
}

function SectionHeader({ title, color, right }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, color: color || C.muted,
      background: C.bg, borderBottom: `1px solid ${C.border}`,
      padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span>{title}</span>
      {right && <span style={{ fontSize: 10, color: C.muted }}>{right}</span>}
    </div>
  );
}

function MiniProgress({ filled, total, color }) {
  const done = filled === total && total > 0;
  return (
    <span style={{ fontFamily: "monospace", fontSize: 11, color: done ? C.positive : color }}>
      {filled}/{total}{done ? " ✅" : ""}
    </span>
  );
}

function NumField({ value, onChange, placeholder, step, style = {} }) {
  return (
    <input
      type="number" inputMode="decimal" value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} step={step || "any"}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        color: C.text, fontSize: 14, padding: "8px 10px", outline: "none",
        fontFamily: "monospace", width: "100%", boxSizing: "border-box",
        WebkitAppearance: "none", ...style,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────
// PLAYER POPUP
// ─────────────────────────────────────────────────────────────────
function PlayerPopup({ gender, school, event, mode, config, data, onClose }) {
  const cfg  = config[gender];
  const ecfg = ECFG[event];
  const skiers = data[gender]?.[event]?.[school] || [];
  const result = calcEventResult(skiers, event, cfg.pin[event], cfg.topN, mode, cfg.handicap);
  const [historyTarget, setHistoryTarget] = useState(null);

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 300, background: C.overlay, backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        onClick={onClose}
      >
        <div onClick={e => e.stopPropagation()} style={{
          background: C.surface, border: `1px solid ${ecfg.color}44`,
          borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 600, padding: "20px 16px 40px",
        }}>
          <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 16px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: ecfg.color }}>{ecfg.label}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{school}　{cfg.topN}人どり</div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 11, color: C.muted }}>チーム合計</div>
              <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color: C.accent }}>
                {result.totalPts !== null ? `${result.totalPts}pt` : "—"}
              </div>
              {result.totalScore !== null && (
                <div style={{ fontSize: 11, color: ecfg.color }}>
                  {event === "jump" ? `${result.totalScore.toFixed(1)}m（ハンデ前）` : `${result.totalScore}${ecfg.unit}`}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", marginLeft: 8 }}>✕</button>
          </div>

          {skiers.map((sk, i) => {
            const score = getEffectiveScore(sk, mode);
            const pts   = score !== null ? calcConv(score, event, cfg.pin[event], cfg.handicap) : null;
            const isAdopted = result.adopted.has(i);
            const hasActual = sk.actual !== "";
            const displayScore = event === "jump" && score !== null
              ? `${score}m → ${applyHandicap(score, event, cfg.handicap)}m`
              : score !== null ? `${score}${ecfg.unit}` : "—";
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", marginBottom: 8,
                background: isAdopted ? C.accent + "11" : C.surface2,
                border: `1px solid ${isAdopted ? C.accent + "44" : C.border}`,
                borderRadius: 10,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                  background: isAdopted ? C.accent : C.surface,
                  border: `1px solid ${isAdopted ? C.accent : C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: isAdopted ? C.bg : C.muted,
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div
                    onClick={() => sk.name && setHistoryTarget(sk.name)}
                    style={{
                      fontSize: 13, fontWeight: 600,
                      color: sk.name ? C.text : C.muted,
                      cursor: sk.name ? "pointer" : "default",
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {sk.name || `選手${i + 1}`}
                    {sk.name && <span style={{ fontSize: 10, color: C.muted, opacity: 0.7 }}>📋</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>想定: {sk.planned || "—"}{ecfg.unit}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: hasActual ? ecfg.color : C.muted }}>
                    {displayScore}
                    {hasActual && <span style={{ fontSize: 9, color: C.positive, marginLeft: 4 }}>実</span>}
                  </div>
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: isAdopted ? C.accent : C.muted, fontWeight: isAdopted ? 700 : 400 }}>
                    {pts !== null ? `${pts}pt${isAdopted ? " ★" : ""}` : "—"}
                  </div>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 4, background: C.bg, borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${result.total ? result.filledActual / result.total * 100 : 0}%`,
                background: result.filledActual === result.total ? C.positive : ecfg.color,
                borderRadius: 2, transition: "width 0.3s",
              }} />
            </div>
            <MiniProgress filled={result.filledActual} total={result.total} color={ecfg.color} />
          </div>
        </div>
      </div>
      {historyTarget && (
        <PlayerHistoryPopup kanjiInput={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────────
function SettingsTab({ config, setConfig, onReset, gender }) {
  const cfg = config[gender];
  const update = (field, val) => setConfig(prev => ({ ...prev, [gender]: { ...prev[gender], [field]: val } }));
  const updatePin = (event, val) => setConfig(prev => ({ ...prev, [gender]: { ...prev[gender], pin: { ...prev[gender].pin, [event]: val } } }));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color, marginBottom: 12 }}>
          {cfg.icon} {cfg.label}　ピン想定（個人1位予想）
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {EVENTS.map(e => (
            <div key={e}>
              <div style={{ fontSize: 10, color: ECFG[e].color, marginBottom: 4 }}>{ECFG[e].label}（{ECFG[e].unit}）</div>
              <NumField value={cfg.pin[e]} onChange={v => updatePin(e, v)} placeholder={ECFG[e].label} step={ECFG[e].step} style={{ border: `1px solid ${ECFG[e].color}44`, color: ECFG[e].color }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>📋 集計設定</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>出場人数</div><NumField value={cfg.out} onChange={v => update("out", parseInt(v) || 1)} placeholder="4" step="1" /></div>
          <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>採用人数（上位N人どり）</div><NumField value={cfg.topN} onChange={v => update("topN", parseInt(v) || 1)} placeholder="3" step="1" /></div>
          <div><div style={{ fontSize: 10, color: C.jump, marginBottom: 4 }}>🚀 Jハンデ（m引き）</div><NumField value={cfg.handicap} onChange={v => update("handicap", parseFloat(v) || 0)} placeholder="15" step="0.5" style={{ border: `1px solid ${C.jump}44`, color: C.jump }} /></div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>現在：{cfg.out}人出・{cfg.topN}人どり　Jハンデ -{cfg.handicap}m</div>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.negative}33`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.negative, marginBottom: 8 }}>⚠️ データリセット</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>全ての入力データ・設定を初期化します。この操作は元に戻せません。</div>
        <button onClick={onReset} style={{ background: C.negative + "22", border: `1px solid ${C.negative}66`, borderRadius: 8, color: C.negative, fontSize: 13, fontWeight: 700, padding: "10px 20px", cursor: "pointer", width: "100%" }}>
          🗑 全データをリセット
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// INPUT TAB
// ─────────────────────────────────────────────────────────────────
function InputTab({ config, data, setData, gender, saveSkierDebounced }) {
  const [event,  setEvent]  = useState("slalom");
  const [school, setSchool] = useState("慶應");
  const [historyTarget, setHistoryTarget] = useState(null);

  const cfg   = config[gender];
  const ecfg  = ECFG[event];
  const skiers = data[gender]?.[event]?.[school] || [];

  const updateSkier = useCallback((idx, field, val) => {
    setData(prev => {
      const updated = prev[gender][event][school].map((sk, i) =>
        i === idx ? { ...sk, [field]: val } : sk
      );
      const newSkier = updated[idx];
      saveSkierDebounced(gender, event, school, idx, newSkier);
      return { ...prev, [gender]: { ...prev[gender], [event]: { ...prev[gender][event], [school]: updated } } };
    });
  }, [gender, event, school, setData, saveSkierDebounced]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {EVENTS.map(e => {
          const c = ECFG[e];
          const skrs = data[gender]?.[e]?.[school] || [];
          const f = skrs.filter(sk => sk.actual !== "").length;
          return (
            <button key={e} onClick={() => setEvent(e)} style={{
              flex: 1, background: event === e ? c.color + "22" : C.surface,
              border: `1px solid ${event === e ? c.color : C.border}`,
              borderRadius: 10, color: event === e ? c.color : C.muted,
              fontSize: 13, fontWeight: event === e ? 700 : 400,
              padding: "10px 6px", cursor: "pointer", textAlign: "center",
            }}>
              <div style={{ marginBottom: 4, fontSize: 12 }}>{c.label}</div>
              <MiniProgress filled={f} total={skrs.length} color={c.color} />
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {SCHOOLS.map(s => {
          const skrs = data[gender]?.[event]?.[s] || [];
          const f = skrs.filter(sk => sk.actual !== "").length;
          const done = f === skrs.length && skrs.length > 0;
          return (
            <button key={s} onClick={() => setSchool(s)} style={{
              background: school === s ? C.keio : C.surface,
              border: `1px solid ${school === s ? C.keio : C.border}`,
              borderRadius: 20, color: school === s ? "#fff" : C.muted,
              fontSize: 12, padding: "5px 12px", cursor: "pointer",
              fontWeight: school === s ? 700 : 400,
            }}>
              <div>{s}</div>
              <div style={{ fontSize: 10, color: school === s ? "#ffffffaa" : done ? C.positive : C.muted, fontFamily: "monospace" }}>
                {f}/{skrs.length}{done ? " ✅" : ""}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${ecfg.color}33`, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: ecfg.color, fontWeight: 700 }}>{ecfg.label}　{school}</span>
          <MiniProgress filled={skiers.filter(sk => sk.actual !== "").length} total={skiers.length} color={ecfg.color} />
        </div>
        <div style={{ height: 4, background: C.bg, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${skiers.length ? skiers.filter(sk => sk.actual !== "").length / skiers.length * 100 : 0}%`, background: ecfg.color, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
        {event === "jump" && <div style={{ fontSize: 10, color: C.jump, marginTop: 6 }}>※ Jハンデ -{cfg.handicap}m を引いて換算点を計算します</div>}
      </div>

      {skiers.map((sk, i) => {
        const hasActual = sk.actual !== "";
        const score = hasActual ? sk.actual : sk.planned !== "" ? sk.planned : null;
        const pts = score !== null ? calcConv(score, event, cfg.pin[event], cfg.handicap) : null;
        return (
          <div key={i} style={{ background: C.surface, border: `1px solid ${hasActual ? ecfg.color + "55" : C.border}`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ background: hasActual ? ecfg.color : C.surface2, borderRadius: "50%", width: 26, height: 26, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: hasActual ? C.bg : C.muted }}>
                {i + 1}
              </div>
              <input
                value={sk.name}
                onChange={e => updateSkier(i, "name", e.target.value)}
                placeholder={`選手${i + 1}（例: 内藤駿（3））`}
                style={{ background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontWeight: 700, padding: "2px 0", outline: "none", flex: 1 }}
              />
              {sk.name && (
                <button
                  onClick={() => setHistoryTarget(sk.name)}
                  style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 11, padding: "4px 10px", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}
                >
                  📋 実績
                </button>
              )}
              {hasActual && (
                <span style={{ fontSize: 10, background: C.positive + "22", color: C.positive, border: `1px solid ${C.positive}44`, borderRadius: 10, padding: "2px 8px" }}>✅</span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>想定（{ecfg.unit}）</div>
                <NumField value={sk.planned} onChange={v => updateSkier(i, "planned", v)} placeholder="—" step={ecfg.step} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: hasActual ? ecfg.color : C.muted, marginBottom: 4 }}>{hasActual ? "🔴 実際" : "実際"}</div>
                <NumField value={sk.actual} onChange={v => updateSkier(i, "actual", v)} placeholder="入力" step={ecfg.step} style={{ border: `1px solid ${hasActual ? ecfg.color + "66" : C.border}`, color: hasActual ? ecfg.color : C.text }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>換算点</div>
                <div style={{ background: pts !== null ? C.accent + "11" : C.bg, border: `1px solid ${pts !== null ? C.accent + "44" : C.border}`, borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", fontSize: 14, color: pts !== null ? C.accent : C.muted, fontWeight: pts !== null ? 700 : 400, textAlign: "center" }}>
                  {pts !== null ? `${pts}pt` : "—"}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {historyTarget && (
        <PlayerHistoryPopup kanjiInput={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// RESULT TAB
// ─────────────────────────────────────────────────────────────────
function DiffTables({ gender, schoolResults, config, completedEvents }) {
  const cfg  = config[gender];
  const keio  = schoolResults.find(r => r.school === "慶應");
  const others = schoolResults.filter(r => r.school !== "慶應");
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.accent}33`, borderRadius: 12, overflow: "hidden" }}>
        <SectionHeader title="総合　慶應 vs 各校" color={C.accent} />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted, width: "28%" }}>学校</th>
              <th style={{ padding: "6px 8px", textAlign: "center", color: C.accent }}>換算点差</th>
              {EVENTS.map(e => (
                <th key={e} style={{ padding: "6px 8px", textAlign: "center", color: ECFG[e].color }}>
                  {ECFG[e].label}{completedEvents.includes(e) ? "✅" : ""}換算
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {others.map(r => {
              const d = keio.result.grandTotal !== null && r.result.grandTotal !== null ? keio.result.grandTotal - r.result.grandTotal : null;
              return (
                <tr key={r.school} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: C.text }}>{r.school}</td>
                  <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: diffColor(d) }}>{signStr(d, "pt")}</td>
                  {EVENTS.map(e => (
                    <td key={e} style={{ padding: "8px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11, color: d === null ? C.muted : ECFG[e].color }}>
                      {d === null ? "—" : `${d >= 0 ? "+" : "-"}${ptToUnit(Math.abs(d), cfg.pin[e])}${ECFG[e].unit}`}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {EVENTS.map(e => {
        const ecfg = ECFG[e];
        const done = completedEvents.includes(e);
        return (
          <div key={e} style={{ background: C.surface, border: `1px solid ${ecfg.color}33`, borderRadius: 12, overflow: "hidden" }}>
            <SectionHeader title={`${ecfg.label}　慶應 vs 各校${done ? " ✅完了" : ""}`} color={done ? C.positive : ecfg.color} right="得点差 / 換算pt差" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted, width: "28%" }}>学校</th>
                  <th style={{ padding: "6px 8px", textAlign: "center" }}><div style={{ color: ecfg.color }}>得点差（{ecfg.unit}）</div><div style={{ color: C.accent, fontSize: 10 }}>換算点差（pt）</div></th>
                  <th style={{ padding: "6px 8px", textAlign: "center", color: C.muted, fontSize: 10 }}><div>慶應</div><div>相手</div></th>
                </tr>
              </thead>
              <tbody>
                {others.map(r => {
                  const kEv = keio.result.ev[e];
                  const rEv = r.result.ev[e];
                  const ptDiff = kEv.totalPts !== null && rEv.totalPts !== null ? kEv.totalPts - rEv.totalPts : null;
                  const sDiff  = kEv.totalScore !== null && rEv.totalScore !== null ? parseFloat((kEv.totalScore - rEv.totalScore).toFixed(1)) : null;
                  return (
                    <tr key={r.school} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: C.text }}>{r.school}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>
                        <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: diffColor(sDiff) }}>{sDiff !== null ? `${sDiff >= 0 ? "+" : ""}${sDiff}${ecfg.unit}` : "—"}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: diffColor(ptDiff), marginTop: 2 }}>{signStr(ptDiff, "pt")}</div>
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontSize: 11 }}>
                        <div style={{ color: C.keio }}>{kEv.filledActual}/{kEv.total}</div>
                        <div style={{ color: C.muted }}>{rEv.filledActual}/{rEv.total}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function EventBreakdown({ gender, schoolResults, mode, config, data }) {
  const [popup, setPopup] = useState(null);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {EVENTS.map(e => {
        const ecfg = ECFG[e];
        return (
          <div key={e} style={{ background: C.surface, border: `1px solid ${ecfg.color}33`, borderRadius: 12, overflow: "hidden" }}>
            <SectionHeader title={`${ecfg.label}　内訳`} color={ecfg.color} right="行をタップで選手詳細 ▶" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted }}>学校</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", color: ecfg.color }}>得点</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", color: C.accent }}>換算pt</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", color: C.muted, fontSize: 10 }}>入力</th>
                </tr>
              </thead>
              <tbody>
                {schoolResults.map(({ school, result }) => {
                  const ev = result.ev[e];
                  return (
                    <tr key={school} onClick={() => setPopup({ school, event: e })} style={{ borderBottom: `1px solid ${C.border}`, background: school === "慶應" ? C.keio + "11" : "transparent", cursor: "pointer" }}>
                      <td style={{ padding: "10px 10px", fontWeight: school === "慶應" ? 700 : 400, color: school === "慶應" ? C.keio : C.text }}>
                        {school} <span style={{ fontSize: 10, color: C.muted }}>▶</span>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center", fontFamily: "monospace", color: ecfg.color }}>
                        {ev.totalScore !== null ? `${e === "jump" ? ev.totalScore.toFixed(1) : ev.totalScore}${ecfg.unit}` : "—"}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center", fontFamily: "monospace", color: C.accent, fontWeight: 700 }}>
                        {ev.totalPts !== null ? `${ev.totalPts}pt` : "—"}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        <MiniProgress filled={ev.filledActual} total={ev.total} color={ecfg.color} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {popup && <PlayerPopup gender={gender} school={popup.school} event={popup.event} mode="B" config={config} data={data} onClose={() => setPopup(null)} />}
    </div>
  );
}

function ResultTab({ config, data, gender }) {
  const [mode, setMode] = useState("B");
  const [view, setView] = useState("diff");
  const cfg = config[gender];
  const schoolResults = SCHOOLS.map(school => ({ school, result: calcSchoolResult(school, cfg, mode, data[gender] || {}) }));
  const completedEvents = getCompletedEvents(gender, data[gender] || {});

  return (
    <div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[{ key: "A", title: "Aモード", sub: "入力済みのみ" }, { key: "B", title: "Bモード", sub: "実際＋想定混在" }].map(m => (
            <button key={m.key} onClick={() => setMode(m.key)} style={{ flex: 1, background: mode === m.key ? C.accent + "22" : C.surface2, border: `1px solid ${mode === m.key ? C.accent : C.border}`, borderRadius: 8, color: mode === m.key ? C.accent : C.muted, fontSize: 13, fontWeight: mode === m.key ? 700 : 400, padding: "8px 10px", cursor: "pointer" }}>
              <div>{m.title}</div><div style={{ fontSize: 10, marginTop: 2 }}>{m.sub}</div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 6 }}>入力進捗</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {EVENTS.map(e => {
            const ecfg = ECFG[e];
            const done = completedEvents.includes(e);
            return (
              <div key={e}>
                <div style={{ fontSize: 10, color: done ? C.positive : ecfg.color, marginBottom: 4 }}>{ecfg.label}{done ? " ✅" : ""}</div>
                {SCHOOLS.map(s => {
                  const skrs = data[gender]?.[e]?.[s] || [];
                  const f = skrs.filter(sk => sk.actual !== "").length;
                  const t = skrs.length;
                  const sdone = f === t && t > 0;
                  return (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                      <div style={{ fontSize: 10, color: s === "慶應" ? C.keio : C.muted, width: 38, flexShrink: 0 }}>{s}</div>
                      <div style={{ flex: 1, height: 3, background: C.bg, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${t ? f / t * 100 : 0}%`, background: sdone ? C.positive : ecfg.color, borderRadius: 2 }} />
                      </div>
                      <div style={{ fontSize: 10, color: sdone ? C.positive : C.muted, fontFamily: "monospace", width: 22, textAlign: "right" }}>{f}/{t}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 14 }}>
        {schoolResults.map(({ school, result }) => (
          <div key={school} style={{ background: school === "慶應" ? C.keio + "22" : C.surface, border: `1px solid ${school === "慶應" ? C.keio : C.border}`, borderRadius: 10, padding: "8px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: school === "慶應" ? C.keio : C.text, marginBottom: 4 }}>{school}</div>
            <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: school === "慶應" ? C.keio : C.text }}>{result.grandTotal ?? "—"}</div>
            <div style={{ fontSize: 9, color: C.muted }}>pt</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[{ key: "diff", label: "📉 差分分析" }, { key: "breakdown", label: "📋 種目別内訳" }].map(v => (
          <button key={v.key} onClick={() => setView(v.key)} style={{ flex: 1, background: view === v.key ? C.surface : C.surface2, border: `1px solid ${view === v.key ? C.accent : C.border}`, borderRadius: 8, color: view === v.key ? C.accent : C.muted, fontSize: 13, fontWeight: view === v.key ? 700 : 400, padding: "8px", cursor: "pointer" }}>{v.label}</button>
        ))}
      </div>

      {view === "diff" && <DiffTables gender={gender} schoolResults={schoolResults} config={config} completedEvents={completedEvents} />}
      {view === "breakdown" && <EventBreakdown gender={gender} schoolResults={schoolResults} mode={mode} config={config} data={data} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 速報タブ：結果ボタン
// ─────────────────────────────────────────────────────────────────
function ResultButtons({ compCode }) {
  const [open, setOpen] = useState(null);

  const events = [
    { key: "ms", gender: "men",   event: "slalom", label: "スラローム", gLabel: "男子" },
    { key: "ws", gender: "women", event: "slalom", label: "スラローム", gLabel: "女子" },
    { key: "mt", gender: "men",   event: "trick",  label: "トリック",   gLabel: "男子" },
    { key: "wt", gender: "women", event: "trick",  label: "トリック",   gLabel: "女子" },
    { key: "mj", gender: "men",   event: "jump",   label: "ジャンプ",   gLabel: "男子" },
    { key: "wj", gender: "women", event: "jump",   label: "ジャンプ",   gLabel: "女子" },
  ];

  function getPdfUrl(code, genderKey, eventKey, round) {
    const year = code.slice(0, 2);
    const base = `https://www.iwwfed-ea.org/classic/${year}/${code}/`;
    const gStr = genderKey === "men" ? "men" : "women";
    if (round === "round1") return `${base}${gStr}_${eventKey}_round_1_results.pdf`;
    return `${base}${gStr}_${eventKey}_overall_results.pdf`;
  }

  function toggle(key) { setOpen(prev => prev === key ? null : key); }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ background: "#0d1e3a", padding: "9px 14px", fontSize: 11, fontWeight: 700, color: C.slalom, letterSpacing: "0.06em" }}>
        📄 結果ページ（PDF）
      </div>
      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {events.map(ev => {
          const isOpen = open === ev.key;
          const ecfg = ECFG[ev.event];
          return (
            <React.Fragment key={ev.key}>
              <div
                onClick={() => toggle(ev.key)}
                style={{
                  background: isOpen ? "#1a2f55" : "#141d35",
                  border: `1px solid ${isOpen ? C.slalom : "#1e2a4a"}`,
                  borderRadius: 7, padding: "10px 8px",
                  textAlign: "center", cursor: "pointer", transition: "all 0.15s",
                }}
              >
                <span style={{ display: "block", fontSize: 9, color: isOpen ? C.slalom : "#4a6a9a", marginBottom: 2 }}>{ev.gLabel}</span>
                <span style={{ display: "block", fontSize: 12, color: isOpen ? C.slalom : ecfg.color, fontWeight: 600 }}>{ev.label}</span>
                <span style={{ fontSize: 9, color: isOpen ? C.slalom : "#4a6a9a", marginTop: 3, display: "block" }}>{isOpen ? "▲" : "▼"}</span>
              </div>

              {isOpen && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ background: "#0a1020", border: "1px solid #1e3060", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ fontSize: 10, color: "#4a6a9a", padding: "2px 6px 6px", borderBottom: "1px solid #1a2540", marginBottom: 2 }}>
                      {ev.gLabel}{ev.label} — 結果を選択
                    </div>
                    {["round1", "overall"].map(round => (
                      compCode ? (
                        <a key={round} href={getPdfUrl(compCode, ev.gender, ev.event, round)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#141d35", border: "1px solid #1e2a4a", borderRadius: 6, padding: "9px 12px", cursor: "pointer" }}>
                            <div>
                              <div style={{ fontSize: 12, color: C.text }}>{round === "round1" ? "Round 1 結果" : "Overall（最終結果）"}</div>
                              <div style={{ fontSize: 10, color: "#4a6a9a" }}>{round === "round1" ? "1本目の全選手スコア" : "総合順位・確定スコア"}</div>
                            </div>
                            <span style={{ fontSize: 9, background: "#1a3060", color: C.slalom, padding: "2px 6px", borderRadius: 3 }}>PDF</span>
                          </div>
                        </a>
                      ) : (
                        <div key={round} style={{ background: "#141d35", border: "1px solid #1e2a4a", borderRadius: 6, padding: "9px 12px", opacity: 0.4 }}>
                          <div style={{ fontSize: 12, color: C.muted }}>{round === "round1" ? "Round 1 結果" : "Overall（最終結果）"}</div>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 速報タブ本体
// ─────────────────────────────────────────────────────────────────
function SokuhoTab() {
  const [compCode, setCompCode] = useState("");
  const [compName, setCompName] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [inputName, setInputName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadCompConfig().then(cfg => {
      if (cfg) {
        setCompCode(cfg.code || "");
        setCompName(cfg.name || "");
        setInputCode(cfg.code || "");
        setInputName(cfg.name || "");
      }
    });
    // X widgets.js を動的に読み込む
    if (!document.getElementById("twitter-wjs")) {
      const s = document.createElement("script");
      s.id = "twitter-wjs";
      s.src = "https://platform.twitter.com/widgets.js";
      s.async = true;
      document.body.appendChild(s);
    }
  }, []);

  // Xウィジェットを再レンダリング
  useEffect(() => {
  const tryLoad = () => {
    if (window.twttr && window.twttr.widgets) {
      window.twttr.widgets.load();
    } else {
      setTimeout(tryLoad, 500);
    }
  };
  tryLoad();
}, []);

  const iwwfLiveUrl = compCode
    ? `https://www.iwwfed-ea.org/competition.php?cc=T-${compCode}&page=live`
    : null;

  const previewUrl = inputCode
    ? `https://www.iwwfed-ea.org/competition.php?cc=T-${inputCode}&page=live`
    : null;

  async function handleSave() {
    setSaving(true);
    const cfg = { code: inputCode.trim().toUpperCase(), name: inputName.trim() };
    await saveCompConfig(cfg);
    setCompCode(cfg.code);
    setCompName(cfg.name);
    setSaving(false);
    setSaved(true);
    setTimeout(() => { setSaved(false); setSettingsOpen(false); }, 1200);
  }

  return (
    <div>
      {/* 大会コード設定 */}
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => setSettingsOpen(v => !v)}
          style={{
            width: "100%", background: settingsOpen ? "#0d1e3a" : C.surface,
            border: `1px solid ${settingsOpen ? C.slalom : C.border}`,
            borderRadius: settingsOpen ? "10px 10px 0 0" : 10,
            color: settingsOpen ? C.slalom : C.muted,
            fontSize: 12, fontWeight: 700, padding: "10px 14px",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span>⚙️ 大会コード設定</span>
          {compCode && !settingsOpen && (
            <span style={{ fontSize: 10, background: "#1a3060", color: C.slalom, padding: "2px 8px", borderRadius: 10, marginLeft: "auto" }}>
              T-{compCode}
            </span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 10 }}>{settingsOpen ? "▲" : "▼"}</span>
        </button>

        {settingsOpen && (
          <div style={{ background: C.surface, border: `1px solid #2a3a5a`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: 14 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#4a6a9a", marginBottom: 6 }}>大会コード（IWWF）</div>
              <div style={{ display: "flex" }}>
                <span style={{ background: "#0a1020", border: "1px solid #1e2a4a", borderRight: "none", borderRadius: "6px 0 0 6px", color: "#3a4a6a", fontSize: 12, padding: "8px 10px" }}>T-</span>
                <input
                  type="text" value={inputCode}
                  onChange={e => setInputCode(e.target.value.toUpperCase())}
                  placeholder="26JPN007" maxLength={10}
                  style={{ flex: 1, background: "#0a1020", border: "1px solid #1e2a4a", borderRadius: "0 6px 6px 0", color: C.text, fontSize: 13, padding: "8px 10px", outline: "none", fontFamily: "monospace" }}
                />
              </div>
              <div style={{ marginTop: 6, background: "#060c1a", border: "1px solid #1a2035", borderRadius: 6, padding: "7px 10px", fontSize: 10, color: previewUrl ? "#5a8aaa" : "#3a4a6a", fontFamily: "monospace", wordBreak: "break-all" }}>
                {previewUrl || "大会コードを入力するとURLが表示されます"}
              </div>
              <div style={{ fontSize: 10, color: "#3a4560", marginTop: 4, lineHeight: 1.5 }}>
                IWWFのURLから確認。例）<span style={{ color: C.slalom, fontFamily: "monospace" }}>cc=T-26JPN007</span> の <span style={{ color: C.slalom, fontFamily: "monospace" }}>26JPN007</span> 部分
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#4a6a9a", marginBottom: 6 }}>大会名（表示用）</div>
              <input
                type="text" value={inputName}
                onChange={e => setInputName(e.target.value)}
                placeholder="例：関東学生春季大会 CS2"
                style={{ width: "100%", background: "#0a1020", border: "1px solid #1e2a4a", borderRadius: 6, color: C.text, fontSize: 13, padding: "8px 10px", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <button
              onClick={handleSave} disabled={saving}
              style={{ width: "100%", background: saved ? C.positive + "22" : "#1a3a6a", border: `1px solid ${saved ? C.positive : C.slalom}`, borderRadius: 8, color: saved ? C.positive : C.slalom, fontSize: 13, fontWeight: 700, padding: "11px", cursor: "pointer" }}
            >
              {saved ? "✓ 保存しました" : saving ? "保存中..." : "保存する"}
            </button>
          </div>
        )}
      </div>

      {/* 大会ステータス */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#0a1020", borderRadius: 8, marginBottom: 12, fontSize: 11, color: compCode ? "#5abf8a" : "#4a5580" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: compCode ? "#4aaa7a" : "#5a5a6a", display: "inline-block", flexShrink: 0 }} />
        <span>{compCode ? `${compName || "大会"}（T-${compCode}）` : "大会コード未設定 — ⚙️から設定してください"}</span>
      </div>

      {/* IWWFライブスコア */}
      <div style={{ background: C.surface, border: "1px solid #1e3a6e", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ background: "#0d2045", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: C.slalom }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: compCode ? "#ff4444" : "#5a5a6a", display: "inline-block", animation: compCode ? "liveblink 1.2s infinite" : "none" }} />
            IWWF ライブスコア
          </div>
          {iwwfLiveUrl && (
            <a href={iwwfLiveUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#4a6a9a", textDecoration: "none", border: "1px solid #1e3060", borderRadius: 4, padding: "2px 7px" }}>別窓 ↗</a>
          )}
        </div>
        {compCode ? (
          <iframe src={iwwfLiveUrl} style={{ width: "100%", height: 300, border: "none", background: "#fff" }} title="IWWF Live Score" sandbox="allow-scripts allow-same-origin" />
        ) : (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🏁</div>
            <div style={{ fontSize: 12, color: "#3a4a6a", lineHeight: 1.6 }}>大会コードを設定すると<br />ライブスコアが表示されます</div>
          </div>
        )}
      </div>

    {/* Xタイムライン */}
      <div style={{ background: C.surface, border: "1px solid #1e2a4a", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ background: "#0a1a30", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slalom, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>𝕏</span>
            @JCWFgakuren 速報
          </div>
        </div>
        <a href="https://twitter.com/JCWFgakuren" target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "24px 16px", textDecoration: "none", background: "#000" }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>𝕏</span>
          <span style={{ fontSize: 13, color: "#7eb8f7", fontWeight: 700 }}>@JCWFgakuren のポストを見る →</span>
        </a>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("input");
  const [gender, setGender] = useState("men");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const saveTimers = useRef({});
  const configTimer = useRef(null);

  const [config, setConfig] = useState({ men: { ...DEFAULT_CONFIG.men }, women: { ...DEFAULT_CONFIG.women } });
  const [data, setData] = useState(buildInitialData());

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAllScores(buildInitialData()), loadConfig()]).then(([loadedData, loadedConfig]) => {
      setData(loadedData);
      if (loadedConfig) {
        setConfig({ men: { ...DEFAULT_CONFIG.men, ...loadedConfig.men }, women: { ...DEFAULT_CONFIG.women, ...loadedConfig.women } });
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const [loadedData, loadedConfig] = await Promise.all([loadAllScores(buildInitialData()), loadConfig()]);
      setData(loadedData);
      if (loadedConfig) {
        setConfig(prev => ({
          men:   { ...DEFAULT_CONFIG.men,   ...loadedConfig.men,   pin: { ...prev.men.pin,   ...loadedConfig.men?.pin   } },
          women: { ...DEFAULT_CONFIG.women, ...loadedConfig.women, pin: { ...prev.women.pin, ...loadedConfig.women?.pin } },
        }));
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    clearTimeout(configTimer.current);
    configTimer.current = setTimeout(async () => {
      setSyncing(true);
      await saveConfig(config);
      setSyncing(false);
    }, 1000);
  }, [config]);

  const saveSkierDebounced = useCallback((gender, event, school, idx, skier) => {
    const key = `${gender}-${event}-${school}-${idx}`;
    clearTimeout(saveTimers.current[key]);
    setSyncing(true);
    saveTimers.current[key] = setTimeout(async () => {
      await saveSkier(gender, event, school, idx, skier);
      setSyncing(false);
    }, 800);
  }, []);

  const handleReset = async () => {
    if (window.confirm("全データをリセットしますか？この操作は元に戻せません。")) {
      clearStorage();
      const resetConfig = { men: { ...DEFAULT_CONFIG.men }, women: { ...DEFAULT_CONFIG.women } };
      setConfig(resetConfig);
      setData(buildInitialData());
      await saveConfig(resetConfig);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Segoe UI','Helvetica Neue',sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: C.bg + "ee", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "10px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: C.slalom, fontFamily: "'Georgia',serif", letterSpacing: "-0.02em" }}>WaterSki</span>
            <span style={{ fontSize: 12, color: C.muted }}>団体戦</span>
            <span style={{ fontSize: 10, background: C.accent + "22", color: C.accent, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.accent}44`, marginLeft: "auto" }}>IWWF換算点</span>
            {loading && <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>読込中...</span>}
            {syncing && !loading && <span style={{ fontSize: 10, color: C.positive, marginLeft: 6 }}>💾保存中</span>}
          </div>
          {/* 速報タブ以外は男女切替を表示 */}
          {tab !== "sokuho" && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, marginBottom: 6 }}>
              {[{ key: "men", label: "👨 男子", color: C.men }, { key: "women", label: "👩 女子", color: C.women }].map(g => (
                <button key={g.key} onClick={() => setGender(g.key)} style={{ flex: 1, background: gender === g.key ? g.color + "22" : "transparent", border: `1px solid ${gender === g.key ? g.color : C.border}`, borderRadius: 8, color: gender === g.key ? g.color : C.muted, fontSize: 13, fontWeight: gender === g.key ? 700 : 400, padding: "6px", cursor: "pointer", transition: "all 0.2s" }}>{g.label}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginTop: tab === "sokuho" ? 10 : 0 }}>
            <AppTab label="⚙️ 設定" active={tab === "settings"} onClick={() => setTab("settings")} />
            <AppTab label="📝 入力" active={tab === "input"}    onClick={() => setTab("input")} />
            <AppTab label="📊 結果" active={tab === "result"}   onClick={() => setTab("result")} />
            <AppTab label="📡 速報" active={tab === "sokuho"}   onClick={() => setTab("sokuho")} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
        {loading && tab !== "sokuho" && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🌊</div>
            <div style={{ fontSize: 14 }}>データを読み込んでいます...</div>
          </div>
        )}
        {!loading && tab === "settings" && <SettingsTab config={config} setConfig={setConfig} onReset={handleReset} gender={gender} />}
        {!loading && tab === "input"    && <InputTab config={config} data={data} setData={setData} gender={gender} saveSkierDebounced={saveSkierDebounced} />}
        {!loading && tab === "result"   && <ResultTab config={config} data={data} gender={gender} />}
        {tab === "sokuho"               && <SokuhoTab />}
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px 40px" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, color: C.muted, lineHeight: 1.8 }}>
          ☁️ データはSupabaseに自動保存・リアルタイム同期されます（10秒ごと更新）。設定タブからリセット可能です。
        </div>
      </div>
    </div>
  );
}
