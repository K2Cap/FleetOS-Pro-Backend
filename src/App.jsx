import { useState, useEffect } from "react";

// ─── Colour tokens ────────────────────────────────────────────────────────────
const C = {
  green:  "#1C3829",
  orange: "#E8571A",
  cream:  "#EDEBE2",
  card:   "#fff",
  muted:  "#8a9e95",
  light:  "#f5f3ec",
};

// ─── Backend URL ──────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:3001";

// ─── Small components ─────────────────────────────────────────────────────────
const StatusPill = ({ s }) => {
  const map = { Completed:["#e8f5e9","#2E7D32"], Approved:["#e8f5e9","#2E7D32"], Pending:["#fff8e1","#b45309"], "In Progress":["#e3f0fc","#1a5c9e"] };
  const [bg, col] = map[s] || ["#f0f0f0","#666"];
  return <span style={{ background:bg, color:col, fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>{s}</span>;
};

function PermissionBarrier({ onGranted }) {
  const [status, setStatus] = useState("checking");

  const request = () => {
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      () => { setStatus("granted"); onGranted(); },
      () => { setStatus("denied"); },
      { enableHighAccuracy: true }
    );
  };

  useEffect(() => {
    if (navigator.permissions) {
      navigator.permissions.query({ name: "geolocation" }).then(res => {
        if (res.state === "granted") {
          setStatus("granted");
          onGranted();
        } else {
          setStatus("pending");
        }
      });
    } else {
      setStatus("pending");
    }
  }, []);

  if (status === "granted") return null;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2000, background: C.green, display: "flex", flexDirection: "column", padding: 32, paddingTop: 100, textAlign: "center" }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>📍</div>
      <h2 style={{ color: "#fff", fontSize: 24, fontWeight: 900, marginBottom: 16 }}>Location Permission Required</h2>
      <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 1.6, marginBottom: 40 }}>
        To ensure trip accuracy and safety, FleetOS requires access to your device's location. Please enable location services to proceed.
      </p>

      {status === "denied" && (
        <div style={{ background: "rgba(255,138,128,0.15)", color: "#ff8a80", padding: 16, borderRadius: 12, fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
          ⚠️ Permission denied. Please enable it in your browser/device settings.
        </div>
      )}

      <button 
        onClick={request}
        style={{ background: C.orange, color: "#fff", border: "none", borderRadius: 16, padding: 18, fontSize: 16, fontWeight: 800, cursor: "pointer" }}
      >
        Allow Access & Continue
      </button>
    </div>
  );
}

const Avatar = ({ name, size=44 }) => {
  const init = name ? name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() : "??";
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:C.orange, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.36, fontWeight:800, flexShrink:0 }}>
      {init}
    </div>
  );
};

// ─── Authentication Screens ────────────────────────────────────────────────────

function LoginScreen({ onLoginSuccess }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!phone || !password) return setError("Please enter phone and password");
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/driver/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password })
      });
      const data = await res.json();
      if (res.ok) {
        onLoginSuccess(data);
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err) {
      setError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, background: C.green, display: "flex", flexDirection: "column", padding: 32, paddingTop: 80 }}>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚚</div>
        <h1 style={{ color: "#fff", fontSize: 32, fontWeight: 900, marginBottom: 8, letterSpacing: "-0.04em" }}>FleetOS Driver</h1>
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 15 }}>Enter your registered mobile and password to continue.</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginBottom: 8, display: "block" }}>Mobile Number</label>
          <input 
            type="text" 
            placeholder="e.g. 9822012345" 
            value={phone}
            onChange={e => setPhone(e.target.value)}
            style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: 18, color: "#fff", fontSize: 16, outline: "none" }} 
          />
        </div>
        <div>
          <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginBottom: 8, display: "block" }}>Password / Temp Code</label>
          <input 
            type="password" 
            placeholder="••••••" 
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: 18, color: "#fff", fontSize: 16, outline: "none" }} 
          />
        </div>
      </div>

      {error && <div style={{ marginTop: 20, color: "#ff8a80", fontSize: 13, fontWeight: 600 }}>⚠️ {error}</div>}

      <button 
        onClick={handleLogin}
        disabled={loading}
        style={{ marginTop: "auto", background: C.orange, color: "#fff", border: "none", borderRadius: 16, padding: 20, fontSize: 16, fontWeight: 800, cursor: "pointer", boxShadow: "0 10px 20px rgba(232,87,26,0.3)" }}
      >
        {loading ? "Verifying..." : "Login →"}
      </button>

      <div style={{ marginTop: 24, textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
        By logging in, you agree to FleetOS Terms.
      </div>
    </div>
  );
}

