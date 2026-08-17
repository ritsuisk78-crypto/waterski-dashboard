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
// ─── スラローム内訳変換（合計ブイ数 → ○ブイ@スピード/ロープ長）─────
const SLALOM_ROPE_SEQUENCE = [16, 14.25, 13, 12, 11.25, 10.75, 10.25, 9.75];
function slalomBreakdown(totalBuoys, gender) {
  const v = parseFloat(totalBuoys);
  if (isNaN(v) || v < 0) return null;
  const maxSpeed = gender === "women" ? 55 : 58;
  const startSpeed = maxSpeed - 9; // 男49km/h・女46km/hからスタートする慣例
  const speedSteps = (maxSpeed - startSpeed) / 3; // 3回の加速で最高速に到達
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

const COMP_ORDER = ["cs1_2025","cs2_2025","inkare_2025","shinjin_2025","cs1_2026","cs2_2026","biwa_2026"];
const COMP_SHORT = {
  cs1_2025:"CS1'25", cs2_2025:"CS2'25",
  inkare_2025:"全日'25", shinjin_2025:"新人'25",
  cs1_2026:"CS1'26", cs2_2026:"CS2'26", biwa_2026:"琵琶湖'26",
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
function SettingsTab({ config, setConfig, onReset, onSave, saving, saved, gender }) {
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
              🚀 ジャンプ1m ≒ 🌊スラローム{slalomEquiv}ブイ ≒ 🔄トリック{trickEquiv}点（現ピン・ハンデ換算）
            </div>
          );
        })()}
      </div>
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

  // 慶應「実際」vs「想定」の比較（種目別・総合）
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
            {/* 慶應 想定差行（総合） */}
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
                    const kEv = keio.result.ev[e];
                    const pEv = keioPlannedSchoolResult.ev[e];
                    const d = kEv.totalPts !== null && pEv.totalPts !== null ? kEv.totalPts - pEv.totalPts : null;
                    const effPin = e === "jump" ? Math.max(0, parseFloat(cfg.pin[e]) - parseFloat(cfg.handicap)) : parseFloat(cfg.pin[e]);
                    return (
                      <td key={e} style={{ padding: "6px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 11, color: d === null ? C.muted : ECFG[e].color, whiteSpace: "nowrap" }}>
                        {d === null ? "—" : `${d >= 0 ? "+" : "-"}${ptToUnit(Math.abs(d), effPin)}${ECFG[e].unit}`}
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
                {/* 慶應 想定差行（種目別） */}
                <tr
                  onClick={() => setDiffPopup({ school: "慶應", event: e })}
                  style={{ background: ecfg.color + "0d", cursor: "pointer" }}
                >
                  <td style={{ padding: "8px 10px", fontSize: 11, color: C.muted }}>慶應 想定差 <span style={{ fontSize: 10, color: C.muted }}>▶</span></td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: diffColor(dScore) }}>{dScore !== null ? `${dScore >= 0 ? "+" : ""}${dScore}${ecfg.unit}` : "—"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: diffColor(dPts), marginTop: 2 }}>{signStr(dPts, "pt")}</div>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontSize: 10, color: C.muted }}>実績 vs 想定</td>
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
                        {ev.totalPts !== null ? `${ev.totalPts}pt` : "—"}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        <MiniProgress filled={ev.filledActual} total={ev.total} color={ecfg.color} />
                      </td>
                    </tr>
                  );
                })}
                {/* 慶應 想定差行（一番下） */}
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
  // PWAの新バージョンを検知したら自動でリロードする
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
      // 起動時にも更新チェックを走らせる
      reg.update();
    });
    // 定期的に更新チェック（5分ごと）
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
              src="data:image/png;base64,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"
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
        {!loading && tab === "settings" && <SettingsTab config={config} setConfig={setConfig} onReset={handleReset} onSave={handleSaveConfig} saving={configSaving} saved={configSaved} gender={gender} />}
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
