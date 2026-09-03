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

const SLALOM_ROPE_SEQUENCE = [16, 14.25, 13, 12, 11.25, 10.75, 10.25, 9.75];
function slalomBreakdown(totalBuoys, gender) {
  const v = parseFloat(totalBuoys);
  if (isNaN(v) || v < 0) return null;
  const maxSpeed = gender === "women" ? 55 : 58;
  const startSpeed = maxSpeed - 9;
  const speedSteps = (maxSpeed - startSpeed) / 3;
  const buoysPerPass = 6;

  const fullPasses = Math.floor(v / buoysPerPass);
  const partial = Math.round((v - fullPasses * buoysPerPass) * 100) / 100;

  if (fullPasses <= speedSteps) {
    const speed = startSpeed + 3 * fullPasses;
    return `${partial}@${speed}km`;
  }
  const ropeIdx = fullPasses - speedSteps - 1;
  const rope = SLALOM_ROPE_SEQUENCE[Math.min(ropeIdx, SLALOM_ROPE_SEQUENCE.length - 1)];
  return `${partial}@${rope}m`;
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

async function saveSkier(gender, event, school, idx, field, value) {
  try {
    await sbFetch("scores?on_conflict=gender,event,school,skier_index", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({
        gender, event, school, skier_index: idx,
        [field]: value,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch(e) { console.error("saveSkier error", e); }
}
async function resetAllActuals() {
  try {
    await sbFetch("scores?gender=in.(men,women)", {
      method: "PATCH",
      body: JSON.stringify({ actual: "" }),
    });
  } catch(e) { console.error("resetAllActuals error", e); }
}
async function loadConfig() {
  try {
    const rows = await sbFetch("app_config?key=eq.config&select=*");
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

async function uploadStartlistPhoto(file, title) {
  try {
    const fileExt = file.name.split(".").pop();
    const filePath = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/startlist-photos/${filePath}`,
      {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": file.type,
        },
        body: file,
      }
    );
    if (!uploadRes.ok) throw new Error(await uploadRes.text());
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/startlist-photos/${filePath}`;
    const list = await loadStartlistPhotos();
    const updated = [...list, { url: publicUrl, title: title || "", path: filePath }];
    await saveStartlistPhotos(updated);
    return updated;
  } catch(e) { console.error("uploadStartlistPhoto error", e); return null; }
}

async function loadStartlistPhotos() {
  try {
    const rows = await sbFetch("app_config?key=eq.startlist_photos&select=*");
    if (rows && rows.length > 0) return JSON.parse(rows[0].value);
  } catch {}
  return [];
}

async function saveStartlistPhotos(list) {
  try {
    await sbFetch("app_config?on_conflict=key", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "startlist_photos", value: JSON.stringify(list) }),
    });
  } catch(e) { console.error("saveStartlistPhotos error", e); }
}

async function deleteStartlistPhoto(path) {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/startlist-photos/${path}`, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    const list = await loadStartlistPhotos();
    const updated = list.filter(p => p.path !== path);
    await saveStartlistPhotos(updated);
    return updated;
  } catch(e) { console.error("deleteStartlistPhoto error", e); return null; }
}

async function saveStartlistUrl(url) {
  try {
    await sbFetch("app_config?on_conflict=key", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "startlist_url", value: JSON.stringify({ url }) }),
    });
  } catch(e) { console.error("saveStartlistUrl error", e); }
}

async function loadStartlistUrl() {
  try {
    const rows = await sbFetch("app_config?key=eq.startlist_url&select=*");
    if (rows && rows.length > 0) return JSON.parse(rows[0].value).url || "";
  } catch {}
  return "";
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

const COMP_ORDER = ["cs1_2025","cs2_2025","inkare_2025","shinjin_2025","cs1_2026","cs2_2026","kizuna_2026","hogaku_2026","biwa_2026","asaichi1_2026","asaichi2_2026","asaichi3_2026","asaichi4_2026"];

const COMP_SHORT = {
  cs1_2025:"CS1'25", cs2_2025:"CS2'25",
  inkare_2025:"全日'25", shinjin_2025:"新人'25",
  cs1_2026:"CS1'26", cs2_2026:"CS2'26", kizuna_2026:"絆'26", hogaku_2026:"法学戦'26",
  asaichi1_2026:"朝一①'26", asaichi2_2026:"朝一②'26", asaichi3_2026:"朝一③'26", asaichi4_2026:"朝一④'26", biwa_2026:"琵琶湖'26",
};

const DEFAULT_CONFIG = {
  men:   { pin: { slalom: 40, trick: 5500, jump: 50 }, topN: 3, out: 4, handicap: 20, label: "男子", icon: "👨", color: C.men },
  women: { pin: { slalom: 32, trick: 2900, jump: 29 }, topN: 2, out: 3, handicap: 10, label: "女子", icon: "👩", color: C.women },
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
  return Math.round(Math.max(0, v - handicap) * 100) / 100;
}

function calcConv(rawScore, event, pin, handicap) {
  const score = applyHandicap(rawScore, event, handicap);
  if (score === null || score === undefined) return null;
  const v = parseFloat(score);
  const effectivePin = event === "jump" ? Math.max(0, parseFloat(pin) - parseFloat(handicap)) : parseFloat(pin);
  if (isNaN(v) || isNaN(effectivePin) || effectivePin <= 0) return null;
  return Math.min(Math.round((v * 1000) / effectivePin * 10) / 10, 1000);
}

function getEffectiveScore(sk, mode) {
  const a = sk.actual !== "" ? sk.actual : null;
  const p = sk.planned !== "" ? sk.planned : null;
  if (mode === "A") return a;
  if (mode === "P") return p;
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
  return (v >= 0 ? "+" : "") + v.toFixed(1) + suffix;
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
                <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
                  {COMP_SHORT[cid] || cid}
                </span>
                {isLatest && (
                  <span style={{ fontSize: 10, background: C.accent + "22", color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 10, padding: "1px 7px" }}>
                    最新
                  </span>
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
                      <div style={{ fontSize: 10, fontWeight: 700, color: hasScore ? ECFG[ev].color : C.muted, marginBottom: 4 }}>
                        {ECFG[ev].label}
                      </div>
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
      type="text" inputMode="decimal" value={value}
      onChange={e => {
        const v = e.target.value;
        const ok = v === "" || v === "-" || v === "." || /^-?[0-9]*\.?[0-9]*$/.test(v);
        if (ok) onChange(v);
      }}
      placeholder={placeholder}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        color: C.text, fontSize: 14, padding: "8px 10px", outline: "none",
        fontFamily: "monospace", width: "100%", boxSizing: "border-box",
        WebkitAppearance: "none", ...style,
      }}
    />
  );
}

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
                {result.totalPts !== null ? `${result.totalPts.toFixed(1)}pt` : "—"}
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
                    {sk.name && (
                      <span style={{ fontSize: 10, color: C.muted, opacity: 0.7 }}>📋</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>
                    想定: {sk.planned || "—"}{ecfg.unit}
                    {event === "slalom" && sk.planned !== "" && ` （${slalomBreakdown(sk.planned, gender)}）`}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: hasActual ? ecfg.color : C.muted }}>
                    {displayScore}
                    {hasActual && <span style={{ fontSize: 9, color: C.positive, marginLeft: 4 }}>実</span>}
                  </div>
                  {event === "slalom" && score !== null && (
                    <div style={{ fontSize: 10, color: C.muted }}>（{slalomBreakdown(score, gender)}）</div>
                  )}
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: isAdopted ? C.accent : C.muted, fontWeight: isAdopted ? 700 : 400 }}>
                    {pts !== null ? `${pts.toFixed(1)}pt${isAdopted ? " ★" : ""}` : "—"}
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

function SettingsTab({ config, setConfig, onReset, onSave, saving, saved, gender, onResetActuals, resettingActuals, actualsReset }) {
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
        {(() => {
          const effJump = parseFloat(cfg.pin.jump) - parseFloat(cfg.handicap);
          if (!(effJump > 0)) return null;
          const slalomEquiv = (parseFloat(cfg.pin.slalom) / effJump).toFixed(2);
          const trickEquiv = Math.round(parseFloat(cfg.pin.trick) / effJump);
          return (
            <div style={{ marginTop: 6, fontSize: 11, color: C.jump }}>
              ジャンプ1m ≒ スラローム{slalomEquiv}ブイ ≒ トリック{trickEquiv}点（現ピン・ハンデ換算）
            </div>
          );
        })()}
      </div>
      <button
        onClick={onSave}
        disabled={saving}
        style={{
          background: saved ? C.positive + "22" : "#1a3a6a",
          border: `1px solid ${saved ? C.positive : C.accent}`,
          borderRadius: 10, color: saved ? C.positive : C.accent,
          fontSize: 14, fontWeight: 700, padding: "13px",
          cursor: "pointer", width: "100%", transition: "all 0.2s",
        }}
      >
        {saved ? "✓ 保存しました" : saving ? "保存中..." : "💾 設定を保存する"}
      </button>

            <div style={{ background: C.surface, border: `1px solid ${C.accent}33`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 8 }}>🔄 「実際」だけリセット</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>全種目・全校の「実際」の記録だけを消去します。「想定」はそのまま残るので、朝一やシミュレーションの前に使えます。</div>
        <button
          onClick={onResetActuals}
          disabled={resettingActuals}
          style={{
            background: actualsReset ? C.positive + "22" : C.accent + "22",
            border: `1px solid ${actualsReset ? C.positive : C.accent}66`,
            borderRadius: 8, color: actualsReset ? C.positive : C.accent,
            fontSize: 13, fontWeight: 700, padding: "10px 20px", cursor: "pointer", width: "100%",
          }}
        >
          {actualsReset ? "✓ リセットしました" : resettingActuals ? "リセット中..." : "🔄 「実際」の記録だけリセット"}
        </button>
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
      return { ...prev, [gender]: { ...prev[gender], [event]: { ...prev[gender][event], [school]: updated } } };
    });
    saveSkierDebounced(gender, event, school, idx, field, val);
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
                {event === "slalom" && sk.planned !== "" && (
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>（{slalomBreakdown(sk.planned, gender)}）</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: hasActual ? ecfg.color : C.muted, marginBottom: 4 }}>{hasActual ? "🔴 実際" : "実際"}</div>
                <NumField value={sk.actual} onChange={v => updateSkier(i, "actual", v)} placeholder="入力" step={ecfg.step} style={{ border: `1px solid ${hasActual ? ecfg.color + "66" : C.border}`, color: hasActual ? ecfg.color : C.text }} />
                {event === "slalom" && sk.actual !== "" && (
                  <div style={{ fontSize: 10, color: ecfg.color, marginTop: 2 }}>（{slalomBreakdown(sk.actual, gender)}）</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>換算点</div>
                <div style={{ background: pts !== null ? C.accent + "11" : C.bg, border: `1px solid ${pts !== null ? C.accent + "44" : C.border}`, borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", fontSize: 14, color: pts !== null ? C.accent : C.muted, fontWeight: pts !== null ? 700 : 400, textAlign: "center" }}>
 {pts !== null ? `${pts.toFixed(1)}pt` : "—"}
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

function DiffTables({ gender, schoolResults, config, completedEvents, data, mode }) {
  const cfg  = config[gender];
  const keio  = schoolResults.find(r => r.school === "慶應");
  const others = schoolResults.filter(r => r.school !== "慶應");
  const [diffPopup, setDiffPopup] = useState(null);

  const keioPlannedSchoolResult = calcSchoolResult("慶應", cfg, "P", data[gender] || {});

  return (
    <>
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.accent}33`, borderRadius: 12, overflow: "hidden" }}>
        <SectionHeader title="総合　慶應 vs 各校" color={C.accent} />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted, width: "28%" }}>学校</th>
              <th style={{ padding: "6px 8px", textAlign: "center", color: C.accent }}>換算点差</th>
              {EVENTS.map(e => (
                <th key={e} style={{ padding: "4px 4px", textAlign: "center", color: ECFG[e].color, fontSize: 10, whiteSpace: "nowrap" }}>
                  {ECFG[e].short}{completedEvents.includes(e) ? "✅" : ""}換算
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
                  {EVENTS.map(e => {
                    const effPin = e === "jump" ? Math.max(0, parseFloat(cfg.pin[e]) - parseFloat(cfg.handicap)) : parseFloat(cfg.pin[e]);
                    return (
                      <td key={e} style={{ padding: "6px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 11, color: d === null ? C.muted : ECFG[e].color, whiteSpace: "nowrap" }}>
                        {d === null ? "—" : `${d >= 0 ? "+" : "-"}${ptToUnit(Math.abs(d), effPin)}${ECFG[e].unit}`}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {(() => {
              const dPlan = keio.result.grandTotal !== null && keioPlannedSchoolResult.grandTotal !== null
                ? keio.result.grandTotal - keioPlannedSchoolResult.grandTotal : null;
              return (
                <tr
                  onClick={() => setDiffPopup({ school: "慶應", event: "slalom" })}
                  style={{ background: C.accent + "0d", cursor: "pointer" }}
                >
                  <td style={{ padding: "8px 10px", fontSize: 11, color: C.muted }}>慶應 想定差 <span style={{ fontSize: 10, color: C.muted }}>▶</span></td>
                  <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: diffColor(dPlan) }}>{signStr(dPlan, "pt")}</td>
                  {EVENTS.map(e => {
                    const effPin = e === "jump" ? Math.max(0, parseFloat(cfg.pin[e]) - parseFloat(cfg.handicap)) : parseFloat(cfg.pin[e]);
                    return (
                      <td key={e} style={{ padding: "6px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 11, color: dPlan === null ? C.muted : ECFG[e].color, whiteSpace: "nowrap" }}>
                        {dPlan === null ? "—" : `${dPlan >= 0 ? "+" : "-"}${ptToUnit(Math.abs(dPlan), effPin)}${ECFG[e].unit}`}
                      </td>
                    );
                  })}
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
      {EVENTS.map(e => {
        const ecfg = ECFG[e];
        const done = completedEvents.includes(e);
        const keioPlannedEv = keioPlannedSchoolResult.ev[e];
        const keioActualEv = keio.result.ev[e];
        const dPts = keioActualEv.totalPts !== null && keioPlannedEv.totalPts !== null
          ? keioActualEv.totalPts - keioPlannedEv.totalPts : null;
        const dScore = keioActualEv.totalScore !== null && keioPlannedEv.totalScore !== null
          ? parseFloat((keioActualEv.totalScore - keioPlannedEv.totalScore).toFixed(1)) : null;
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
                    <tr key={r.school} style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}
                      onClick={() => setDiffPopup({ school: r.school, event: e })}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: C.text }}>{r.school} <span style={{ fontSize: 10, color: C.muted }}>▶</span></td>
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
                <tr
                  onClick={() => setDiffPopup({ school: "慶應", event: e })}
                  style={{ background: ecfg.color + "0d", cursor: "pointer" }}
                >
                  <td style={{ padding: "8px 10px", fontSize: 11, color: C.muted }}>慶應 想定差 <span style={{ fontSize: 10, color: C.muted }}>▶</span></td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: diffColor(dScore) }}>{dScore !== null ? `${dScore >= 0 ? "+" : ""}${dScore}${ecfg.unit}` : "—"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: diffColor(dPts), marginTop: 2 }}>{signStr(dPts, "pt")}</div>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontSize: 9, color: C.muted, lineHeight: 1.7 }}>
                    {dPts === null ? "実績 vs 想定" : EVENTS.filter(ev2 => ev2 !== e).map(ev2 => {
                      const ecfg2 = ECFG[ev2];
                      const effPin2 = ev2 === "jump" ? Math.max(0, parseFloat(cfg.pin.jump) - parseFloat(cfg.handicap)) : parseFloat(cfg.pin[ev2]);
                      const amount = Math.round((dPts / 1000) * effPin2 * 100) / 100;
                      return (
                        <div key={ev2} style={{ color: ecfg2.color }}>
                          {ecfg2.label}換算 {amount >= 0 ? "+" : ""}{amount}{ecfg2.unit}
                        </div>
                      );
                    })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>

      {diffPopup && (
        <PlayerPopup
          gender={gender}
          school={diffPopup.school}
          event={diffPopup.event || "slalom"}
          mode={diffPopup.school === "慶應" ? "B" : (mode || "B")}
          config={config}
          data={data}
          onClose={() => setDiffPopup(null)}
        />
      )}
    </>
  );
}

function EventBreakdown({ gender, schoolResults, mode, config, data }) {
  const [popup, setPopup] = useState(null);
  const cfg = config[gender];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {EVENTS.map(e => {
        const ecfg = ECFG[e];
        const keioPlanned = calcEventResult(data[gender]?.[e]?.["慶應"] || [], e, cfg.pin[e], cfg.topN, "P", cfg.handicap);
        const keioActual = schoolResults.find(r => r.school === "慶應")?.result.ev[e];
        const dPts = keioActual?.totalPts !== null && keioActual?.totalPts !== undefined && keioPlanned.totalPts !== null
          ? keioActual.totalPts - keioPlanned.totalPts : null;
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
                        {ev.totalPts !== null ? `${ev.totalPts.toFixed(1)}pt` : "—"}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        <MiniProgress filled={ev.filledActual} total={ev.total} color={ecfg.color} />
                      </td>
                    </tr>
                  );
                })}
                <tr onClick={() => setPopup({ school: "慶應", event: e })} style={{ background: C.accent + "0d", cursor: "pointer" }}>
                  <td style={{ padding: "8px 10px", fontSize: 11, color: C.muted }}>
                    慶應 想定差 <span style={{ fontSize: 10, color: C.muted }}>▶</span>
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "center", fontSize: 10, color: C.muted, fontFamily: "monospace" }}>
                    {keioPlanned.totalScore !== null ? `想定${e === "jump" ? keioPlanned.totalScore.toFixed(1) : keioPlanned.totalScore}${ecfg.unit}` : "—"}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: diffColor(dPts) }}>
                    {signStr(dPts, "pt")}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      {popup && <PlayerPopup gender={gender} school={popup.school} event={popup.event} mode="B" config={config} data={data} onClose={() => setPopup(null)} />}
    </div>
  );
}

function PlannedBreakdown({ gender, config, data }) {
  const [popup, setPopup] = useState(null);
  const cfg = config[gender];
  const schoolResults = SCHOOLS.map(school => ({
    school,
    result: calcSchoolResult(school, cfg, "P", data[gender] || {}),
  }));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{
        background: C.accent + "11", border: `1px solid ${C.accent}44`, borderRadius: 10,
        padding: "10px 14px", fontSize: 11, color: C.accent, display: "flex", alignItems: "center", gap: 8,
      }}>
        📌 このタブは想定値のみで計算した参考表示です。行をタップで選手別の想定内訳が見られます。
      </div>
      {EVENTS.map(e => {
        const ecfg = ECFG[e];
        return (
          <div key={e} style={{ background: C.surface, border: `1px solid ${ecfg.color}33`, borderRadius: 12, overflow: "hidden" }}>
            <SectionHeader title={`${ecfg.icon} ${ecfg.label}　想定内訳`} color={ecfg.color} right="行をタップで選手詳細 ▶" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted }}>学校</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", color: ecfg.color }}>想定得点</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", color: C.accent }}>換算pt</th>
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
                        {ev.totalPts !== null ? `${ev.totalPts.toFixed(1)}pt` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {popup && <PlayerPopup gender={gender} school={popup.school} event={popup.event} mode="P" config={config} data={data} onClose={() => setPopup(null)} />}
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
                       <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: school === "慶應" ? C.keio : C.text }}>{result.grandTotal !== null ? result.grandTotal.toFixed(1) : "—"}</div>
            <div style={{ fontSize: 9, color: C.muted }}>pt</div>
          </div>
        ))}
      </div>

           <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[{ key: "diff", label: "📉 差分分析" }, { key: "breakdown", label: "📋 種目別内訳" }, { key: "planned", label: "📌 想定" }].map(v => (
          <button key={v.key} onClick={() => setView(v.key)} style={{ flex: 1, background: view === v.key ? C.surface : C.surface2, border: `1px solid ${view === v.key ? C.accent : C.border}`, borderRadius: 8, color: view === v.key ? C.accent : C.muted, fontSize: 13, fontWeight: view === v.key ? 700 : 400, padding: "8px", cursor: "pointer" }}>{v.label}</button>
        ))}
      </div>

      {view === "diff" && <DiffTables gender={gender} schoolResults={schoolResults} config={config} completedEvents={completedEvents} data={data} mode={mode} />}
      {view === "breakdown" && <EventBreakdown gender={gender} schoolResults={schoolResults} mode={mode} config={config} data={data} />}
      {view === "planned" && <PlannedBreakdown gender={gender} config={config} data={data} />}
    </div>
  );
}

