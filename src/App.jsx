import React, { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: "#08101e", surface: "#0f1c2e", surface2: "#162438",
  border: "#1e3050", slalom: "#00d4ff", trick: "#ff6b35",
  jump: "#a3e635", text: "#e8edf5", muted: "#6b84a0",
  accent: "#ffd700", men: "#4e9eff", women: "#ff6eb4",
  keio: "#00a0e9", positive: "#4ade80", negative: "#f87171",
  overlay: "rgba(4,10,20,0.85)",
};

const SCHOOLS = ["慶應", "法政", "立教", "福大", "学習院"];
const EVENTS  = ["slalom", "trick", "jump"];
const ECFG = {
  slalom: { label: "スラローム", short: "S", color: C.slalom, unit: "ブイ", icon: "🌊", step: "0.5" },
  trick:  { label: "トリック",   short: "T", color: C.trick,  unit: "点",   icon: "🔄", step: "100" },
  jump:   { label: "ジャンプ",   short: "J", color: C.jump,   unit: "m",    icon: "🚀", step: "0.5" },
};

const DEFAULT_CONFIG = {
  men: {
    pin:      { slalom: 65, trick: 10000, jump: 62 },
    topN:     3, out: 4,
    handicap: 15,   // jump handicap in meters
    label: "男子", icon: "👨", color: C.men,
  },
  women: {
    pin:      { slalom: 58, trick: 8500, jump: 44 },
    topN:     2, out: 3,
    handicap: 10,
    label: "女子", icon: "👩", color: C.women,
  },
};

