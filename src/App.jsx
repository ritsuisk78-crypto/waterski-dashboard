import React, { useState, useCallback } from "react";

const C = {
  bg: "#0a0e1a",
  surface: "#111827",
  surface2: "#162030",
  border: "#1e2d45",
  slalom: "#00d4ff",
  trick: "#ff6b35",
  jump: "#a3e635",
  text: "#e8edf5",
  muted: "#8899aa",
  accent: "#ffd700",
  men: "#4e9eff",
  women: "#ff6eb4",
};

const EVENTS = ["slalom", "trick", "jump"];
const ECFG = {
  slalom: { label: "スラローム", short: "SL", color: C.slalom, unit: "ブイ", icon: "🌊", placeholder: "例:58.5" },
  trick:  { label: "トリック",   short: "TR", color: C.trick,  unit: "点",   icon: "🔄", placeholder: "例:8500" },
  jump:   { label: "ジャンプ",   short: "JU", color: C.jump,   unit: "m",    icon: "🚀", placeholder: "例:52.0" },
};

let _uid = 1;
const newSkier = () => ({ id: _uid++, name: "", scores: { slalom: "", trick: "", jump: "" } });
const newTeam  = (name = "") => ({ id: _uid++, name, skiers: [newSkier(), newSkier(), newSkier()] });

function calcConv(score, best) {
  const v = parseFloat(score), b = parseFloat(best);
  if (!v || !b || b <= 0) return null;
  return Math.min(Math.round((v * 1000) / b), 1000);
}
function teamEventPts(team, ev, best, topN) {
  const pts = team.skiers.map(sk => calcConv(sk.scores[ev], best)).filter(p => p !== null).sort((a,b)=>b-a);
  if (!pts.length) return null;
  const n = topN > 0 ? Math.min(topN, pts.length) : pts.length;
  return pts.slice(0, n).reduce((a,b)=>a+b,0);
}
function teamTotal(team, bests, topN) {
  const pts = EVENTS.map(e => teamEventPts(team, e, bests[e], topN));
  if (pts.some(p => p === null)) return null;
  return pts.reduce((a,b)=>a+b,0);
}

function NumInput({ value, onChange, placeholder, style={} }) {
  return (
    <input type="number" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 14, padding: "8px 10px", outline: "none", fontFamily: "monospace", width: "100%", boxSizing: "border-box", WebkitAppearance: "none", ...style }} />
  );
}

