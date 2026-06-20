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
  // 学年・スペース・記号を除去して名前のみ抽出
  const kanji = kanjiInput
    .replace(/[（(][^）)]*[）)]/g, "")  // （4年）（3）などを除去
    .replace(/[　\s]/g, "")              // 全角・半角スペース除去
    .trim();
  if (!kanji) return null;
  try {
    const rows = await sbFetch("players?select=*");
    if (!rows || rows.length === 0) return null;
    // 完全一致優先、次に部分一致
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

// ─── スコア表示フォーマット ──────────────────────────────────────
function formatScore(event, scoreRaw) {
  if (!scoreRaw || scoreRaw === "null") return null;
  if (event === "slalom") {
    const p = scoreRaw.split("/");
    if (p.length === 3) {
      // ロープ長が18.25mより短い場合はショートロープ → ロープ長を表示
      const rope = parseFloat(p[2]);
      if (rope < 18.25) return `${p[0]}ブイ @${p[2]}m`;
      // 通常は速度を表示
      return `${p[0]}ブイ @${p[1]}km`;
    }
    if (p.length === 2) return `${p[0]}ブイ @${p[1]}km`;
    return scoreRaw;
  }
  if (event === "trick") return `${Number(scoreRaw).toLocaleString()}点`;
  if (event === "jump")  return `${scoreRaw}m`;
  return scoreRaw;
}

// ─── 既存コードと同一定数 ────────────────────────────────────────
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
// PLAYER HISTORY POPUP（新規追加）
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

  // results を competition_id → event → score_raw に整理
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
        {/* ハンドル */}
        <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 16px" }} />

        {/* ヘッダー */}
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

        {/* 担当種目バッジ */}
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

        {/* ローディング */}
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🌊</div>
            <div style={{ fontSize: 13 }}>読み込み中...</div>
          </div>
        )}

        {/* エラー */}
        {!loading && error && (
          <div style={{ background: C.negative + "22", border: `1px solid ${C.negative}44`, borderRadius: 10, padding: 14, color: C.negative, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* 記録なし */}
        {!loading && !error && compIds.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 13 }}>
            過去の大会記録がありません
          </div>
        )}

        {/* 大会別カード */}
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

        {/* リザルト英語表記 */}
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