// Build empty skier list for a school/event/gender
function buildSkiers(count) {
  return Array.from({ length: count }, () => ({ name: "", planned: "", actual: "" }));
}
function buildInitialData() {
  const data = { men: {}, women: {} };
  for (const g of ["men", "women"]) {
    const cfg = DEFAULT_CONFIG[g];
    for (const e of EVENTS) {
      data[g][e] = {};
      for (const s of SCHOOLS) {
        data[g][e][s] = buildSkiers(cfg.out);
      }
    }
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION
// ─────────────────────────────────────────────────────────────────────────────
function applyHandicap(score, event, handicap) {
  if (event !== "jump") return score;
  const v = parseFloat(score);
  if (isNaN(v)) return null;
  return Math.max(0, v - handicap);
}

function calcConv(rawScore, event, pin, handicap) {
  const score = applyHandicap(rawScore, event, handicap);
  if (score === null || score === undefined) return null;
  const v = parseFloat(score), p = parseFloat(pin);
  if (isNaN(v) || isNaN(p) || p <= 0) return null;
  return Math.min(Math.round((v * 1000) / p), 1000);
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

// Event is "complete" when ALL schools have ALL actual scores filled
function getCompletedEvents(gender, data) {
  return EVENTS.filter(e =>
    SCHOOLS.every(s => {
      const skiers = data[e]?.[s] || [];
      return skiers.length > 0 && skiers.every(sk => sk.actual !== "");
    })
  );
}

function ptToUnit(ptDiff, pinVal) {
  return Math.abs((ptDiff * pinVal) / 1000).toFixed(1);
}
function signStr(v, suffix = "") {
  if (v === null || v === undefined) return "—";
  return (v >= 0 ? "+" : "") + v + suffix;
}
function diffColor(v) {
  return v === null ? C.muted : v >= 0 ? C.positive : C.negative;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL STORAGE
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY_DATA   = "waterski_data_v2";
const LS_KEY_CONFIG = "waterski_config_v2";

function loadFromStorage() {
  try {
    const d = localStorage.getItem(LS_KEY_DATA);
    const c = localStorage.getItem(LS_KEY_CONFIG);
    return {
      data:   d ? JSON.parse(d) : null,
      config: c ? JSON.parse(c) : null,
    };
  } catch { return { data: null, config: null }; }
}
function saveToStorage(data, config) {
  try {
    localStorage.setItem(LS_KEY_DATA,   JSON.stringify(data));
    localStorage.setItem(LS_KEY_CONFIG, JSON.stringify(config));
  } catch {}
}
function clearStorage() {
  try {
    localStorage.removeItem(LS_KEY_DATA);
    localStorage.removeItem(LS_KEY_CONFIG);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI
// ─────────────────────────────────────────────────────────────────────────────
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
      type="number"
      inputMode="decimal"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      step={step || "any"}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        color: C.text, fontSize: 14, padding: "8px 10px", outline: "none",
        fontFamily: "monospace", width: "100%", boxSizing: "border-box",
        WebkitAppearance: "none", ...style,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER POPUP
// ─────────────────────────────────────────────────────────────────────────────
function PlayerPopup({ gender, school, event, mode, config, data, onClose }) {
  const cfg  = config[gender];
  const ecfg = ECFG[event];
  const skiers = data[gender]?.[event]?.[school] || [];
  const result = calcEventResult(skiers, event, cfg.pin[event], cfg.topN, mode, cfg.handicap);

  return (
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
          <span style={{ fontSize: 22 }}>{ecfg.icon}</span>
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
                {event === "jump"
                  ? `${result.totalScore.toFixed(1)}m（ハンデ前）`
                  : `${result.totalScore}${ecfg.unit}`}
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
                <div style={{ fontSize: 13, fontWeight: 600, color: sk.name ? C.text : C.muted }}>
                  {sk.name || `選手${i + 1}`}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>想定: {sk.planned || "—"}{ecfg.unit}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: hasActual ? ecfg.color : C.muted }}>
                  {displayScore}
                  {hasActual && <span style={{ fontSize: 9, color: C.positive, marginLeft: 4 }}>実</span>}
                </div>
                <div style={{
                  fontSize: 12, fontFamily: "monospace",
                  color: isAdopted ? C.accent : C.muted, fontWeight: isAdopted ? 700 : 400,
                }}>
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────────────────────
function SettingsTab({ config, setConfig, onReset }) {
  const [gender, setGender] = useState("men");
  const cfg = config[gender];

  const update = (field, val) => {
    setConfig(prev => ({
      ...prev,
      [gender]: { ...prev[gender], [field]: val },
    }));
  };
  const updatePin = (event, val) => {
    setConfig(prev => ({
      ...prev,
      [gender]: { ...prev[gender], pin: { ...prev[gender].pin, [event]: val } },
    }));
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <GenderToggle gender={gender} onChange={setGender} />

      {/* ピン想定 */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color, marginBottom: 12 }}>
          {cfg.icon} {cfg.label}　ピン想定（個人1位予想）
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {EVENTS.map(e => (
            <div key={e}>
              <div style={{ fontSize: 10, color: ECFG[e].color, marginBottom: 4 }}>{ECFG[e].icon} {ECFG[e].label}（{ECFG[e].unit}）</div>
              <NumField
                value={cfg.pin[e]}
                onChange={v => updatePin(e, v)}
                placeholder={ECFG[e].label}
                step={ECFG[e].step}
                style={{ border: `1px solid ${ECFG[e].color}44`, color: ECFG[e].color }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 集計設定 */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>📋 集計設定</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>出場人数</div>
            <NumField value={cfg.out} onChange={v => update("out", parseInt(v) || 1)} placeholder="4" step="1" />
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>採用人数（上位N人どり）</div>
            <NumField value={cfg.topN} onChange={v => update("topN", parseInt(v) || 1)} placeholder="3" step="1" />
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.jump, marginBottom: 4 }}>🚀 Jハンデ（m引き）</div>
            <NumField value={cfg.handicap} onChange={v => update("handicap", parseFloat(v) || 0)} placeholder="15" step="0.5"
              style={{ border: `1px solid ${C.jump}44`, color: C.jump }} />
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
          現在：{cfg.out}人出・{cfg.topN}人どり　Jハンデ -{cfg.handicap}m
        </div>
      </div>

      {/* リセット */}
      <div style={{ background: C.surface, border: `1px solid ${C.negative}33`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.negative, marginBottom: 8 }}>⚠️ データリセット</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          全ての入力データ・設定を初期化します。この操作は元に戻せません。
        </div>
        <button onClick={onReset} style={{
          background: C.negative + "22", border: `1px solid ${C.negative}66`,
          borderRadius: 8, color: C.negative, fontSize: 13, fontWeight: 700,
          padding: "10px 20px", cursor: "pointer", width: "100%",
        }}>
          🗑 全データをリセット
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TAB
// ─────────────────────────────────────────────────────────────────────────────
function InputTab({ config, data, setData }) {
  const [gender, setGender] = useState("men");
  const [event,  setEvent]  = useState("slalom");
  const [school, setSchool] = useState("慶應");

  const cfg   = config[gender];
  const ecfg  = ECFG[event];
  const skiers = data[gender]?.[event]?.[school] || [];

  const updateSkier = useCallback((idx, field, val) => {
    setData(prev => {
      const updated = prev[gender][event][school].map((sk, i) =>
        i === idx ? { ...sk, [field]: val } : sk
      );
      return {
        ...prev,
        [gender]: { ...prev[gender], [event]: { ...prev[gender][event], [school]: updated } },
      };
    });
  }, [gender, event, school, setData]);

  return (
    <div>
      <GenderToggle gender={gender} onChange={g => { setGender(g); setSchool("慶應"); }} />

      {/* 種目選択 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {EVENTS.map(e => {
          const c = ECFG[e];
          const skrs = data[gender]?.[e]?.[school] || [];
          const f = skrs.filter(sk => sk.actual !== "").length;
          const t = skrs.length;
          const done = f === t && t > 0;
          return (
            <button key={e} onClick={() => setEvent(e)} style={{
              flex: 1,
              background: event === e ? c.color + "22" : C.surface,
              border: `1px solid ${event === e ? c.color : C.border}`,
              borderRadius: 10, color: event === e ? c.color : C.muted,
              fontSize: 13, fontWeight: event === e ? 700 : 400,
              padding: "10px 6px", cursor: "pointer", textAlign: "center",
            }}>
              <div style={{ fontSize: 20, marginBottom: 2 }}>{c.icon}</div>
              <div style={{ marginBottom: 4 }}>{c.short}</div>
              <MiniProgress filled={f} total={t} color={c.color} />
            </button>
          );
        })}
      </div>

      {/* 学校選択 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {SCHOOLS.map(s => {
          const skrs = data[gender]?.[event]?.[s] || [];
          const f = skrs.filter(sk => sk.actual !== "").length;
          const t = skrs.length;
          const done = f === t && t > 0;
          return (
            <button key={s} onClick={() => setSchool(s)} style={{
              background: school === s ? C.keio : C.surface,
              border: `1px solid ${school === s ? C.keio : C.border}`,
              borderRadius: 20, color: school === s ? "#fff" : C.muted,
              fontSize: 12, padding: "5px 12px", cursor: "pointer",
              fontWeight: school === s ? 700 : 400, textAlign: "center",
            }}>
              <div>{s}</div>
              <div style={{ fontSize: 10, color: school === s ? "#ffffffaa" : done ? C.positive : C.muted, fontFamily: "monospace" }}>
                {f}/{t}{done ? " ✅" : ""}
              </div>
            </button>
          );
        })}
      </div>

      {/* 進捗バー */}
      <div style={{ background: C.surface, border: `1px solid ${ecfg.color}33`, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: ecfg.color, fontWeight: 700 }}>{ecfg.icon} {ecfg.label}　{school}</span>
          <MiniProgress filled={skiers.filter(sk => sk.actual !== "").length} total={skiers.length} color={ecfg.color} />
        </div>
        <div style={{ height: 4, background: C.bg, borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${skiers.length ? skiers.filter(sk => sk.actual !== "").length / skiers.length * 100 : 0}%`,
            background: ecfg.color, borderRadius: 2, transition: "width 0.3s",
          }} />
        </div>
        {event === "jump" && (
          <div style={{ fontSize: 10, color: C.jump, marginTop: 6 }}>
            ※ ハンデ -{cfg.handicap}m を引いて換算点を計算します
          </div>
        )}
      </div>

      {/* 選手カード */}
      {skiers.map((sk, i) => {
        const hasActual = sk.actual !== "";
        const score = hasActual ? sk.actual : sk.planned !== "" ? sk.planned : null;
        const pts = score !== null ? calcConv(score, event, cfg.pin[event], cfg.handicap) : null;
        return (
          <div key={i} style={{
            background: C.surface,
            border: `1px solid ${hasActual ? ecfg.color + "55" : C.border}`,
            borderRadius: 10, padding: 14, marginBottom: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{
                background: hasActual ? ecfg.color : C.surface2,
                borderRadius: "50%", width: 26, height: 26, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: hasActual ? C.bg : C.muted,
              }}>{i + 1}</div>
              <input
                value={sk.name}
                onChange={e => updateSkier(i, "name", e.target.value)}
                placeholder={`選手${i + 1}`}
                style={{
                  background: "transparent", border: "none",
                  borderBottom: `1px solid ${C.border}`, color: C.text,
                  fontSize: 14, fontWeight: 700, padding: "2px 0",
                  outline: "none", flex: 1,
                }}
              />
              {hasActual && (
                <span style={{ fontSize: 10, background: C.positive + "22", color: C.positive, border: `1px solid ${C.positive}44`, borderRadius: 10, padding: "2px 8px" }}>
                  ✅ 入力済み
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {/* 想定 */}
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>想定（{ecfg.unit}）</div>
                <NumField
                  value={sk.planned}
                  onChange={v => updateSkier(i, "planned", v)}
                  placeholder="—"
                  step={ecfg.step}
                />
              </div>
              {/* 実際 */}
              <div>
                <div style={{ fontSize: 10, color: hasActual ? ecfg.color : C.muted, marginBottom: 4 }}>
                  {hasActual ? "🔴 実際" : "実際"}
                </div>
                <NumField
                  value={sk.actual}
                  onChange={v => updateSkier(i, "actual", v)}
                  placeholder="入力"
                  step={ecfg.step}
                  style={{ border: `1px solid ${hasActual ? ecfg.color + "66" : C.border}`, color: hasActual ? ecfg.color : C.text }}
                />
              </div>
              {/* 換算点 */}
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>換算点</div>
                <div style={{
                  background: pts !== null ? C.accent + "11" : C.bg,
                  border: `1px solid ${pts !== null ? C.accent + "44" : C.border}`,
                  borderRadius: 6, padding: "8px 10px",
                  fontFamily: "monospace", fontSize: 14,
                  color: pts !== null ? C.accent : C.muted, fontWeight: pts !== null ? 700 : 400,
                  textAlign: "center",
                }}>
                  {pts !== null ? `${pts}pt` : "—"}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT TAB
// ─────────────────────────────────────────────────────────────────────────────
function DiffTables({ gender, schoolResults, config, completedEvents }) {
  const cfg   = config[gender];
  const keio  = schoolResults.find(r => r.school === "慶應");
  const others = schoolResults.filter(r => r.school !== "慶應");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* 総合 */}
      <div style={{ background: C.surface, border: `1px solid ${C.accent}33`, borderRadius: 12, overflow: "hidden" }}>
        <SectionHeader title="🏆 総合　慶應 vs 各校" color={C.accent} />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted, width: "28%" }}>学校</th>
              <th style={{ padding: "6px 8px", textAlign: "center", color: C.accent }}>換算点差</th>
              {EVENTS.map(e => {
                const ecfg = ECFG[e];
                const done = completedEvents.includes(e);
                return (
                  <th key={e} style={{ padding: "6px 8px", textAlign: "center", color: ecfg.color }}>
                    {ecfg.icon}{ecfg.short}{done ? "✅" : ""}換算
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {others.map(r => {
              const d = keio.result.grandTotal !== null && r.result.grandTotal !== null
                ? r.result.grandTotal - keio.result.grandTotal : null;
              return (
                <tr key={r.school} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: C.text }}>{r.school}</td>
                  <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: diffColor(d) }}>
                    {signStr(d, "pt")}
                  </td>
                  {EVENTS.map(e => {
                    const ecfg = ECFG[e];
                    const pinVal = cfg.pin[e];
                    return (
                      <td key={e} style={{ padding: "8px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11, color: d === null ? C.muted : ecfg.color }}>
                        {d === null ? "—" : `${d >= 0 ? "+" : "-"}${ptToUnit(Math.abs(d), pinVal)}${ecfg.unit}`}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 種目別差分 */}
      {EVENTS.map(e => {
        const ecfg = ECFG[e];
        const done = completedEvents.includes(e);
        return (
          <div key={e} style={{ background: C.surface, border: `1px solid ${ecfg.color}33`, borderRadius: 12, overflow: "hidden" }}>
            <SectionHeader
              title={`${ecfg.icon} ${ecfg.label}　慶應 vs 各校${done ? " ✅完了" : ""}`}
              color={done ? C.positive : ecfg.color}
              right="得点差 / 換算pt差"
            />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted, width: "28%" }}>学校</th>
                  <th style={{ padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ color: ecfg.color }}>得点差（{ecfg.unit}）</div>
                    <div style={{ color: C.accent, fontSize: 10 }}>換算点差（pt）</div>
                  </th>
                  <th style={{ padding: "6px 8px", textAlign: "center", color: C.muted, fontSize: 10 }}>
                    <div>慶應</div><div>相手</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {others.map(r => {
                  const kEv = keio.result.ev[e];
                  const rEv = r.result.ev[e];
                  const ptDiff = kEv.totalPts !== null && rEv.totalPts !== null ? rEv.totalPts - kEv.totalPts : null;
                  const sDiff  = kEv.totalScore !== null && rEv.totalScore !== null
                    ? parseFloat((rEv.totalScore - kEv.totalScore).toFixed(1)) : null;
                  return (
                    <tr key={r.school} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: C.text }}>{r.school}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>
                        <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: diffColor(sDiff) }}>
                          {sDiff !== null ? `${sDiff >= 0 ? "+" : ""}${sDiff}${ecfg.unit}` : "—"}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: diffColor(ptDiff), marginTop: 2 }}>
                          {signStr(ptDiff, "pt")}
                        </div>
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
            <SectionHeader title={`${ecfg.icon} ${ecfg.label}　内訳`} color={ecfg.color} right="行をタップで選手詳細 ▶" />
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
                  const done = ev.filledActual === ev.total && ev.total > 0;
                  return (
                    <tr key={school}
                      onClick={() => setPopup({ school, event: e })}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        background: school === "慶應" ? C.keio + "11" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "10px 10px", fontWeight: school === "慶應" ? 700 : 400, color: school === "慶應" ? C.keio : C.text }}>
                        {school} <span style={{ fontSize: 10, color: C.muted }}>▶</span>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center", fontFamily: "monospace", color: ecfg.color }}>
                        {ev.totalScore !== null
                          ? `${e === "jump" ? ev.totalScore.toFixed(1) : ev.totalScore}${ecfg.unit}`
                          : "—"}
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

      {popup && (
        <PlayerPopup
          gender={gender}
          school={popup.school}
          event={popup.event}
          mode={mode}
          config={config}
          data={data}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

function ResultTab({ config, data }) {
  const [gender, setGender] = useState("men");
  const [mode,   setMode]   = useState("B");
  const [view,   setView]   = useState("diff");
  const cfg = config[gender];

  const schoolResults = SCHOOLS.map(school => ({
    school,
    result: calcSchoolResult(school, cfg, mode, data[gender] || {}),
  }));

  const completedEvents = getCompletedEvents(gender, data[gender] || {});

  return (
    <div>
      <GenderToggle gender={gender} onChange={setGender} />

      {/* モード + 全体進捗 */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[{ key: "A", title: "Aモード", sub: "入力済みのみ" }, { key: "B", title: "Bモード", sub: "実際＋想定混在" }].map(m => (
            <button key={m.key} onClick={() => setMode(m.key)} style={{
              flex: 1, background: mode === m.key ? C.accent + "22" : C.surface2,
              border: `1px solid ${mode === m.key ? C.accent : C.border}`,
              borderRadius: 8, color: mode === m.key ? C.accent : C.muted,
              fontSize: 13, fontWeight: mode === m.key ? 700 : 400,
              padding: "8px 10px", cursor: "pointer",
            }}>
              <div>{m.title}</div>
              <div style={{ fontSize: 10, marginTop: 2 }}>{m.sub}</div>
            </button>
          ))}
        </div>

        {/* 全体進捗グリッド */}
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 6 }}>入力進捗</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {EVENTS.map(e => {
            const ecfg = ECFG[e];
            const done = completedEvents.includes(e);
            return (
              <div key={e}>
                <div style={{ fontSize: 10, color: done ? C.positive : ecfg.color, marginBottom: 4 }}>
                  {ecfg.icon} {ecfg.short}{done ? " ✅" : ""}
                </div>
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

      {/* チーム合計 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 14 }}>
        {schoolResults.map(({ school, result }) => (
          <div key={school} style={{
            background: school === "慶應" ? C.keio + "22" : C.surface,
            border: `1px solid ${school === "慶應" ? C.keio : C.border}`,
            borderRadius: 10, padding: "8px 4px", textAlign: "center",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: school === "慶應" ? C.keio : C.text, marginBottom: 4 }}>{school}</div>
            <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: school === "慶應" ? C.keio : C.text }}>
              {result.grandTotal ?? "—"}
            </div>
            <div style={{ fontSize: 9, color: C.muted }}>pt</div>
          </div>
        ))}
      </div>

      {/* 差分/内訳切替 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[{ key: "diff", label: "📉 差分分析" }, { key: "breakdown", label: "📋 種目別内訳" }].map(v => (
          <button key={v.key} onClick={() => setView(v.key)} style={{
            flex: 1, background: view === v.key ? C.surface : C.surface2,
            border: `1px solid ${view === v.key ? C.accent : C.border}`,
            borderRadius: 8, color: view === v.key ? C.accent : C.muted,
            fontSize: 13, fontWeight: view === v.key ? 700 : 400,
            padding: "8px", cursor: "pointer",
          }}>{v.label}</button>
        ))}
      </div>

      {view === "diff" && (
        <DiffTables gender={gender} schoolResults={schoolResults} config={config} completedEvents={completedEvents} />
      )}
      {view === "breakdown" && (
        <EventBreakdown gender={gender} schoolResults={schoolResults} mode={mode} config={config} data={data} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("input");

  // Initialize from localStorage
  const stored = loadFromStorage();
  const [config, setConfig] = useState(() => {
    if (stored.config) {
      // merge with defaults to handle new fields
      return {
        men:   { ...DEFAULT_CONFIG.men,   ...stored.config.men   },
        women: { ...DEFAULT_CONFIG.women, ...stored.config.women },
      };
    }
    return { men: { ...DEFAULT_CONFIG.men }, women: { ...DEFAULT_CONFIG.women } };
  });
  const [data, setData] = useState(() => stored.data || buildInitialData());

  // Sync out count → rebuild skier arrays when config.out changes
  useEffect(() => {
    setData(prev => {
      const next = { ...prev };
      for (const g of ["men", "women"]) {
        const out = config[g].out;
        next[g] = { ...next[g] };
        for (const e of EVENTS) {
          next[g][e] = { ...next[g][e] };
          for (const s of SCHOOLS) {
            const current = next[g][e][s] || [];
            if (current.length !== out) {
              const updated = Array.from({ length: out }, (_, i) =>
                current[i] || { name: "", planned: "", actual: "" }
              );
              next[g][e][s] = updated;
            }
          }
        }
      }
      return next;
    });
  }, [config.men.out, config.women.out]);

  // Auto-save to localStorage
  useEffect(() => {
    saveToStorage(data, config);
  }, [data, config]);

  const handleReset = () => {
    if (window.confirm("全データをリセットしますか？この操作は元に戻せません。")) {
      clearStorage();
      setConfig({ men: { ...DEFAULT_CONFIG.men }, women: { ...DEFAULT_CONFIG.women } });
      setData(buildInitialData());
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Segoe UI','Helvetica Neue',sans-serif" }}>
      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: C.bg + "ee", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "10px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: C.slalom, fontFamily: "'Georgia',serif", letterSpacing: "-0.02em" }}>
              WaterSki
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>大学選手権　団体戦</span>
            <span style={{ fontSize: 10, background: C.accent + "22", color: C.accent, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.accent}44`, marginLeft: "auto" }}>
              IWWF換算点
            </span>
          </div>
          <div style={{ display: "flex", marginTop: 8, borderBottom: `1px solid ${C.border}` }}>
            <AppTab label="⚙️ 設定" active={tab === "settings"} onClick={() => setTab("settings")} />
            <AppTab label="📝 入力" active={tab === "input"}    onClick={() => setTab("input")} />
            <AppTab label="📊 結果" active={tab === "result"}   onClick={() => setTab("result")} />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
        {tab === "settings" && (
          <SettingsTab config={config} setConfig={setConfig} onReset={handleReset} />
        )}
        {tab === "input" && (
          <InputTab config={config} data={data} setData={setData} />
        )}
        {tab === "result" && (
          <ResultTab config={config} data={data} />
        )}
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px 40px" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, color: C.muted, lineHeight: 1.8 }}>
          💾 データは自動保存されます。設定タブからリセット可能です。
        </div>
      </div>
    </div>
  );
}