function StartlistTab() {
  const [url, setUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [viewerPhoto, setViewerPhoto] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadStartlistUrl().then(u => { setUrl(u); setInputUrl(u); });
    loadStartlistPhotos().then(setPhotos);
  }, []);

  async function handleSaveUrl() {
    await saveStartlistUrl(inputUrl.trim());
    setUrl(inputUrl.trim());
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const updated = await uploadStartlistPhoto(file, newTitle);
    if (updated) setPhotos(updated);
    setUploading(false);
    setNewTitle("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(path) {
    if (!window.confirm("この写真を削除しますか？")) return;
    const updated = await deleteStartlistPhoto(path);
    if (updated) setPhotos(updated);
  }

  async function handleTitleSave(i) {
    const updated = photos.map((p, idx) => idx === i ? { ...p, title: editTitleValue } : p);
    setPhotos(updated);
    await saveStartlistPhotos(updated);
    setEditingIndex(null);
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setSettingsOpen(v => !v)} style={{ width: "100%", background: settingsOpen?"#0d1e3a":C.surface, border: `1px solid ${settingsOpen?C.slalom:C.border}`, borderRadius: settingsOpen?"10px 10px 0 0":10, color: settingsOpen?C.slalom:C.muted, fontSize: 12, fontWeight: 700, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚙️ 連盟サイトのURL設定</span>
          <span style={{ marginLeft: "auto", fontSize: 10 }}>{settingsOpen?"▲":"▼"}</span>
        </button>
        {settingsOpen && (
          <div style={{ background: C.surface, border: `1px solid #2a3a5a`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: 14 }}>
            <div style={{ fontSize: 11, color: "#4a6a9a", marginBottom: 6 }}>出走リストが掲載されているページのURL</div>
            <input type="text" value={inputUrl} onChange={e => setInputUrl(e.target.value)} placeholder="https://..." style={{ width: "100%", background: "#0a1020", border: "1px solid #1e2a4a", borderRadius: 6, color: C.text, fontSize: 12, padding: "8px 10px", outline: "none", fontFamily: "monospace", boxSizing: "border-box", marginBottom: 10 }} />
            <button onClick={handleSaveUrl} style={{ width: "100%", background: "#1a3a6a", border: `1px solid ${C.slalom}`, borderRadius: 8, color: C.slalom, fontSize: 13, fontWeight: 700, padding: "10px", cursor: "pointer" }}>
              保存する
            </button>
          </div>
        )}
      </div>

      {url && (
        <div style={{ background: C.surface, border: "1px solid #1e3a6e", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ background: "#0d2045", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slalom }}>🔗 連盟サイトの出走リスト</div>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#4a6a9a", textDecoration: "none", border: "1px solid #1e3060", borderRadius: 4, padding: "2px 7px" }}>開く ↗</a>
          </div>
          <iframe src={url} style={{ width: "100%", height: 400, border: "none", background: "#fff" }} title="出走リスト" sandbox="allow-scripts allow-same-origin" />
        </div>
      )}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ background: "#0d1e3a", padding: "9px 14px", fontSize: 11, fontWeight: 700, color: C.jump }}>📷 配布された出走リスト（写真）</div>
        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="タイトル（例：男子スラローム Round1）"
              style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12, padding: "8px 10px", outline: "none" }}
            />
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: "none" }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{ width: "100%", background: C.jump + "22", border: `1px solid ${C.jump}66`, borderRadius: 8, color: C.jump, fontSize: 13, fontWeight: 700, padding: "12px", cursor: "pointer", marginBottom: 16 }}
          >
            {uploading ? "アップロード中..." : "📸 写真を選んでアップロード"}
          </button>

          {photos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: C.muted, fontSize: 12 }}>
              まだ写真がアップロードされていません
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img
                    src={p.url} onClick={() => setViewerPhoto(p)}
                    style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}`, cursor: "pointer" }}
                  />
                  <button
                    onClick={() => handleDelete(p.path)}
                    style={{ position: "absolute", top: 4, right: 4, background: C.negative + "cc", border: "none", borderRadius: "50%", width: 22, height: 22, color: "#fff", fontSize: 12, cursor: "pointer", lineHeight: 1 }}
                  >✕</button>
                  {editingIndex === i ? (
                    <input
                      autoFocus
                      value={editTitleValue}
                      onChange={e => setEditTitleValue(e.target.value)}
                      onBlur={() => handleTitleSave(i)}
                      onKeyDown={e => { if (e.key === "Enter") handleTitleSave(i); }}
                      style={{ width: "100%", fontSize: 9, marginTop: 4, textAlign: "center", background: C.bg, border: `1px solid ${C.jump}66`, borderRadius: 4, color: C.text, padding: "2px 4px", boxSizing: "border-box", outline: "none" }}
                    />
                  ) : (
                    <div
                      onClick={() => { setEditingIndex(i); setEditTitleValue(p.title || ""); }}
                      style={{ fontSize: 9, color: p.title ? C.muted : C.muted + "88", marginTop: 4, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                    >
                      {p.title || "＋タイトル追加"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewerPhoto && (
        <div
          onClick={() => setViewerPhoto(null)}
          style={{ position: "fixed", inset: 0, zIndex: 600, background: C.overlay, backdropFilter: "blur(6px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          {viewerPhoto.title && (
            <div style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{viewerPhoto.title}</div>
          )}
          <img src={viewerPhoto.url} style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 10 }} />
          <button onClick={() => setViewerPhoto(null)} style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: "8px 20px", cursor: "pointer" }}>閉じる</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "activated") {
            window.location.reload();
          }
        });
      });
      reg.update();
    });
    const checkInterval = setInterval(() => {
      navigator.serviceWorker.getRegistration().then(reg => reg && reg.update());
    }, 5 * 60 * 1000);
    return () => clearInterval(checkInterval);
  }, []);

  const [tab, setTab] = useState("result");
  const tabRef = useRef("result");
  useEffect(() => { tabRef.current = tab; }, [tab]);
  const [gender, setGender] = useState("men");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const saveTimers = useRef({});

  const [config, setConfig] = useState({ men: { ...DEFAULT_CONFIG.men }, women: { ...DEFAULT_CONFIG.women } });
  const [data, setData] = useState(buildInitialData());

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAllScores(buildInitialData()), loadConfig()]).then(([loadedData, loadedConfig]) => {
      setData(loadedData);
      if (loadedConfig) {
        setConfig({
          men:   { ...DEFAULT_CONFIG.men,   ...loadedConfig.men,   pin: { ...DEFAULT_CONFIG.men.pin,   ...(loadedConfig.men?.pin   || {}) } },
          women: { ...DEFAULT_CONFIG.women, ...loadedConfig.women, pin: { ...DEFAULT_CONFIG.women.pin, ...(loadedConfig.women?.pin || {}) } },
        });
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const loadedData = await loadAllScores(buildInitialData());
      setData(loadedData);
      if (!configSaving_ref.current && tabRef.current !== "settings") {
        const loadedConfig = await loadConfig();
        if (loadedConfig) {
          setConfig(prev => ({
            men:   { ...DEFAULT_CONFIG.men,   ...loadedConfig.men,   pin: { ...prev.men.pin,   ...loadedConfig.men?.pin   } },
            women: { ...DEFAULT_CONFIG.women, ...loadedConfig.women, pin: { ...prev.women.pin, ...loadedConfig.women?.pin } },
          }));
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const saveSkierDebounced = useCallback((gender, event, school, idx, field, value) => {
    const key = `${gender}-${event}-${school}-${idx}-${field}`;
    clearTimeout(saveTimers.current[key]);
    setSyncing(true);
    saveTimers.current[key] = setTimeout(async () => {
      await saveSkier(gender, event, school, idx, field, value);
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

  const [resettingActuals, setResettingActuals] = useState(false);
  const [actualsReset, setActualsReset] = useState(false);

  const handleResetActuals = async () => {
    if (window.confirm("全種目・全校の「実際」の記録だけを消去します。「想定」は残ります。よろしいですか？")) {
      setResettingActuals(true);
      await resetAllActuals();
      const loadedData = await loadAllScores(buildInitialData());
      setData(loadedData);
      setResettingActuals(false);
      setActualsReset(true);
      setTimeout(() => setActualsReset(false), 3000);
    }
  };

  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved,  setConfigSaved]  = useState(false);
  const configSaving_ref = useRef(false);

  const handleSaveConfig = async () => {
    configSaving_ref.current = true;
    setConfigSaving(true);
    await saveConfig(config);
    setConfigSaving(false);
    setConfigSaved(true);
    setTimeout(() => { setConfigSaved(false); configSaving_ref.current = false; }, 15000);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Segoe UI','Helvetica Neue',sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: C.bg + "ee", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "10px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            
                         <img
              src="/kwst-logo.png"
              alt="KWST"
                           style={{ height: 44, objectFit: "contain", flexShrink: 0 }}
              onError={e => { e.target.style.display = "none"; }}
            />
            <div>
              <div style={{ fontSize: 10, color: C.muted, lineHeight: 1, marginBottom: 2 }}>慶應義塾大学水上スキー部</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.accent, fontFamily: "'Georgia',serif", letterSpacing: "-0.01em", lineHeight: 1.2 }}>KWST Dashboard</div>
            </div>
            {loading && <span style={{ fontSize: 10, color: C.muted, marginLeft: "auto" }}>読込中...</span>}
            {syncing && !loading && <span style={{ fontSize: 10, color: C.positive, marginLeft: "auto" }}>💾保存中</span>}
            {!loading && !syncing && <span style={{ marginLeft: "auto" }} />}
          </div>
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
            <AppTab label="📋 出走" active={tab === "startlist"} onClick={() => setTab("startlist")} />
            <AppTab label="📡 速報" active={tab === "sokuho"}   onClick={() => setTab("sokuho")} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🌊</div>
            <div style={{ fontSize: 14 }}>データを読み込んでいます...</div>
          </div>
        )}
                {!loading && tab === "settings" && <SettingsTab config={config} setConfig={setConfig} onReset={handleReset} onSave={handleSaveConfig} saving={configSaving} saved={configSaved} gender={gender} onResetActuals={handleResetActuals} resettingActuals={resettingActuals} actualsReset={actualsReset} />}
        {!loading && tab === "input"    && <InputTab config={config} data={data} setData={setData} gender={gender} saveSkierDebounced={saveSkierDebounced} />}
        {!loading && tab === "result"   && <ResultTab config={config} data={data} gender={gender} />}
        {tab === "startlist"            && <StartlistTab />}
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

function SokuhoTab() {
  const [compUrl, setCompUrl] = useState("");
  const [compName, setCompName] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [inputName, setInputName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadCompConfig().then(cfg => {
      if (cfg) { setCompUrl(cfg.url||""); setCompName(cfg.name||""); setInputUrl(cfg.url||""); setInputName(cfg.name||""); }
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    const cfg = { url: inputUrl.trim(), name: inputName.trim() };
    await saveCompConfig(cfg);
    setCompUrl(cfg.url); setCompName(cfg.name);
    setSaving(false); setSaved(true);
    setTimeout(() => { setSaved(false); setSettingsOpen(false); }, 1200);
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setSettingsOpen(v => !v)} style={{ width: "100%", background: settingsOpen?"#0d1e3a":C.surface, border: `1px solid ${settingsOpen?C.slalom:C.border}`, borderRadius: settingsOpen?"10px 10px 0 0":10, color: settingsOpen?C.slalom:C.muted, fontSize: 12, fontWeight: 700, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚙️ 大会URL設定</span>
          {compUrl && !settingsOpen && <span style={{ fontSize: 10, background: "#1a3060", color: C.slalom, padding: "2px 8px", borderRadius: 10, marginLeft: "auto" }}>設定済み</span>}
          <span style={{ marginLeft: "auto", fontSize: 10 }}>{settingsOpen?"▲":"▼"}</span>
        </button>
        {settingsOpen && (
          <div style={{ background: C.surface, border: `1px solid #2a3a5a`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: 14 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#4a6a9a", marginBottom: 6 }}>ライブスコア／大会ページのURL</div>
              <input type="text" value={inputUrl} onChange={e => setInputUrl(e.target.value)} placeholder="https://ems.iwwf.sport/Competitions/Details?Id=..." style={{ width: "100%", background: "#0a1020", border: "1px solid #1e2a4a", borderRadius: 6, color: C.text, fontSize: 12, padding: "8px 10px", outline: "none", fontFamily: "monospace", boxSizing: "border-box" }} />
              <div style={{ marginTop: 6, fontSize: 10, color: "#4a6a9a" }}>IWWF・EMSどちらのページのURLでも貼り付けられます</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#4a6a9a", marginBottom: 6 }}>大会名（表示用）</div>
              <input type="text" value={inputName} onChange={e => setInputName(e.target.value)} placeholder="例：インカレ2026" style={{ width: "100%", background: "#0a1020", border: "1px solid #1e2a4a", borderRadius: 6, color: C.text, fontSize: 13, padding: "8px 10px", outline: "none", boxSizing: "border-box" }} />
            </div>
            <button onClick={handleSave} disabled={saving} style={{ width: "100%", background: saved?C.positive+"22":"#1a3a6a", border: `1px solid ${saved?C.positive:C.slalom}`, borderRadius: 8, color: saved?C.positive:C.slalom, fontSize: 13, fontWeight: 700, padding: "11px", cursor: "pointer" }}>
              {saved?"✓ 保存しました":saving?"保存中...":"保存する"}
            </button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#0a1020", borderRadius: 8, marginBottom: 12, fontSize: 11, color: compUrl?"#5abf8a":"#4a5580" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: compUrl?"#4aaa7a":"#5a5a6a", display: "inline-block", flexShrink: 0 }} />
        <span>{compUrl?`${compName||"大会"}`:"URL未設定 — ⚙️から設定してください"}</span>
      </div>
      <div style={{ background: C.surface, border: "1px solid #1e3a6e", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ background: "#0d2045", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: C.slalom }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: compUrl?"#ff4444":"#5a5a6a", display: "inline-block" }} />
            ライブスコア／大会結果
          </div>
          {compUrl && <a href={compUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#4a6a9a", textDecoration: "none", border: "1px solid #1e3060", borderRadius: 4, padding: "2px 7px" }}>別窓 ↗</a>}
        </div>
        {compUrl ? (
          <iframe src={compUrl} style={{ width: "100%", height: 500, border: "none", background: "#fff" }} title="大会ページ" sandbox="allow-scripts allow-same-origin" />
        ) : (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🏁</div>
            <div style={{ fontSize: 12, color: "#3a4a6a", lineHeight: 1.6 }}>大会のURLを設定すると<br />ここに表示されます</div>
          </div>
        )}
      </div>
      <a href="https://twitter.com/JCWFgakuren" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block", marginBottom: 12 }}>
        <div style={{ background: C.surface, border: "1px solid #1e2a4a", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ background: "#0a1a30", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slalom, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>𝕏</span>@JCWFgakuren 速報
            </div>
            <span style={{ fontSize: 10, color: "#4a6a9a", border: "1px solid #1e2a4a", borderRadius: 4, padding: "2px 7px" }}>開く ↗</span>
          </div>
          <div style={{ background: "#000", padding: "20px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: "#fff" }}>𝕏</span>
            <div>
              <div style={{ fontSize: 13, color: "#7eb8f7", fontWeight: 700, marginBottom: 4 }}>@JCWFgakuren のポストを見る</div>
              <div style={{ fontSize: 11, color: "#4a6a9a" }}>全日本学生水上スキー連盟 — 大会速報はこちら</div>
            </div>
          </div>
        </div>
      </a>
      <style>{`@keyframes liveblink{0%,100%{opacity:1}50%{opacity:0.15}}`}</style>
    </div>
  );
}