// ─────────────────────────────────────────────────────────────────
// PLAYER POPUP（既存 + 選手名クリックで実績表示を追加）
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
                  {/* 選手名クリックで実績ポップアップ */}
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

      {/* 選手名タップで実績ポップアップ */}
      {historyTarget && (
        <PlayerHistoryPopup kanjiInput={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// SETTINGS TAB（既存のまま）
// ─────────────────────────────────────────────────────────────────
function SettingsTab({ config, setConfig, onReset, onImport, onSave, saving, saved, gender }) {
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
      {/* 設定保存ボタン */}
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

      {/* リザルト読み込み */}
      <div style={{ background: C.surface, border: `1px solid ${C.slalom}33`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.slalom, marginBottom: 8 }}>📥 リザルト読み込み</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
          大会リザルト（PDF・Excel・写真）をAIで自動読み取りしてデータベースに登録します。
        </div>
        <button onClick={onImport} style={{ background: C.slalom + "22", border: `1px solid ${C.slalom}66`, borderRadius: 8, color: C.slalom, fontSize: 13, fontWeight: 700, padding: "11px 20px", cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          📥 リザルトを読み込む
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

// ─────────────────────────────────────────────────────────────────
// INPUT TAB（実績ボタン追加）
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
      {/* 種目選択 */}
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

      {/* 学校選択 */}
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

      {/* 進捗バー */}
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

      {/* 選手カード */}
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
              {/* 実績ボタン：名前があるときのみ表示 */}
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

      {/* 実績ポップアップ */}
      {historyTarget && (
        <PlayerHistoryPopup kanjiInput={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// RESULT TAB（既存のまま）
// ─────────────────────────────────────────────────────────────────
function DiffTables({ gender, schoolResults, config, completedEvents, data, mode }) {
  const cfg  = config[gender];
  const keio  = schoolResults.find(r => r.school === "慶應");
  const others = schoolResults.filter(r => r.school !== "慶應");
  const [diffPopup, setDiffPopup] = useState(null);
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
          mode={mode || "B"}
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

      {view === "diff" && <DiffTables gender={gender} schoolResults={schoolResults} config={config} completedEvents={completedEvents} data={data} mode={mode} />}
      {view === "breakdown" && <EventBreakdown gender={gender} schoolResults={schoolResults} mode={mode} config={config} data={data} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────────
export default function App() {
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
      // 保存中・保存直後・設定タブを開いている間はconfigを上書きしない
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

  const [showImport, setShowImport] = useState(false);
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
              src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAEYAYMDASIAAhEBAxEB/8QAHQABAAIDAQEBAQAAAAAAAAAAAAcIBQYJBAMBAv/EAFgQAAEDAwIDBAMHDQ0GBAcAAAEAAgMEBQYHERIhMQgTQVEiYXEUGEJSgZTTFRcjMlRVYnKCkZKhsxYkMzY3OFd0dYSVtNIJQ1N2orE0VrLBRWODk8LD0f/EABYBAQEBAAAAAAAAAAAAAAAAAAABAv/EABkRAQEBAQEBAAAAAAAAAAAAAAABESExQf/aAAwDAQACEQMRAD8AuWiIgIiICIiAiIgIiICIiAiL+JpoYeDvpWR8bwxvEdt3HoPaUH9oiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgLzXSgpbnbp7fWxCWnqGFkjdyNwfIjmCOoI5g8wvSiCFbXqTW6dZw3T/UysL6Ko9KxZFKOFtRFvsI6g9BI3cNL+QPIkDfczS1zXNDmkOaRuCDyIWk616d2zUvCKmxVvBFVs3loKot3NPMByP4p6EeIPnsqvaNa15HpHkEun2ocNTUWmhm9zHfd81v25As+PFtsQ3y2LfIlXYReOyXW23u1U91tFbBW0NSzjhnhfxMePUV7EQREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBV87YGkH7sLC7Msfpi6/WyE+6IY27urKccyNhzL2cyPEjcc/R2sGiDnHobrDkel92/erjXWSd/FV22R2zXdAXsPwH7Dr0PQg8tr7ab51jeoGOx3zG65tRCdmzQu9GWnf4skb8E/qPUEjmqjdsTSE4pfnZtYKYix3Ob99xRt9GjqD7OjHncjwDtxy3aFDmnWcZHgGQx3vGq40842bLG4cUU7N9+CRviPzEeBBRrNdQkUCY92qdOanFILjenV1vuv2s1uip3TO4gBuWP2DS078tyD6ljx2vdPu82OP5R3e/23cwb7ezvf/dExYtFEWN9pDSW9TMhOQSWyV/RtwpnxAe14BYPlcpTtVxt92oY6+111LXUko3jnp5WyRvHmHNJBRHqRF86uogpKaWqqpo4IIml8kkjg1rGjqSTyAQKqeClppampmjhgiYXySSODWsaBuSSeQAHivyiqYayjhq6dxdDPG2SMlpBLXDcHY8xyPiqpai6nVOtWpNr0rwqWVuMVFU0XSsYHNdVwsPFIRy3bGGtO2+3E7bfYbK14EVPAB6McUbfYGtA/UNkH9ooVxjU12pWtzLBicz34tjsUlVcK1n2tdPsY42NP/DDnFw+MWb9AN5qQEXwjrKaSumoY5Q6ogYySVg+AH8XDv7eF3L1exfdAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBjcotlpvOOXC132GKa11NO9lU2U7N7vbmd/Dbrv4bbrlzkMVrgv1fDZKqertjKiRtHPNHwPkiDjwOc3wJG3/APB0V/e15fZ7FoTezTP4JbgY6AH8GR3p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8+DWjmfzDmQF0wwfHKDEcRtmNWxu1Lb6dsLDtsXkc3PPrc4lx9ZKFZlERGXLbUP+P+Rf2rU/tXLBLO6h/wAf8i/tWp/auWCRtNfYo/l6oP6lU/s1ftUE7FH8vVB/Uqn9mr9ozREREEREBERAREQEREBERAREQUU7U+C5vedecjuVow7IrjQze5e6qaW2TSxP2pYWnZzWkHYgg7eIKjH62OpP9HuW/wCDVH+hdOURdc7dJNO9QKLVXEa2twXJ6alp75RSzTTWmdjI2NnYXOc4t2AABJJ6LokiIW6KP+0DgceoemNyskcbTcYm+6rc4/BnYDwjfwDgSw+pykBERzG+tjqT/R7lv+DVH+hPrY6k/wBHuW/4NUf6F05RF1zG+tjqT/R7lv8Ag1R/oU2aE5xrXp7HDZbvpzmN8x1uzWQOtNQJqUb/AO6cWc2/gHl02Lee9zUQ1isWvtPkNrbX09DdqEHk6C5UEtJKw+RbI0b+0bj1qk/ag0xzGXWu+XCwYlfLnb68x1TJqK3SzR8TmN4wXMaRvxhx29YV7UQlcxvrY6k/0e5b/g1R/oX1otKtSqqshpm4Fk8RmkbGHy2mdjG7nbdzizYAeJPRdNEQ14MdtdNY7Bb7NRtDaegpY6aIAbeixoaP1Be9EREadp3E6jMdGL3baGmkqa+na2spI44zI98kbty1rRzLnN42gDxcqI/Wx1J/o9y3/Bqj/QunKIsuOY31sdSf6Pct/wAGqP8AQrHdhvAcgsOQZHfskx652iVtLFSUvu+kfA6QPcXycIeBuB3ce59atWiGiIiI1bVDAse1ExeSw5DTudGTxwTxkCWnk22D2HwPqPIjkVTfUHsvaiY/USSWCKDJaDf0X0zhHMB+FG49fxS5XxRF1y3ueGZha3llyxW+UZB2Pf0ErPPzb6isCusyIuuV1oxvIrwGm0WC63AP34TS0ckvFz25cIPkfzKVtP8Asz6lZLUsddaFmN0B2Lp64gybfgxNPFv6ncPXqr9oia0PR3SrF9MLO+lskLp62oA9118+xlnI8PJrR4NHy7nmt8REQREQc386041Dqc3v1RT4FlM0MtyqHxyR2idzXtMriCCGbEEeKw31sdSf6Pct/wAGqP8AQunKIuqSdkPCczsetdFcL1iN/tlG2kqGuqKy2zQxglmwBc5oG5V20REoiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIg//9k="
              alt="KWST"
              style={{ height: 44, objectFit: "contain", flexShrink: 0,
                filter: "invert(1) sepia(1) saturate(4) hue-rotate(10deg)" }}
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
        {!loading && tab === "settings" && <SettingsTab config={config} setConfig={setConfig} onReset={handleReset} onImport={() => setShowImport(true)} onSave={handleSaveConfig} saving={configSaving} saved={configSaved} gender={gender} />}
        {!loading && tab === "input"    && <InputTab config={config} data={data} setData={setData} gender={gender} saveSkierDebounced={saveSkierDebounced} />}
        {!loading && tab === "result"   && <ResultTab config={config} data={data} gender={gender} />}
        {tab === "sokuho"               && <SokuhoTab />}
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px 40px" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, color: C.muted, lineHeight: 1.8 }}>
          ☁️ データはSupabaseに自動保存・リアルタイム同期されます（10秒ごと更新）。設定タブからリセット可能です。
        </div>
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// IMPORT MODAL（リザルト読み込み）
// ─────────────────────────────────────────────────────────────────
function ImportModal({ onClose }) {
  const [step, setStep] = useState("upload");
  const [matchedData, setMatchedData] = useState([]);
  const [compName, setCompName] = useState("");
  const [heldDate, setHeldDate] = useState("");
  const [compId, setCompId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  async function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file) {
    if (!file) return;
    setStep("loading");
    setError(null);
    try {
      const isImage = file.type.startsWith("image/");
      const isPdf   = file.type === "application/pdf";
      const base64  = await readFileAsBase64(file);
      const prompt = `このファイルは水上スキー大会のリザルト（結果表）です。5校（慶應、法政、立教、福大、学習院）の選手データのみを抽出してください。以下のJSON形式のみで返してください：{"competition_name":"大会名","held_date":"YYYY-MM-DD","results":[{"en_name":"英語名","slalom":"スコアまたはnull","trick":数値またはnull,"jump":数値またはnull}]}`;

      let messages;
      if (isImage) {
        messages = [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: file.type, data: base64 } }, { type: "text", text: prompt }] }];
      } else if (isPdf) {
        messages = [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }, { type: "text", text: prompt }] }];
      } else {
        messages = [{ role: "user", content: prompt }];
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages }),
      });
      const apiData = await res.json();
      const text = apiData.content?.map(c => c.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      setCompName(parsed.competition_name || "");
      setHeldDate(parsed.held_date || "");
      const autoId = (parsed.competition_name || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "comp_" + Date.now();
      setCompId(autoId);

      // 選手マッチング
      const players = await sbFetch("players?select=*");
      const matched = (parsed.results || []).map(r => {
        const player = players?.find(p => {
          const ens = Array.isArray(p.en_names) ? p.en_names : (typeof p.en_names === 'string' ? JSON.parse(p.en_names || "[]") : []);
          return ens.some(en => en.toLowerCase() === (r.en_name || "").toLowerCase());
        });
        return { ...r, player: player || null, matched: !!player };
      });
      setMatchedData(matched);
      setStep("confirm");
    } catch(e) {
      console.error(e);
      setError("読み取りに失敗しました。ファイルを確認してください。");
      setStep("upload");
    }
  }

  async function handleRegister() {
    setRegistering(true);
    try {
      await sbFetch("competitions?on_conflict=id", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ id: compId, name: compName, short: compId, held_date: heldDate }),
      });
      for (const r of matchedData.filter(r => r.matched)) {
        for (const event of ["slalom", "trick", "jump"]) {
          if (r[event] === null || r[event] === undefined) continue;
          await sbFetch("player_results?on_conflict=player_id,competition_id,event", {
            method: "POST",
            headers: { "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify({ player_id: r.player.id, competition_id: compId, event, score_raw: String(r[event]) }),
          });
        }
      }
      setStep("done");
    } catch(e) { setError("登録に失敗しました: " + e.message); }
    setRegistering(false);
  }

  const matchedCount = matchedData.filter(r => r.matched).length;
  const unmatchedCount = matchedData.filter(r => !r.matched).length;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 600, background: C.overlay, backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.slalom}33`, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 600, padding: "20px 16px 44px", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 16px" }} />
        <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv,image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files?.[0])} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handleFile(e.target.files?.[0])} />

        {step === "upload" && (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.slalom, marginBottom: 4 }}>📥 リザルトを読み込む</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>大会リザルトをAIで自動読み取りします</div>
            {error && <div style={{ background: C.negative + "22", border: `1px solid ${C.negative}44`, borderRadius: 10, padding: 12, color: C.negative, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <div onClick={() => fileInputRef.current?.click()} style={{ border: `2px dashed ${C.border}`, borderRadius: 10, padding: "28px 16px", textAlign: "center", cursor: "pointer", background: C.bg, marginBottom: 12 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 500, marginBottom: 6 }}>タップしてファイルを選択</div>
              <div style={{ fontSize: 12, color: C.muted }}>PDF・Excel・写真に対応</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <button onClick={() => cameraInputRef.current?.click()} style={{ background: C.men + "22", border: `1px solid ${C.men}44`, borderRadius: 10, color: C.men, fontSize: 13, fontWeight: 700, padding: 12, cursor: "pointer" }}>📷 カメラで撮影</button>
              <button onClick={() => fileInputRef.current?.click()} style={{ background: C.jump + "22", border: `1px solid ${C.jump}44`, borderRadius: 10, color: C.jump, fontSize: 13, fontWeight: 700, padding: 12, cursor: "pointer" }}>📁 ファイル選択</button>
            </div>
            <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              {[{ n:1, t:"ファイルをアップロード", s:"PDF・Excel・写真・カメラ撮影OK" }, { n:2, t:"AIが自動で読み取る", s:"選手名・スコアを自動認識" }, { n:3, t:"内容を確認して登録", s:"間違いがあれば修正できます" }].map(({ n, t, s }) => (
                <div key={n} style={{ display: "flex", gap: 10, marginBottom: n < 3 ? 10 : 0, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.accent + "22", border: `1px solid ${C.accent}44`, color: C.accent, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</div>
                  <div><div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{t}</div><div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s}</div></div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === "loading" && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 16, display: "inline-block", animation: "spin 1.5s linear infinite" }}>🌊</div>
            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
            <div style={{ fontSize: 14, color: C.text, marginBottom: 8 }}>AIがリザルトを解析中...</div>
            <div style={{ fontSize: 12, color: C.muted }}>選手名・スコアを認識しています</div>
          </div>
        )}

        {step === "confirm" && (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.accent, marginBottom: 14 }}>✅ 読み取り結果を確認</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>大会名</div>
              <input value={compName} onChange={e => setCompName(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, padding: "8px 10px", width: "100%", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>開催日</div>
              <input value={heldDate} onChange={e => setHeldDate(e.target.value)} placeholder="YYYY-MM-DD" style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, padding: "8px 10px", width: "100%", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
              マッチ <span style={{ color: C.positive, fontWeight: 700 }}>{matchedCount}件</span>
              {unmatchedCount > 0 && <span>　スキップ {unmatchedCount}件</span>}
            </div>
            {matchedData.filter(r => r.matched).map((r, i) => (
              <div key={i} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <div><div style={{ fontSize: 10, color: C.muted }}>{r.en_name} →</div><div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.player?.kanji}（{r.player?.school}）</div></div>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: C.positive, background: C.positive + "22", border: `1px solid ${C.positive}44`, borderRadius: 10, padding: "2px 8px" }}>✅ 自動</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {["slalom","trick","jump"].map(ev => {
                    const score = r[ev]; const hasScore = score !== null && score !== undefined;
                    const color = ev==="slalom"?C.slalom:ev==="trick"?C.trick:C.jump;
                    const label = ev==="slalom"?"スラローム":ev==="trick"?"トリック":"ジャンプ";
                    const display = hasScore?(ev==="slalom"?String(score):ev==="trick"?`${Number(score).toLocaleString()}点`:`${score}m`):"—";
                    return (
                      <div key={ev} style={{ background: hasScore?color+"11":C.bg, border: `1px solid ${hasScore?color+"44":C.border}`, borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: hasScore?color:C.muted, marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 11, fontFamily: "monospace", color: hasScore?C.text:C.muted, fontWeight: hasScore?700:400 }}>{display}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {unmatchedCount > 0 && (
              <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, marginBottom: 6 }}>⚠️ スキップ（{unmatchedCount}名）</div>
                {matchedData.filter(r => !r.matched).map((r, i) => <div key={i} style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>• {r.en_name}</div>)}
              </div>
            )}
            <button onClick={handleRegister} disabled={registering} style={{ width: "100%", background: C.accent + "22", border: `1px solid ${C.accent}66`, borderRadius: 10, color: C.accent, fontSize: 14, fontWeight: 700, padding: 13, cursor: "pointer", marginBottom: 8 }}>
              {registering ? "登録中..." : "✅ データベースに登録する"}
            </button>
            <button onClick={() => setStep("upload")} style={{ width: "100%", background: "none", border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted, fontSize: 13, padding: 10, cursor: "pointer" }}>← やり直す</button>
          </>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "60px 16px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.positive, marginBottom: 8 }}>登録完了！</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 32 }}>{matchedCount}件のリザルトを保存しました</div>
            <button onClick={onClose} style={{ background: C.accent + "22", border: `1px solid ${C.accent}66`, borderRadius: 10, color: C.accent, fontSize: 14, fontWeight: 700, padding: "12px 32px", cursor: "pointer" }}>閉じる</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 速報タブ関連
// ─────────────────────────────────────────────────────────────────
function ResultButtons({ compCode }) {
  const [open, setOpen] = useState(null);
  const events = [
    { key:"ms", gender:"men",   event:"slalom", label:"スラローム", gLabel:"男子" },
    { key:"ws", gender:"women", event:"slalom", label:"スラローム", gLabel:"女子" },
    { key:"mt", gender:"men",   event:"trick",  label:"トリック",   gLabel:"男子" },
    { key:"wt", gender:"women", event:"trick",  label:"トリック",   gLabel:"女子" },
    { key:"mj", gender:"men",   event:"jump",   label:"ジャンプ",   gLabel:"男子" },
    { key:"wj", gender:"women", event:"jump",   label:"ジャンプ",   gLabel:"女子" },
  ];
  function getPdfUrl(code, genderKey, eventKey, round) {
    const year = code.slice(0, 2);
    const base = `https://www.iwwfed-ea.org/classic/${year}/${code}/`;
    const gStr = genderKey === "men" ? "men" : "women";
    if (round === "round1") return `${base}${gStr}_${eventKey}_round_1_results.pdf`;
    return `${base}${gStr}_${eventKey}_overall_results.pdf`;
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ background: "#0d1e3a", padding: "9px 14px", fontSize: 11, fontWeight: 700, color: C.slalom }}>📄 結果ページ（PDF）</div>
      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {events.map(ev => {
          const isOpen = open === ev.key;
          const ecfg = ECFG[ev.event];
          return (
            <React.Fragment key={ev.key}>
              <div onClick={() => setOpen(prev => prev === ev.key ? null : ev.key)} style={{ background: isOpen?"#1a2f55":"#141d35", border: `1px solid ${isOpen?C.slalom:"#1e2a4a"}`, borderRadius: 7, padding: "10px 8px", textAlign: "center", cursor: "pointer" }}>
                <span style={{ display: "block", fontSize: 9, color: isOpen?C.slalom:"#4a6a9a", marginBottom: 2 }}>{ev.gLabel}</span>
                <span style={{ display: "block", fontSize: 12, color: isOpen?C.slalom:ecfg.color, fontWeight: 600 }}>{ev.label}</span>
                <span style={{ fontSize: 9, color: isOpen?C.slalom:"#4a6a9a", marginTop: 3, display: "block" }}>{isOpen?"▲":"▼"}</span>
              </div>
              {isOpen && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ background: "#0a1020", border: "1px solid #1e3060", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ fontSize: 10, color: "#4a6a9a", padding: "2px 6px 6px", borderBottom: "1px solid #1a2540", marginBottom: 2 }}>{ev.gLabel}{ev.label} — 結果を選択</div>
                    {["round1","overall"].map(round => (
                      compCode ? (
                        <a key={round} href={getPdfUrl(compCode, ev.gender, ev.event, round)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#141d35", border: "1px solid #1e2a4a", borderRadius: 6, padding: "9px 12px", cursor: "pointer" }}>
                            <div>
                              <div style={{ fontSize: 12, color: C.text }}>{round==="round1"?"Round 1 結果":"Overall（最終結果）"}</div>
                              <div style={{ fontSize: 10, color: "#4a6a9a" }}>{round==="round1"?"1本目の全選手スコア":"総合順位・確定スコア"}</div>
                            </div>
                            <span style={{ fontSize: 9, background: "#1a3060", color: C.slalom, padding: "2px 6px", borderRadius: 3 }}>PDF</span>
                          </div>
                        </a>
                      ) : (
                        <div key={round} style={{ background: "#141d35", border: "1px solid #1e2a4a", borderRadius: 6, padding: "9px 12px", opacity: 0.4 }}>
                          <div style={{ fontSize: 12, color: C.muted }}>{round==="round1"?"Round 1 結果":"Overall（最終結果）"}</div>
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
      if (cfg) { setCompCode(cfg.code||""); setCompName(cfg.name||""); setInputCode(cfg.code||""); setInputName(cfg.name||""); }
    });
  }, []);

  const iwwfLiveUrl = compCode ? `https://www.iwwfed-ea.org/competition.php?cc=T-${compCode}&page=live` : null;
  const previewUrl  = inputCode ? `https://www.iwwfed-ea.org/competition.php?cc=T-${inputCode}&page=live` : null;

  async function handleSave() {
    setSaving(true);
    const cfg = { code: inputCode.trim().toUpperCase(), name: inputName.trim() };
    await saveCompConfig(cfg);
    setCompCode(cfg.code); setCompName(cfg.name);
    setSaving(false); setSaved(true);
    setTimeout(() => { setSaved(false); setSettingsOpen(false); }, 1200);
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setSettingsOpen(v => !v)} style={{ width: "100%", background: settingsOpen?"#0d1e3a":C.surface, border: `1px solid ${settingsOpen?C.slalom:C.border}`, borderRadius: settingsOpen?"10px 10px 0 0":10, color: settingsOpen?C.slalom:C.muted, fontSize: 12, fontWeight: 700, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚙️ 大会コード設定</span>
          {compCode && !settingsOpen && <span style={{ fontSize: 10, background: "#1a3060", color: C.slalom, padding: "2px 8px", borderRadius: 10, marginLeft: "auto" }}>T-{compCode}</span>}
          <span style={{ marginLeft: "auto", fontSize: 10 }}>{settingsOpen?"▲":"▼"}</span>
        </button>
        {settingsOpen && (
          <div style={{ background: C.surface, border: `1px solid #2a3a5a`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: 14 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#4a6a9a", marginBottom: 6 }}>大会コード（IWWF）</div>
              <div style={{ display: "flex" }}>
                <span style={{ background: "#0a1020", border: "1px solid #1e2a4a", borderRight: "none", borderRadius: "6px 0 0 6px", color: "#3a4a6a", fontSize: 12, padding: "8px 10px" }}>T-</span>
                <input type="text" value={inputCode} onChange={e => setInputCode(e.target.value.toUpperCase())} placeholder="26JPN007" maxLength={10} style={{ flex: 1, background: "#0a1020", border: "1px solid #1e2a4a", borderRadius: "0 6px 6px 0", color: C.text, fontSize: 13, padding: "8px 10px", outline: "none", fontFamily: "monospace" }} />
              </div>
              <div style={{ marginTop: 6, background: "#060c1a", border: "1px solid #1a2035", borderRadius: 6, padding: "7px 10px", fontSize: 10, color: previewUrl?"#5a8aaa":"#3a4a6a", fontFamily: "monospace", wordBreak: "break-all" }}>
                {previewUrl || "大会コードを入力するとURLが表示されます"}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#4a6a9a", marginBottom: 6 }}>大会名（表示用）</div>
              <input type="text" value={inputName} onChange={e => setInputName(e.target.value)} placeholder="例：関東学生春季大会 CS2" style={{ width: "100%", background: "#0a1020", border: "1px solid #1e2a4a", borderRadius: 6, color: C.text, fontSize: 13, padding: "8px 10px", outline: "none", boxSizing: "border-box" }} />
            </div>
            <button onClick={handleSave} disabled={saving} style={{ width: "100%", background: saved?C.positive+"22":"#1a3a6a", border: `1px solid ${saved?C.positive:C.slalom}`, borderRadius: 8, color: saved?C.positive:C.slalom, fontSize: 13, fontWeight: 700, padding: "11px", cursor: "pointer" }}>
              {saved?"✓ 保存しました":saving?"保存中...":"保存する"}
            </button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#0a1020", borderRadius: 8, marginBottom: 12, fontSize: 11, color: compCode?"#5abf8a":"#4a5580" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: compCode?"#4aaa7a":"#5a5a6a", display: "inline-block", flexShrink: 0 }} />
        <span>{compCode?`${compName||"大会"}（T-${compCode}）`:"大会コード未設定 — ⚙️から設定してください"}</span>
      </div>
      <div style={{ background: C.surface, border: "1px solid #1e3a6e", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ background: "#0d2045", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: C.slalom }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: compCode?"#ff4444":"#5a5a6a", display: "inline-block" }} />
            IWWF ライブスコア
          </div>
          {iwwfLiveUrl && <a href={iwwfLiveUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#4a6a9a", textDecoration: "none", border: "1px solid #1e3060", borderRadius: 4, padding: "2px 7px" }}>別窓 ↗</a>}
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
      <ResultButtons compCode={compCode} />
      <style>{`@keyframes liveblink{0%,100%{opacity:1}50%{opacity:0.15}}`}</style>
    </div>
  );
}