function SkierRow({ skier, onUpdate, onRemove, bests }) {
  return (
    <div style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input value={skier.name} onChange={e => onUpdate(skier.id, "name", null, e.target.value)} placeholder="選手名"
          style={{ background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontWeight: 600, padding: "2px 0", outline: "none", flex: 1 }} />
        <button onClick={() => onRemove(skier.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: "2px 6px" }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {EVENTS.map(ev => {
          const cfg = ECFG[ev];
          const conv = calcConv(skier.scores[ev], bests[ev]);
          return (
            <div key={ev}>
              <div style={{ fontSize: 10, color: cfg.color, marginBottom: 3 }}>{cfg.icon} {cfg.short}</div>
              <NumInput value={skier.scores[ev]} onChange={v => onUpdate(skier.id, "score", ev, v)} placeholder={cfg.placeholder} style={{ fontSize: 13, padding: "6px 8px" }} />
              {conv !== null && <div style={{ fontSize: 11, color: cfg.color, marginTop: 3, fontFamily: "monospace", textAlign: "right" }}>{conv}pt</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamCard({ team, bests, topN, rank, onUpdateName, onUpdateSkier, onRemoveSkier, onAddSkier, onRemove }) {
  const [open, setOpen] = useState(true);
  const epts = EVENTS.map(e => teamEventPts(team, e, bests[e], topN));
  const total = epts.every(p=>p!==null) ? epts.reduce((a,b)=>a+b,0) : null;
  const medal = ["🥇","🥈","🥉"][rank] ?? null;
  const medalColor = rank===0?"#FFD700":rank===1?"#C0C0C0":rank===2?"#CD7F32":C.border;
  return (
    <div style={{ background: C.surface, border: `1px solid ${rank<3?medalColor+"55":C.border}`, borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
      <div onClick={() => setOpen(o=>!o)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 18, minWidth: 24 }}>{medal ?? <span style={{ fontSize: 13, color: C.muted, fontFamily: "monospace" }}>{rank+1}</span>}</span>
        <input value={team.name} onChange={e => { e.stopPropagation(); onUpdateName(team.id, e.target.value); }} onClick={e => e.stopPropagation()} placeholder="チーム名"
          style={{ background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 15, fontWeight: 700, padding: "2px 0", outline: "none", flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {EVENTS.map((e,i) => (
            <div key={e} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: ECFG[e].color }}>{ECFG[e].icon}</div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: epts[i]!==null?ECFG[e].color:C.border }}>{epts[i]??"-"}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "right", minWidth: 56 }}>
          <div style={{ fontSize: 9, color: C.muted }}>合計</div>
          <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: total!==null?C.accent:C.border }}>{total!==null?total.toLocaleString():"—"}</div>
        </div>
        <span style={{ color: C.muted, fontSize: 14, marginLeft: 4 }}>{open?"▲":"▼"}</span>
        <button onClick={e => { e.stopPropagation(); onRemove(team.id); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: "2px 4px" }}>🗑</button>
      </div>
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          {team.skiers.map(sk => <SkierRow key={sk.id} skier={sk} bests={bests} onUpdate={onUpdateSkier} onRemove={onRemoveSkier} />)}
          <button onClick={() => onAddSkier(team.id)} style={{ background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 13, padding: "8px", cursor: "pointer", width: "100%" }}>＋ 選手を追加</button>
        </div>
      )}
    </div>
  );
}

function GenderPanel({ gender, genderColor, teams, setTeams, bests, setBests, topN }) {
  const [bestsOpen, setBestsOpen] = useState(false);
  const ranked = [...teams].map(t => ({ ...t, _total: teamTotal(t, bests, topN) })).sort((a,b) => (b._total??-1)-(a._total??-1));
  const updateName  = (id, name) => setTeams(p=>p.map(t=>t.id===id?{...t,name}:t));
  const updateSkier = (sid, type, ev, val) => setTeams(p=>p.map(t=>({ ...t, skiers: t.skiers.map(sk=>{ if(sk.id!==sid) return sk; if(type==="name") return {...sk,name:val}; return {...sk,scores:{...sk.scores,[ev]:val}}; }) })));
  const removeSkier = (sid) => setTeams(p=>p.map(t=>({...t,skiers:t.skiers.filter(sk=>sk.id!==sid)})));
  const addSkier    = (tid) => setTeams(p=>p.map(t=>t.id===tid?{...t,skiers:[...t.skiers,newSkier()]}:t));
  const removeTeam  = (id)  => setTeams(p=>p.filter(t=>t.id!==id));
  const getRank     = (id)  => ranked.findIndex(t=>t.id===id);
  return (
    <div>
      <div style={{ background: `linear-gradient(135deg,${genderColor}22,transparent)`, border: `1px solid ${genderColor}44`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{gender==="men"?"👨":"👩"}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: genderColor }}>{gender==="men"?"男子":"女子"}</span>
        <span style={{ fontSize: 12, color: C.muted }}>{ranked.length}チーム</span>
        <button onClick={()=>setBestsOpen(o=>!o)} style={{ marginLeft: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
          📊 最高スコア設定 {bestsOpen?"▲":"▼"}
        </button>
      </div>
      {bestsOpen && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>部門最高スコア（換算基準）</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {EVENTS.map(e => {
              const cfg = ECFG[e];
              return (
                <div key={e}>
                  <label style={{ display: "block", fontSize: 10, color: cfg.color, marginBottom: 4 }}>{cfg.icon} {cfg.label}（{cfg.unit}）</label>
                  <NumInput value={bests[e]} onChange={v=>setBests(b=>({...b,[e]:v}))} placeholder={cfg.placeholder} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {ranked.map(t => (
        <TeamCard key={t.id} team={t} bests={bests} topN={topN} rank={getRank(t.id)}
          onUpdateName={updateName} onUpdateSkier={updateSkier} onRemoveSkier={removeSkier} onAddSkier={addSkier} onRemove={removeTeam} />
      ))}
      <button onClick={()=>setTeams(p=>[...p,newTeam()])} style={{ background:"none", border:`1px dashed ${C.border}`, borderRadius:8, color:C.muted, fontSize:13, padding:"10px", cursor:"pointer", width:"100%", marginBottom:4 }}>＋ チームを追加</button>
    </div>
  );
}

export default function App() {
  const [topN, setTopN] = useState(3);
  const [activeTab, setActiveTab] = useState("men");
  const [menTeams,   setMenTeams]   = useState([newTeam("チームA"), newTeam("チームB"), newTeam("チームC")]);
  const [womenTeams, setWomenTeams] = useState([newTeam("チームA"), newTeam("チームB"), newTeam("チームC")]);
  const [menBests,   setMenBests]   = useState({ slalom:"", trick:"", jump:"" });
  const [womenBests, setWomenBests] = useState({ slalom:"", trick:"", jump:"" });
  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Segoe UI','Helvetica Neue',sans-serif" }}>
      <div style={{ position:"sticky", top:0, zIndex:100, background:"#0a0e1add", backdropFilter:"blur(12px)", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:900, margin:"0 auto", padding:"10px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:18, fontWeight:900, color:C.slalom, fontFamily:"'Georgia',serif" }}>WaterSki</span>
            <span style={{ fontSize:13, color:C.muted }}>大学選手権　団体戦</span>
            <span style={{ fontSize:11, background:C.accent+"22", color:C.accent, padding:"2px 8px", borderRadius:20, border:`1px solid ${C.accent}44` }}>IWWF換算点</span>
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"5px 10px" }}>
              <span style={{ fontSize:11, color:C.muted }}>上位</span>
              <input type="number" inputMode="numeric" min={1} value={topN} onChange={e=>setTopN(Math.max(1,parseInt(e.target.value)||1))}
                style={{ width:36, background:C.bg, border:`1px solid ${C.accent}66`, borderRadius:5, color:C.accent, fontSize:15, fontWeight:700, fontFamily:"monospace", padding:"2px 4px", outline:"none", textAlign:"center", WebkitAppearance:"none" }} />
              <span style={{ fontSize:11, color:C.muted }}>名</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:0, marginTop:10 }}>
            {[{ key:"men", label:"👨 男子", color:C.men }, { key:"women", label:"👩 女子", color:C.women }].map(t => (
              <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{ flex:1, background:"none", border:"none", borderBottom: activeTab===t.key?`2px solid ${t.color}`:`2px solid transparent`, color: activeTab===t.key?t.color:C.muted, fontSize:14, fontWeight:activeTab===t.key?700:400, padding:"8px 0", cursor:"pointer" }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ maxWidth:900, margin:"0 auto", padding:"16px" }}>
        {activeTab==="men" && <GenderPanel gender="men" genderColor={C.men} teams={menTeams} setTeams={setMenTeams} bests={menBests} setBests={setMenBests} topN={topN} />}
        {activeTab==="women" && <GenderPanel gender="women" genderColor={C.women} teams={womenTeams} setTeams={setWomenTeams} bests={womenBests} setBests={setWomenBests} topN={topN} />}
      </div>
      <div style={{ maxWidth:900, margin:"0 auto", padding:"0 16px 32px" }}>
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px", fontSize:11, color:C.muted, lineHeight:1.9 }}>
          💡 <strong style={{ color:C.text }}>使い方：</strong>「📊 最高スコア設定」を開いて部門最高スコアを入力 → 各選手のスコアを入力 → チーム合計が自動計算・順位が自動更新されます。チームヘッダーをタップで選手リストを開閉できます。
        </div>
      </div>
    </div>
  );
}