function OnboardingModal({ driverData, onComplete }) {
  const [newPassword, setNewPassword] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState(1); // 1 = Password, 2 = PIN
  const [loading, setLoading] = useState(false);

  const handleFinish = async () => {
    if (step === 1) {
      if (newPassword.length < 4) return alert("Password too short");
      setStep(2);
      return;
    }
    if (pin.length !== 4) return alert("PIN must be 4 digits");

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/driver/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: driverData.driverId, newPassword, pin })
      });
      if (res.ok) {
        onComplete();
      }
    } catch (err) {
      alert("Error saving your profile.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 1000, background: "rgba(28,56,41,0.95)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ background: "#fff", borderRadius: 32, padding: 32, width: "100%", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>🛡️</div>
        <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, color: C.green }}>Security Setup</h2>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>Since this is your first login, please set up a permanent password and a 4-digit PIN.</p>

        {step === 1 ? (
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Set New Password</label>
            <input 
              type="password" 
              autoFocus
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Min 4 characters"
              style={{ width: "100%", background: C.light, border: "2px solid #e0dfd5", borderRadius: 14, padding: 16, fontSize: 16, outline: "none", color: C.green }}
            />
          </div>
        ) : (
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Set 4-Digit Security PIN</label>
            <input 
              type="number" 
              autoFocus
              maxLength={4}
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="0000"
              style={{ width: "100%", background: C.light, border: "2px solid #e0dfd5", borderRadius: 14, padding: 16, fontSize: 24, fontWeight: 900, textAlign: "center", letterSpacing: 12, outline: "none", color: C.green }}
            />
          </div>
        )}

        <button 
          onClick={handleFinish}
          disabled={loading}
          style={{ width: "100%", marginTop: 32, background: C.green, color: "#fff", border: "none", borderRadius: 16, padding: 16, fontSize: 15, fontWeight: 800, cursor: "pointer" }}
        >
          {loading ? "Saving..." : (step === 1 ? "Next Step →" : "Finish Setup ✓")}
        </button>
      </div>
    </div>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function HomeScreen({ name, id, phone, onNav }) {
  const [checkedIn, setCheckedIn] = useState(true);
  return (
    <div style={{ flex:1, overflowY:"auto", paddingBottom:90 }}>
      {/* Header */}
      <div style={{ background:C.green, padding:"44px 22px 28px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12, marginBottom:4 }}>Good morning 👋</div>
            <div style={{ color:"#fff", fontSize:22, fontWeight:900, letterSpacing:"-0.03em" }}>{name}</div>
            <div style={{ color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2 }}>{id} · {phone}</div>
          </div>
          <Avatar name={name} size={46} />
        </div>

        {/* Check-in toggle */}
        <div onClick={() => setCheckedIn(c=>!c)} style={{
          marginTop:20, background: checkedIn ? C.orange : "rgba(255,255,255,0.12)",
          borderRadius:12, padding:"12px 16px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          cursor:"pointer", transition:"background 0.2s",
        }}>
          <div>
            <div style={{ color:"#fff", fontSize:13, fontWeight:700 }}>{checkedIn ? "✅  On Duty" : "🔴  Off Duty"}</div>
            <div style={{ color:"rgba(255,255,255,0.65)", fontSize:11, marginTop:2 }}>{checkedIn ? "Tap to go off duty" : "Tap to start duty"}</div>
          </div>
          <div style={{ width:44, height:24, borderRadius:12, background: checkedIn ? "#fff" : "rgba(255,255,255,0.3)", position:"relative", transition:"background 0.2s" }}>
            <div style={{ position:"absolute", top:3, left: checkedIn?20:3, width:18, height:18, borderRadius:"50%", background: checkedIn ? C.orange : "#fff", transition:"left 0.2s" }} />
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, padding:"18px 16px 0" }}>
        {[
          { icon:"🚛", label:"Trips\nThis Month", val:"5" },
          { icon:"📍", label:"KM\nThis Month",   val:"1,719" },
          { icon:"💰", label:"Earnings\nThis Month", val:"₹41.5K" },
        ].map(s => (
          <div key={s.label} style={{ background:C.card, borderRadius:14, padding:"14px 12px", textAlign:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:22, marginBottom:4 }}>{s.icon}</div>
            <div style={{ fontSize:18, fontWeight:900, color:C.green, letterSpacing:"-0.02em" }}>{s.val}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:3, whiteSpace:"pre-line", lineHeight:1.3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Active trip card */}
      <div style={{ margin:"16px", background:C.green, borderRadius:16, padding:"18px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", right:-20, top:-20, width:100, height:100, borderRadius:"50%", background:"rgba(255,255,255,0.05)" }}/>
        <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.1em", color:C.orange, textTransform:"uppercase", marginBottom:8 }}>🔴 Active Trip</div>
        <div style={{ color:"#fff", fontSize:18, fontWeight:900, marginBottom:4 }}>Mumbai → Pune</div>
        <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12 }}>Trip T-2041 · 148 km · Est. arrival 3:30 PM</div>
        <div style={{ marginTop:14, display:"flex", gap:8 }}>
          <button onClick={()=>onNav("trips")} style={{ flex:1, background:C.orange, border:"none", borderRadius:10, padding:"11px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer" }}>View Details</button>
          <button style={{ flex:1, background:"rgba(255,255,255,0.12)", border:"none", borderRadius:10, padding:"11px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer" }}>SOS 🆘</button>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ padding:"0 16px" }}>
        <div style={{ fontSize:13, fontWeight:800, color:C.green, marginBottom:12 }}>Quick Actions</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {[
            { icon:"📸", label:"Scan Expense",  sub:"Upload bill or receipt", color:C.orange, action:"expenses" },
            { icon:"🗺️", label:"My Trips",       sub:"View trip history",      color:"#1a5c9e", action:"trips" },
            { icon:"📋", label:"Documents",      sub:"DL, Aadhar & permits",   color:"#2E7D32", action:"profile" },
            { icon:"☎️", label:"Call Manager",   sub:"Reach your fleet manager",color:"#7b2d8b", action:null },
          ].map(a => (
            <div key={a.label} onClick={()=>a.action&&onNav(a.action)} style={{ background:C.card, borderRadius:14, padding:"16px 14px", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"flex", flexDirection:"column", gap:6 }}>
              <div style={{ width:38, height:38, borderRadius:10, background:a.color+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{a.icon}</div>
              <div style={{ fontSize:13, fontWeight:800, color:C.green }}>{a.label}</div>
              <div style={{ fontSize:11, color:C.muted, lineHeight:1.4 }}>{a.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TripsScreen() {
  const [selected, setSelected] = useState(null);
  const [tripsData, setTripsData] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/fleet/trips`)
      .then(r => r.json())
      .then(data => {
        setTripsData(data.map(d => ({
          id: d.id, from: d.origin, to: d.destination, date: d.startDate || d.formalDate, km: "N/A", status: d.status, earn: "₹"+(d.freight||0)
        })));
      })
      .catch(console.error);
  }, []);

  if (selected) {
    const t = tripsData.find(x=>x.id===selected);
    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
        <div style={{ background:C.green, padding:"44px 20px 24px", display:"flex", alignItems:"center", gap:14 }}>
          <button onClick={()=>setSelected(null)} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:8, width:34, height:34, color:"#fff", fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
          <div>
            <div style={{ color:"rgba(255,255,255,0.55)", fontSize:11 }}>Trip Details</div>
            <div style={{ color:"#fff", fontSize:16, fontWeight:800 }}>{t?.id}</div>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:16, paddingBottom:90 }}>
          <div style={{ background:C.card, borderRadius:16, padding:20, marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:20, fontWeight:900, color:C.green }}>{t?.from} → {t?.to}</div>
              <StatusPill s={t.status} />
            </div>
            {[["📅 Date", t?.date],["📍 Distance", t?.km+" km"],["💰 Earnings", t?.earn],["🚛 Truck","Assigned"],["👤 Driver","Ravi Kumar"]].map(([l,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #f5f3ec" }}>
                <span style={{ fontSize:13, color:C.muted }}>{l}</span>
                <span style={{ fontSize:13, fontWeight:700, color:C.green }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ background:C.card, borderRadius:16, padding:20 }}>
            <div style={{ fontSize:13, fontWeight:800, color:C.green, marginBottom:12 }}>Trip Timeline</div>
            {[["Departed Mumbai","06:30 AM","✅"],["Toll Plaza – Khopoli","07:45 AM","✅"],["Arrived Pune","09:20 AM","✅"]].map(([e,t,ic])=>(
              <div key={e} style={{ display:"flex", gap:12, paddingBottom:14 }}>
                <div style={{ fontSize:16 }}>{ic}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:C.green }}>{e}</div>
                  <div style={{ fontSize:11, color:C.muted }}>{t}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
      <div style={{ background:C.green, padding:"44px 20px 24px" }}>
        <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12 }}>My Trips</div>
        <div style={{ color:"#fff", fontSize:22, fontWeight:900, letterSpacing:"-0.02em", marginTop:2 }}>Trip History</div>
        <div style={{ display:"flex", gap:8, marginTop:14 }}>
          {["All","This Month","Last Month"].map((f,i)=>(
            <div key={f} style={{ background: i===1?C.orange:"rgba(255,255,255,0.12)", borderRadius:20, padding:"5px 14px", fontSize:12, fontWeight:600, color:"#fff", cursor:"pointer" }}>{f}</div>
          ))}
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"14px 16px", paddingBottom:90 }}>
        {tripsData.map(t=>(
          <div key={t.id} onClick={()=>setSelected(t.id)} style={{ background:C.card, borderRadius:14, padding:"16px", marginBottom:10, boxShadow:"0 1px 4px rgba(0,0,0,0.05)", cursor:"pointer", display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:44, height:44, borderRadius:12, background:C.light, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🚛</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:800, color:C.green }}>{t.from} → {t.to}</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{t.date} · {t.km} km · {t.id}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:14, fontWeight:800, color:C.green }}>{t.earn}</div>
              <StatusPill s={t.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpensesScreen() {
  const [uploaded, setUploaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expensesData, setExpensesData] = useState([]);
  const [formData, setFormData] = useState({ type: "⛽ Diesel", amount: "", tripId: "", notes: "" });

  const fetchExpenses = () => {
    fetch(`${API_BASE}/api/expenses`)
      .then(r => r.json())
      .then(data => {
        setExpensesData(data.map(d => ({
          id: d.id, label: d.type, date: d.date, amount: "₹"+d.amount, status: d.status, icon: d.type.split(" ")[0] || "💰"
        })));
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  const handleSubmit = () => {
    fetch(`${API_BASE}/api/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: formData.type.split(" ").slice(1).join(" ") || formData.type,
        amount: parseFloat(formData.amount)||0,
        tripId: formData.tripId.split(" ")[0] || "",
        notes: formData.notes
      })
    })
    .then(r => r.json())
    .then(d => {
      setShowForm(false);
      setUploaded(false);
      setFormData({ type: "⛽ Diesel", amount: "", tripId: "", notes: "" });
      fetchExpenses();
    })
    .catch(console.error);
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
      <div style={{ background:C.green, padding:"44px 20px 24px" }}>
        <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12 }}>Expenses</div>
        <div style={{ color:"#fff", fontSize:22, fontWeight:900, letterSpacing:"-0.02em", marginTop:2 }}>My Expenses</div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:16, paddingBottom:90 }}>
        {/* Big scan button */}
        {!showForm ? (
          <div onClick={()=>setShowForm(true)} style={{
            background:C.orange, borderRadius:18, padding:"28px 20px",
            textAlign:"center", marginBottom:18, cursor:"pointer",
            boxShadow:"0 4px 20px rgba(232,87,26,0.35)",
          }}>
            <div style={{ fontSize:48, marginBottom:10 }}>📸</div>
            <div style={{ color:"#fff", fontSize:18, fontWeight:900 }}>Scan a Bill</div>
            <div style={{ color:"rgba(255,255,255,0.75)", fontSize:13, marginTop:4 }}>Take a photo of any receipt or invoice</div>
          </div>
        ) : (
          <div style={{ background:C.card, borderRadius:18, padding:20, marginBottom:18, boxShadow:"0 1px 8px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize:14, fontWeight:800, color:C.green, marginBottom:14 }}>New Expense</div>
            
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Expense Type</div>
              <select value={formData.type} onChange={(e)=>setFormData(f=>({...f, type: e.target.value}))} style={{ width:"100%", padding:"11px 12px", borderRadius:10, border:"1.5px solid #ddd8cc", fontSize:14, fontFamily:"inherit", color:C.green, background:"#fdfcf9", outline:"none" }}>
                {["⛽ Diesel","🛣️ Toll","🔧 Repair","🍽️ Food","🅿️ Parking","📦 Other"].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Amount (₹)</div>
              <input type="number" value={formData.amount} onChange={(e)=>setFormData(f=>({...f, amount: e.target.value}))} style={{ width:"100%", padding:"11px 12px", borderRadius:10, border:"1.5px solid #ddd8cc", fontSize:14, fontFamily:"inherit", color:C.green, background:"#fdfcf9", outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Trip</div>
              <input type="text" placeholder="e.g. T-2041" value={formData.tripId} onChange={(e)=>setFormData(f=>({...f, tripId: e.target.value}))} style={{ width:"100%", padding:"11px 12px", borderRadius:10, border:"1.5px solid #ddd8cc", fontSize:14, fontFamily:"inherit", color:C.green, background:"#fdfcf9", outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Note (optional)</div>
              <input type="text" value={formData.notes} onChange={(e)=>setFormData(f=>({...f, notes: e.target.value}))} style={{ width:"100%", padding:"11px 12px", borderRadius:10, border:"1.5px solid #ddd8cc", fontSize:14, fontFamily:"inherit", color:C.green, background:"#fdfcf9", outline:"none", boxSizing:"border-box" }} />
            </div>

            {/* Receipt photo area */}
            <div onClick={()=>setUploaded(true)} style={{ border:`2px dashed ${uploaded?C.orange:"#ddd8cc"}`, borderRadius:12, padding:"20px", textAlign:"center", cursor:"pointer", background: uploaded?"#fdf0e8":"#fdfcf9", marginBottom:14 }}>
              {uploaded ? <><div style={{ fontSize:32 }}>✅</div><div style={{ fontSize:13, fontWeight:700, color:C.orange }}>Photo uploaded</div></> : <><div style={{ fontSize:32 }}>📷</div><div style={{ fontSize:13, color:C.muted }}>Tap to take photo</div></>}
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowForm(false)} style={{ flex:1, background:C.light, border:"none", borderRadius:12, padding:14, fontSize:14, fontWeight:700, color:C.muted, cursor:"pointer" }}>Cancel</button>
              <button onClick={handleSubmit} style={{ flex:2, background:C.green, border:"none", borderRadius:12, padding:14, fontSize:14, fontWeight:700, color:"#fff", cursor:"pointer" }}>Submit ✓</button>
            </div>
          </div>
        )}

        {/* Past expenses */}
        <div style={{ fontSize:13, fontWeight:800, color:C.green, marginBottom:10 }}>Past Expenses</div>
        {expensesData.map(e=>(
          <div key={e.id} style={{ background:C.card, borderRadius:14, padding:"14px 16px", marginBottom:8, display:"flex", alignItems:"center", gap:12, boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
            <div style={{ width:40, height:40, borderRadius:10, background:C.light, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{e.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.green }}>{e.label}</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{e.date} · {e.id}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:14, fontWeight:800, color:C.green, marginBottom:4 }}>{e.amount}</div>
              <StatusPill s={e.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileScreen({ name, phone }) {
  const docs = [
    { icon:"🪪", label:"Driving Licence",    exp:"30 Jun 2027", status:"Valid" },
    { icon:"📄", label:"Aadhaar Card",        exp:"—",          status:"Valid" },
    { icon:"🏥", label:"Medical Certificate", exp:"15 Sep 2026", status:"Valid" },
    { icon:"🚔", label:"Police Verification", exp:"20 Jan 2025", status:"Expired" },
  ];
  return (
    <div style={{ flex:1, overflowY:"auto", paddingBottom:90 }}>
      {/* Header */}
      <div style={{ background:C.green, padding:"44px 20px 32px", textAlign:"center" }}>
        <Avatar name={name} size={72} />
        <div style={{ color:"#fff", fontSize:20, fontWeight:900, marginTop:12, letterSpacing:"-0.02em" }}>{name}</div>
        <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12, marginTop:4 }}>Driver Since Mar 2019</div>
        <div style={{ display:"flex", justifyContent:"center", gap:20, marginTop:16 }}>
          {[["5★","Rating"],["127","Trips"],["42K km","Driven"]].map(([v,l])=>(
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ color:"#fff", fontSize:16, fontWeight:900 }}>{v}</div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding:"16px" }}>
        {/* Info */}
        <div style={{ background:C.card, borderRadius:14, padding:18, marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize:12, fontWeight:800, color:C.orange, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Personal Info</div>
          {[["📱 Mobile", phone],["🏠 Address","Andheri West, Mumbai"],["🩸 Blood Group","O+"],["🆘 Emergency","Family Member"]].map(([l,v])=>(
            <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #f5f3ec" }}>
              <span style={{ fontSize:13, color:C.muted }}>{l}</span>
              <span style={{ fontSize:13, fontWeight:600, color:C.green }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Documents */}
        <div style={{ background:C.card, borderRadius:14, padding:18, marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize:12, fontWeight:800, color:C.orange, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Documents</div>
          {docs.map(d=>(
            <div key={d.label} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid #f5f3ec" }}>
              <span style={{ fontSize:22 }}>{d.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.green }}>{d.label}</div>
                {d.exp !== "—" && <div style={{ fontSize:11, color:C.muted }}>Expires: {d.exp}</div>}
              </div>
              <StatusPill s={d.status === "Expired" ? "Pending" : "Approved"} />
            </div>
          ))}
        </div>

        {/* Assigned truck */}
        <div style={{ background:C.card, borderRadius:14, padding:18, boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize:12, fontWeight:800, color:C.orange, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Assigned Truck</div>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:52, height:52, borderRadius:14, background:C.light, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>🚛</div>
            <div>
              <div style={{ fontSize:15, fontWeight:900, color:C.green, letterSpacing:"0.04em" }}>MH 12 AB 1234</div>
              <div style={{ fontSize:12, color:C.muted }}>Tata Prima · Tanker · 2021</div>
              <div style={{ fontSize:11, color:"#2E7D32", marginTop:2, fontWeight:600 }}>● Active</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────
const NAV = [
  { id:"home",     icon:"🏠", label:"Home" },
  { id:"trips",    icon:"🗺️", label:"Trips" },
  { id:"expenses", icon:"📸", label:"Expenses" },
  { id:"profile",  icon:"👤", label:"Profile" },
];

export default function DriverApp() {
  const [tab, setTab] = useState("home");
  const [user, setUser] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [permGranted, setPermGranted] = useState(false);

  useEffect(() => {
    if (user && permGranted) {
      const track = () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            fetch(`${API_BASE}/api/driver/location`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                driverId: user.driverId, 
                lat: pos.coords.latitude, 
                lng: pos.coords.longitude,
                locationEnabled: true
              })
            });
          },
          (err) => {
            fetch(`${API_BASE}/api/driver/location`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                driverId: user.driverId, 
                locationEnabled: false 
              })
            });
            // Send alert if it's a real error (denied or disabled)
            fetch(`${API_BASE}/api/driver/location-alert`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                driverId: user.driverId, 
                message: `Location disabled by driver ${user.fullName} (${user.phone})` 
              })
            });
          }
        );
      };
      
      track();
      const interval = setInterval(track, 30000);
      return () => clearInterval(interval);
    }
  }, [user, permGranted]);

  const handleLogin = (data) => {
    setUser(data);
    if (!data.isOnboarded) {
      setShowOnboarding(true);
    }
  };

  const ScreenContent = user ? (
    tab === "home" ? <HomeScreen name={user.fullName} id={`DRV-${String(user.driverId).padStart(3,'0')}`} phone={user.phone} onNav={setTab} /> :
    tab === "trips" ? <TripsScreen onNav={setTab} /> :
    tab === "expenses" ? <ExpensesScreen /> :
    tab === "profile" ? <ProfileScreen name={user.fullName} phone={user.phone} /> : 
    <HomeScreen name={user.fullName} id={`DRV-${String(user.driverId).padStart(3,'0')}`} phone={user.phone} onNav={setTab} />
  ) : <LoginScreen onLoginSuccess={handleLogin} />;

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#d8d5cc", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      {/* Phone frame */}
      <div style={{ width:390, height:820, background:C.cream, borderRadius:44, overflow:"hidden", display:"flex", flexDirection:"column", position:"relative", boxShadow:"0 32px 80px rgba(0,0,0,0.35), 0 0 0 8px #b0ada4, 0 0 0 10px #c0bdb4" }}>

        {!permGranted && <PermissionBarrier onGranted={() => setPermGranted(true)} />}
        {showOnboarding && <OnboardingModal driverData={user} onComplete={() => setShowOnboarding(false)} />}

        {/* Status bar */}
        <div style={{ background: user ? C.green : "transparent", padding:"12px 24px 0", display:"flex", justifyContent:"space-between", alignItems:"center", zIndex: 10 }}>
          <span style={{ color: user ? "rgba(255,255,255,0.7)" : "#8a9e95", fontSize:11, fontWeight:600 }}>9:41</span>
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            {[3,2,1].map(i=><div key={i} style={{ width:3, height:3+i*3, background: user ? "rgba(255,255,255,0.7)" : "#8a9e95", borderRadius:1 }}/>)}
            <div style={{ marginLeft:4, width:16, height:8, border:`1.5px solid ${user ? "rgba(255,255,255,0.6)" : "#8a9e95"}`, borderRadius:2, position:"relative" }}>
              <div style={{ position:"absolute", inset:1.5, right:4, background: user ? "rgba(255,255,255,0.7)" : "#8a9e95", borderRadius:1 }}/>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:"hidden", display:"flex", flexDirection:"column" }}>
          {ScreenContent}
        </div>

        {/* Bottom nav */}
        {user && (
          <div style={{ background:"#fff", borderTop:"1px solid #f0ede4", display:"flex", padding:"8px 0 16px", boxShadow:"0 -4px 20px rgba(0,0,0,0.06)" }}>
            {NAV.map(n => (
              <div key={n.id} onClick={()=>setTab(n.id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer" }}>
                <div style={{ fontSize: n.id==="expenses"?26:20, filter: tab===n.id?"none":"grayscale(1) opacity(0.4)" }}>{n.icon}</div>
                <div style={{ fontSize:10, fontWeight: tab===n.id?800:500, color: tab===n.id?C.orange:C.muted, letterSpacing:"0.02em" }}>{n.label}</div>
                {tab===n.id && <div style={{ width:4, height:4, borderRadius:"50%", background:C.orange }}/>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
