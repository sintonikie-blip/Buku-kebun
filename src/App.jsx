import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, onSnapshot, addDoc, updateDoc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "./firebase";

const rp = (n) => "Rp" + Math.round(n || 0).toLocaleString("id-ID");
const kg = (n) => (Number(n) || 0).toLocaleString("id-ID") + " kg";
const N = (v) => Number(v) || 0;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const csv = (rows) => "\ufeff" + rows.map((r) => r.map((v) => { const t = String(v ?? ""); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(";")).join("\r\n");
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } }
  catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const pendCsv = (a) => csv([["Tanggal", "Tipe", "Berat kotor", "Berat bersih", "Harga", "Total", "Pembeli", "Ongkos angkut", "Ongkos panen", "Fee Acut", "Untung bersih", "Lunas", "Tanggal lunas"],
  ...[...a].sort((x, y) => x.tanggal.localeCompare(y.tanggal)).map((x) => [x.tanggal, x.tipe, x.kotor, x.bersih, x.harga, x.total, x.pembeli, x.ongkosAngkut, x.ongkosPanen, x.fee, x.untung, x.lunas ? "Ya" : "Belum", x.tanggalLunas])]);
const biayaCsv = (a) => csv([["Tanggal", "Keterangan", "Nominal"], ...[...a].sort((x, y) => x.tanggal.localeCompare(y.tanggal)).map((x) => [x.tanggal, x.keterangan, x.nominal])]);
function MonthSelect({ items, value, onChange }) {
  const ms = [...new Set([today().slice(0, 7), ...items.filter((x) => !x.dihapus).map((x) => x.tanggal.slice(0, 7))])].sort().reverse();
  return <select value={value} onChange={(e) => onChange(e.target.value)}><option value="">Semua bulan</option>{ms.map((m) => <option key={m} value={m}>{lbl(m)}</option>)}</select>;
}
const TABS = [["pendapatan", "🌴", "Panen"], ["biaya", "🧾", "Biaya"], ["rekap", "📊", "Rekap"], ["lain", "➕", "Lainnya"], ["set", "⚙️", "Atur"]];
const tgl = (t) => `${+t.slice(8)} ${BULAN[+t.slice(5, 7) - 1].slice(0, 3)} ${t.slice(2, 4)}`;
// Animasi 1 detik: koin $ hijau dan buah sawit oranye meletup dari titik ketukan
function burst(x, y) {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = document.createElement("div"); root.className = "burst";
  const ring = document.createElement("span"); ring.className = "ring"; ring.style.left = x + "px"; ring.style.top = y + "px"; root.appendChild(ring);
  const n = 24;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span"), ang = (Math.PI * 2 * i) / n + Math.random() * 0.25, dist = 70 + Math.random() * 100;
    p.className = i % 2 ? "bp fruit" : "bp usd"; if (i % 2 === 0) p.textContent = "$";
    p.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;--r:${(Math.random() - 0.5) * 540}deg;--s:${0.8 + Math.random() * 0.7}`;
    root.appendChild(p);
  }
  document.body.appendChild(root); setTimeout(() => root.remove(), 1100);
}
const DEF = { angkut: 190, panen: 250, fee: 15, minAngkut: 6000 };

// Semua hitungan pakai tarif yang tersimpan di transaksi; ongkos manual tidak ditimpa
function calc(d) {
  const total = Math.round(N(d.bersih) * N(d.harga));
  // Ongkos angkut = berat kotor x tarif, tapi berat kotor minimal 6 ton (minAngkut)
  const angkut = d.angkutManual ? N(d.ongkosAngkut) : Math.round(Math.max(N(d.kotor), N(d.minAngkut)) * N(d.tarifAngkut));
  const panen = d.panenManual ? N(d.ongkosPanen) : Math.round(N(d.bersih) * N(d.tarifPanen));
  const fee = Math.round((total - angkut - panen) * N(d.persenFee) / 100);
  return { total, ongkosAngkut: angkut, ongkosPanen: panen, fee, untung: total - angkut - panen - fee };
}

function useCol(uid, name) {
  const [items, set] = useState([]);
  useEffect(() => onSnapshot(collection(db, "users", uid, name),
    (s) => set(s.docs.map((x) => ({ id: x.id, ...x.data() })).sort((a, b) => b.tanggal.localeCompare(a.tanggal)))), [uid, name]);
  return items;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("pendapatan");
  const [tarif, setTarif] = useState(DEF);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => user && onSnapshot(doc(db, "users", user.uid, "settings", "tarif"), (s) => s.exists() && setTarif({ ...DEF, ...s.data() })), [user]);
  if (user === undefined) return <div className="empty">Memuat…</div>;
  if (!user) return <Login />;
  return (<>
    <div className="wrap">
      {tab === "pendapatan" && <Pendapatan uid={user.uid} tarif={tarif} />}
      {tab === "biaya" && <Biaya uid={user.uid} />}
      {tab === "rekap" && <Rekap uid={user.uid} />}
      {tab === "lain" && <Lainnya uid={user.uid} />}
      {tab === "set" && <Pengaturan uid={user.uid} tarif={tarif} />}
    </div>
    <nav className="tabs">
      {TABS.map(([k, ic, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
        <span className="ti">{ic}</span><span>{l}</span></button>)}
    </nav>
  </>);
}

function Login() {
  const [e, setE] = useState(""), [p, setP] = useState(""), [err, setErr] = useState("");
  const go = async () => { try { await signInWithEmailAndPassword(auth, e, p); } catch { setErr("Email atau password salah."); } };
  return (<div className="login"><h1>Buku Kebun</h1>
    <input type="email" placeholder="Email" value={e} onChange={(x) => setE(x.target.value)} />
    <input type="password" placeholder="Password" value={p} onChange={(x) => setP(x.target.value)} onKeyDown={(x) => x.key === "Enter" && go()} />
    {err && <div className="err">{err}</div>}<button onClick={go}>Masuk</button></div>);
}

function Acts({ onView, onEdit, onDel, children }) {
  return (<div className="acts">{children}
    <button aria-label="Lihat" onClick={onView}>👁️</button>
    <button aria-label="Edit" onClick={onEdit}>✏️</button>
    <button aria-label="Hapus" className="rm" onClick={onDel}>🗑️</button></div>);
}

function Sheet({ children, close }) {
  return <div className="modal" onClick={close}><div className="sheet" onClick={(x) => x.stopPropagation()}>{children}</div></div>;
}

function useSel(list) {
  const [sel, setSel] = useState(new Set());
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rows = sel.size ? list.filter((x) => sel.has(x.id)) : list;
  return { sel, toggle, rows, all: () => setSel(sel.size === list.length ? new Set() : new Set(list.map((x) => x.id))), n: sel.size };
}

function Pendapatan({ uid, tarif }) {
  const items = useCol(uid, "pendapatan");
  const [q, setQ] = useState(""), [bln, setBln] = useState(today().slice(0, 7)), [st, setSt] = useState("semua");
  const [form, setForm] = useState(null), [view, setView] = useState(null);
  const ref = (id) => doc(db, "users", uid, "pendapatan", id);
  const list = useMemo(() => items.filter((x) => !x.dihapus
    && (!bln || x.tanggal.startsWith(bln))
    && (st === "semua" || (st === "lunas") === !!x.lunas)
    && (!q || (x.pembeli || "").toLowerCase().includes(q.toLowerCase()) || x.tanggal.includes(q))), [items, q, bln, st]);
  const s = useSel(list);
  const sum = (k) => s.rows.reduce((a, x) => a + N(x[k]), 0);
  const belum = s.rows.filter((x) => !x.lunas).reduce((a, x) => a + N(x.untung), 0);
  const del = (x) => confirm(`Hapus permanen panen tanggal ${x.tanggal}? Tidak bisa dibatalkan.`) && deleteDoc(ref(x.id));
  const exp = () => saveFile(`pendapatan-${bln || "semua"}.csv`, pendCsv(list), "text/csv");
  const lunas = (x) => updateDoc(ref(x.id), { lunas: !x.lunas, tanggalLunas: x.lunas ? "" : today() });
  return (<>
    <button className="add" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); burst(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2); setTimeout(() => setForm({}), 300); }}>+ Panen Baru</button>
    <Perkiraan uid={uid} items={items} />
    <div className="bar"><input placeholder="Cari pembeli / tanggal" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <div className="bar"><MonthSelect items={items} value={bln} onChange={setBln} />
      <select value={st} onChange={(e) => setSt(e.target.value)}><option value="semua">Semua</option><option value="belum">Belum lunas</option><option value="lunas">Sudah lunas</option></select>
      <button className="csv" onClick={exp}>⬇ CSV</button></div>
    <label className="all"><input type="checkbox" checked={list.length > 0 && s.n === list.length} onChange={s.all} /> Pilih semua</label>
    <div className="list">
      {!list.length && <div className="empty">Belum ada data. Ketuk “+ Panen” untuk mulai.</div>}
      {list.map((x) => (<div className={"row" + (x.lunas ? " lunas" : "")} key={x.id}>
        <input type="checkbox" checked={s.sel.has(x.id)} onChange={() => s.toggle(x.id)} />
        <div onClick={() => setView(x)}>
          <div className="r1"><span className="big">{tgl(x.tanggal)}</span><span className="big">{rp(x.total)}</span></div>
          <div className="r2"><b>{x.tipe}</b> · {kg(x.bersih)}{x.pembeli ? " · " + x.pembeli : ""}</div>
          <div className="r2">Untung bersih <b className="ok">{rp(x.untung)}</b></div></div>
        <Acts onView={() => setView(x)} onEdit={() => setForm(x)} onDel={() => del(x)}>
          <button className="lun" aria-label="Tandai lunas" onClick={() => lunas(x)}>{x.lunas ? "✅" : "⚪"}</button></Acts>
      </div>))}
    </div>
    <div className="sum"><div>
      <span>{s.n ? `${s.n} dipilih` : "Semua yang tampil"} ({s.rows.length} panen)</span><span>{kg(sum("kotor"))} kotor / {kg(sum("bersih"))} bersih</span>
      <span>Pendapatan</span><b>{rp(sum("total"))}</b>
      <span>Ongkos angkut + panen</span><span>{rp(sum("ongkosAngkut") + sum("ongkosPanen"))}</span>
      <span>Fee Acut</span><span>{rp(sum("fee"))}</span>
      <span>Belum lunas</span><span>{rp(belum)}</span>
      <span className="big">Untung bersih</span><span className="u">{rp(sum("untung"))}</span></div></div>
    {form && <PForm names={[...new Set(items.map((x) => x.pembeli).filter(Boolean))]} init={form} tarif={tarif} uid={uid} close={() => setForm(null)} />}
    {view && <Sheet close={() => setView(null)}><h3>Panen {view.tanggal} ({view.tipe === "BB" ? "Buah Besar" : "Buah Kecil"})</h3>
      <div className="dl">
        <span>Pembeli</span><span>{view.pembeli || "-"}</span>
        <span>Berat kotor</span><span>{kg(view.kotor)}</span><span>Berat bersih</span><span>{kg(view.bersih)}</span>
        <span>Harga</span><span>{rp(view.harga)}/kg</span><span className="big">Total</span><b>{rp(view.total)}</b>
        <span>Ongkos angkut ({view.angkutManual ? "manual" : N(view.minAngkut) > N(view.kotor) ? `min ${kg(view.minAngkut)} × ${view.tarifAngkut}` : `${kg(view.kotor)} × ${view.tarifAngkut}`})</span><span>− {rp(view.ongkosAngkut)}</span>
        <span>Ongkos panen ({view.panenManual ? "manual" : `${kg(view.bersih)} × ${view.tarifPanen}`})</span><span>− {rp(view.ongkosPanen)}</span>
        <span>Fee Acut ({view.persenFee}%)</span><span>− {rp(view.fee)}</span>
        <span className="big">Untung bersih</span><b className="ok">{rp(view.untung)}</b>
        <span>Status</span><span>{view.lunas ? `✅ Lunas (${view.tanggalLunas})` : "Belum lunas"}</span>
        {view.terakhirDiedit && <><span>Terakhir diedit</span><span>{new Date(view.terakhirDiedit).toLocaleString("id-ID")}</span></>}
      </div><div className="btns"><button onClick={() => { setForm(view); setView(null); }}>Edit</button>
        <button className="del" onClick={() => { del(view); setView(null); }}>Hapus</button></div></Sheet>}
  </>);
}

function PForm({ init, tarif, uid, close, names }) {
  const baru = !init.id;
  const [d, setD] = useState({
    tanggal: today(), tipe: "BB", kotor: "", bersih: "", harga: "", pembeli: "",
    tarifAngkut: tarif.angkut, tarifPanen: tarif.panen, persenFee: tarif.fee, minAngkut: tarif.minAngkut,
    angkutManual: false, panenManual: false, ongkosAngkut: "", ongkosPanen: "", ...init, ...(init.id ? { minAngkut: init.minAngkut || 0 } : {}) });
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  const c = calc(d);
  const save = async () => {
    if (!N(d.bersih) || !N(d.harga)) return alert("Isi berat bersih dan harga dulu.");
    const { id, ...rest } = d;
    const data = { ...rest, kotor: N(d.kotor), bersih: N(d.bersih), harga: N(d.harga), ...c, terakhirDiedit: Date.now() };
    if (baru) await addDoc(collection(db, "users", uid, "pendapatan"), { ...data, lunas: false, tanggalLunas: "", dihapus: false });
    else await updateDoc(doc(db, "users", uid, "pendapatan", id), data);
    close();
  };
  const num = (k, l, ph) => <label>{l}<input inputMode="decimal" placeholder={ph} value={d[k]} onChange={(e) => set(k, e.target.value)} /></label>;
  const ongkos = (k, m, l) => <label>{l}<input inputMode="numeric" value={d[m] ? d[k] : c[k]}
    onChange={(e) => setD((p) => ({ ...p, [k]: e.target.value, [m]: e.target.value !== "" }))} /></label>;
  return (<Sheet close={close}><h3>{baru ? "Panen baru" : "Edit panen"}</h3><div className="f">
    <label>Tanggal<input type="date" value={d.tanggal} onChange={(e) => set("tanggal", e.target.value)} /></label>
    <div><div className="r2">Type buah</div><div className="radio">
      {["BB", "BK"].map((t) => <button key={t} className={d.tipe === t ? "on" : ""} onClick={() => set("tipe", t)}>{t}</button>)}</div></div>
    {num("kotor", "Berat kotor (kg)")}{num("bersih", "Berat bersih (kg)")}
    {num("harga", "Harga (Rp/kg)")}
    <label>Total<input readOnly value={rp(c.total)} /></label>
    <label className="full">Pembeli (opsional)<input list="pembeli-list" value={d.pembeli} onChange={(e) => set("pembeli", e.target.value)} /><datalist id="pembeli-list">{names.map((n) => <option key={n} value={n} />)}</datalist></label>
    {ongkos("ongkosAngkut", "angkutManual", `Ongkos angkut (${d.tarifAngkut}/kg kotor${N(d.minAngkut) ? ", min " + kg(d.minAngkut) : ""})`)}
    {ongkos("ongkosPanen", "panenManual", `Ongkos panen (${d.tarifPanen}/kg bersih)`)}
    <div className="prev"><span>Fee Acut ({d.persenFee}%)</span><span>{rp(c.fee)}</span>
      <b>Untung bersih</b><b className="ok">{rp(c.untung)}</b></div></div>
    <div className="btns"><button onClick={close}>Batal</button><button className="pri" onClick={save}>Simpan</button></div></Sheet>);
}

function Biaya({ uid }) {
  const items = useCol(uid, "biayaLain");
  const [q, setQ] = useState(""), [bln, setBln] = useState(today().slice(0, 7));
  const [form, setForm] = useState(null), [view, setView] = useState(null);
  const ref = (id) => doc(db, "users", uid, "biayaLain", id);
  const list = useMemo(() => items.filter((x) => !x.dihapus && (!bln || x.tanggal.startsWith(bln))
    && (!q || x.keterangan.toLowerCase().includes(q.toLowerCase()))), [items, q, bln]);
  const s = useSel(list);
  const total = s.rows.reduce((a, x) => a + N(x.nominal), 0);
  const del = (x) => confirm(`Hapus permanen biaya "${x.keterangan}"? Tidak bisa dibatalkan.`) && deleteDoc(ref(x.id));
  const exp = () => saveFile(`biaya-${bln || "semua"}.csv`, biayaCsv(list), "text/csv");
  return (<>
    <button className="add" onClick={() => setForm({})}>+ Biaya Baru</button>
    <div className="bar"><input placeholder="Cari keterangan (mis. pupuk)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <div className="bar"><MonthSelect items={items} value={bln} onChange={setBln} />
      <button className="csv" onClick={exp}>⬇ CSV</button></div>
    <label className="all"><input type="checkbox" checked={list.length > 0 && s.n === list.length} onChange={s.all} /> Pilih semua</label>
    <div className="list two">
      {!list.length && <div className="empty">Belum ada biaya.</div>}
      {list.map((x) => (<div className="row bi" key={x.id}>
        <input type="checkbox" checked={s.sel.has(x.id)} onChange={() => s.toggle(x.id)} />
        <div onClick={() => setView(x)}><div className="r1"><span className="big">{tgl(x.tanggal)}</span><span className="big cost">{rp(x.nominal)}</span></div>
          <div className="r2">{x.keterangan}</div></div>
        <Acts onView={() => setView(x)} onEdit={() => setForm(x)} onDel={() => del(x)} />
      </div>))}</div>
    <div className="sum"><div><span>{s.n ? `${s.n} dipilih` : "Grand total"} ({s.rows.length} biaya)</span><span className="u cost">{rp(total)}</span></div></div>
    {form && <BForm init={form} uid={uid} close={() => setForm(null)} />}
    {view && <Sheet close={() => setView(null)}><h3>Biaya {view.tanggal}</h3><div className="dl">
      <span>Keterangan</span><span>{view.keterangan}</span><span className="big">Nominal</span><b className="cost">{rp(view.nominal)}</b></div>
      <div className="btns"><button onClick={() => { setForm(view); setView(null); }}>Edit</button>
        <button className="del" onClick={() => { del(view); setView(null); }}>Hapus</button></div></Sheet>}
  </>);
}

function BForm({ init, uid, close }) {
  const [d, setD] = useState({ tanggal: today(), nominal: "", keterangan: "", ...init });
  const save = async () => {
    if (!N(d.nominal)) return alert("Isi nominal dulu.");
    const data = { tanggal: d.tanggal, nominal: N(d.nominal), keterangan: d.keterangan, terakhirDiedit: Date.now() };
    if (init.id) await updateDoc(doc(db, "users", uid, "biayaLain", init.id), data);
    else await addDoc(collection(db, "users", uid, "biayaLain"), { ...data, dihapus: false });
    close();
  };
  return (<Sheet close={close}><h3>{init.id ? "Edit biaya" : "Biaya baru"}</h3><div className="f">
    <label>Tanggal<input type="date" value={d.tanggal} onChange={(e) => setD({ ...d, tanggal: e.target.value })} /></label>
    <label>Nominal (Rp)<input inputMode="numeric" value={d.nominal} onChange={(e) => setD({ ...d, nominal: e.target.value })} /></label>
    <label className="full">Keterangan<input value={d.keterangan} placeholder="Sembahyang, servis mobil, pupuk…" onChange={(e) => setD({ ...d, keterangan: e.target.value })} /></label></div>
    <div className="btns"><button onClick={close}>Batal</button><button className="pri" onClick={save}>Simpan</button></div></Sheet>);
}

function Pengaturan({ uid, tarif }) {
  const pend = useCol(uid, "pendapatan"), biaya = useCol(uid, "biayaLain"), cat = useCol(uid, "catatan");
  const backup = () => saveFile(`cadangan-buku-kebun-${today()}.json`, JSON.stringify({ dibuat: today(), tarif, pendapatan: pend, biayaLain: biaya, catatan: cat }, null, 1), "text/plain");
  const [t, setT] = useState(tarif);
  const [lok, setLok] = useState({ nama: "", lat: "", lon: "" }), [hasil, setHasil] = useState([]), [q2, setQ2] = useState("");
  useEffect(() => onSnapshot(doc(db, "users", uid, "settings", "lokasi"), (sn) => sn.exists() && setLok({ nama: sn.data().nama || "", lat: String(sn.data().lat), lon: String(sn.data().lon) })), [uid]);
  const cari = async () => {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q2)}&count=6&language=id`), j = await r.json();
      setHasil(j.results || []); if (!(j.results || []).length) alert("Lokasi tidak ditemukan. Coba nama kecamatan atau kota terdekat, atau isi koordinat manual.");
    } catch { alert("Gagal mencari. Periksa internet."); }
  };
  const gps = () => (navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => setLok({ nama: "Lokasi saya", lat: p.coords.latitude.toFixed(4), lon: p.coords.longitude.toFixed(4) }), () => alert("Tidak bisa mengambil lokasi. Isi manual saja."), { timeout: 10000 }) : alert("Perangkat tidak mendukung lokasi."));
  const simpanLok = async () => {
    const la = Number(lok.lat), lo = Number(lok.lon);
    if (!lok.lat.trim() || !lok.lon.trim() || !isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return alert("Koordinat tidak valid.");
    await setDoc(doc(db, "users", uid, "settings", "lokasi"), { nama: lok.nama, lat: la, lon: lo }); alert("Lokasi kebun disimpan.");
  };
  const save = async () => { await setDoc(doc(db, "users", uid, "settings", "tarif"), { angkut: N(t.angkut), panen: N(t.panen), fee: N(t.fee), minAngkut: N(t.minAngkut) }); alert("Tarif disimpan. Berlaku untuk panen baru."); };
  const f = (k, l) => <label>{l}<input inputMode="decimal" value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>;
  return (<><h3>Tarif</h3><div className="f">
    {f("angkut", "Ongkos angkut (Rp/kg kotor)")}{f("panen", "Ongkos panen (Rp/kg bersih)")}{f("fee", "Fee Acut (%)")}{f("minAngkut", "Minimum berat kotor ongkos angkut (kg)")}</div>
    <p className="r2">Data panen lama tidak ikut berubah; tiap panen menyimpan tarifnya sendiri.</p>
    <div className="btns"><button className="pri" onClick={save}>Simpan tarif</button></div>
    <h3>Lokasi kebun (untuk cuaca)</h3><div className="card">
      <div className="bar" style={{ marginBottom: 8 }}><input placeholder="Cari nama kecamatan / kota" value={q2} onChange={(e) => setQ2(e.target.value)} /><button className="csv" onClick={cari}>Cari</button></div>
      {hasil.map((h) => <button key={h.id} className="hasil" onClick={() => { setLok({ nama: h.name, lat: String(h.latitude), lon: String(h.longitude) }); setHasil([]); }}>{h.name}{h.admin1 ? ", " + h.admin1 : ""}</button>)}
      <div className="f" style={{ marginTop: 6 }}>
        <label className="full">Nama lokasi<input value={lok.nama} onChange={(e) => setLok({ ...lok, nama: e.target.value })} /></label>
        <label>Lintang<input inputMode="decimal" placeholder="-1.2345" value={lok.lat} onChange={(e) => setLok({ ...lok, lat: e.target.value })} /></label>
        <label>Bujur<input inputMode="decimal" placeholder="101.2345" value={lok.lon} onChange={(e) => setLok({ ...lok, lon: e.target.value })} /></label></div>
      <p className="r2" style={{ margin: "6px 0 0" }}>Koordinat pas: di Google Maps tekan lama titik kebun, lalu salin angkanya.</p>
      <div className="btns"><button onClick={gps}>📍 Lokasi saya</button><button className="pri" onClick={simpanLok}>Simpan lokasi</button></div></div>
    <h3>Data</h3><div className="card"><div className="btns" style={{ marginTop: 0 }}><button onClick={backup}>💾 Cadangan semua data</button></div>
      <p className="r2">Simpan file cadangan ke Drive sebulan sekali. Unduh CSV ada di menu Panen dan Biaya.</p></div>
    <div className="btns"><button className="del" onClick={() => signOut(auth)}>Keluar (logout)</button></div></>);
}

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const shift = (m, d) => { const [y, mo] = m.split("-").map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
const lbl = (m) => BULAN[Number(m.split("-")[1]) - 1] + " " + m.split("-")[0];

function Rekap({ uid }) {
  const pend = useCol(uid, "pendapatan"), biaya = useCol(uid, "biayaLain");
  const [m, setM] = useState(today().slice(0, 7));
  const stat = (mm) => {
    const p = pend.filter((x) => !x.dihapus && x.tanggal.startsWith(mm));
    const b = biaya.filter((x) => !x.dihapus && x.tanggal.startsWith(mm));
    const sum = (a, k) => a.reduce((t, x) => t + N(x[k]), 0);
    const tipe = (t) => { const r = p.filter((x) => x.tipe === t); const bersih = sum(r, "bersih"), total = sum(r, "total"); return { n: r.length, bersih, total, avg: bersih ? total / bersih : 0 }; };
    const untung = sum(p, "untung"), biayaLain = sum(b, "nominal");
    const bl = p.filter((x) => !x.lunas);
    return { n: p.length, ada: p.length + b.length, kotor: sum(p, "kotor"), bersih: sum(p, "bersih"), total: sum(p, "total"),
      angkut: sum(p, "ongkosAngkut"), panen: sum(p, "ongkosPanen"), fee: sum(p, "fee"), untung, biayaLain, laba: untung - biayaLain,
      lunas: p.length - bl.length, belum: bl.length, belumRp: sum(bl, "untung"), BB: tipe("BB"), BK: tipe("BK") };
  };
  const s = stat(m), prev = stat(shift(m, -1));
  const diff = prev.ada && prev.laba ? ((s.laba - prev.laba) / Math.abs(prev.laba)) * 100 : null;
  const series = [5, 4, 3, 2, 1, 0].map((i) => { const mm = shift(m, -i); return { mm, laba: stat(mm).laba }; });
  const max = Math.max(1, ...series.map((x) => Math.abs(x.laba)));
  const wa = () => {
    const t = [`*Rekap ${lbl(m)}*`, `Panen: ${s.n}x (bersih ${kg(s.bersih)})`, `BB: ${rp(s.BB.total)} | BK: ${rp(s.BK.total)}`,
      `Pendapatan: ${rp(s.total)}`, `Ongkos angkut: ${rp(s.angkut)}`, `Ongkos panen: ${rp(s.panen)}`, `Fee Acut: ${rp(s.fee)}`,
      `Untung bersih panen: ${rp(s.untung)}`, `Biaya lain: ${rp(s.biayaLain)}`, `*Laba akhir: ${rp(s.laba)}*`,
      `Lunas ${s.lunas}, belum ${s.belum} (${rp(s.belumRp)})`].join("\n");
    window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank");
  };
  const expRekap = () => {
    const ms = [...new Set([...pend, ...biaya].filter((x) => !x.dihapus).map((x) => x.tanggal.slice(0, 7)))].sort();
    if (!ms.length) return alert("Belum ada data.");
    const rows = ms.map((mm) => { const t = stat(mm); return [lbl(mm), t.n, t.bersih, t.total, t.angkut, t.panen, t.fee, t.untung, t.biayaLain, t.laba]; });
    const tot = rows.reduce((acc, r) => acc.map((v, i) => (i === 0 ? "TOTAL" : v + r[i])), ["", ...Array(9).fill(0)]);
    saveFile("rekap-bulanan.csv", csv([["Bulan", "Jumlah panen", "Berat bersih (kg)", "Pendapatan", "Ongkos angkut", "Ongkos panen", "Fee Acut", "Untung bersih panen", "Biaya lain", "Laba akhir"], ...rows, tot]), "text/csv");
  };
  const row = (l, v, b, c) => <><span className={b ? "big" : ""}>{l}</span><span className={(b ? "big " : "") + (c || "")}>{v}</span></>;
  return (<>
    <div className="mn"><button className="ic" onClick={() => setM(shift(m, -1))}>◀</button>
      <b>{lbl(m)}</b><button className="ic" onClick={() => setM(shift(m, 1))}>▶</button></div>
    <div className="card hero"><div className="r2">Laba akhir bulan</div>
      <div className={"hl " + (s.laba < 0 ? "neg" : "ok")}>{rp(s.laba)}</div>
      <div className="r2">{diff === null ? "Belum ada pembanding bulan lalu" :
        `${diff >= 0 ? "▲ naik" : "▼ turun"} ${Math.abs(diff).toFixed(0)}% dari ${lbl(shift(m, -1))} (${rp(prev.laba)})`}</div></div>
    <button className="wa" onClick={wa}>📤 Bagikan rekap ke WhatsApp</button>
    <button className="wa" style={{ background: "#1b6b3a" }} onClick={expRekap}>⬇ Unduh rekap bulanan (CSV)</button>
    <div className="card"><h4>Panen</h4><div className="dl">
      {row("Jumlah panen", s.n + "x")}{row("Berat kotor", kg(s.kotor))}{row("Berat bersih", kg(s.bersih))}</div></div>
    <div className="card"><h4>Per tipe buah</h4><div className="dl">
      {["BB", "BK"].map((t) => <>{row(t === "BB" ? "Buah Besar (BB)" : "Buah Kecil (BK)", rp(s[t].total))}
        <span className="r2">{s[t].n}x · {kg(s[t].bersih)}</span><span className="r2">rata-rata {rp(s[t].avg)}/kg</span></>)}</div></div>
    <div className="card"><h4>Hitungan</h4><div className="dl">
      {row("Pendapatan", rp(s.total), 1)}{row("Ongkos angkut", "− " + rp(s.angkut))}{row("Ongkos panen", "− " + rp(s.panen))}
      {row("Fee Acut", "− " + rp(s.fee))}{row("Untung bersih panen", rp(s.untung), 1, "ok")}
      {row("Biaya lain", "− " + rp(s.biayaLain), 0, "cost")}{row("Laba akhir bulan", rp(s.laba), 1, s.laba < 0 ? "neg" : "ok")}</div></div>
    <div className="card"><h4>Status lunas</h4><div className="dl">
      {row("Sudah lunas", s.lunas + " panen")}{row("Belum lunas", s.belum + " panen")}{row("Untung belum lunas", rp(s.belumRp))}</div></div>
    <div className="card"><h4>Laba 6 bulan terakhir</h4>
      {series.map((x) => <div className="b" key={x.mm}><span>{BULAN[Number(x.mm.split("-")[1]) - 1].slice(0, 3)} {x.mm.slice(2, 4)}</span>
        <div className="track"><div className={"fill" + (x.laba < 0 ? " neg" : "")} style={{ width: (Math.abs(x.laba) / max) * 100 + "%" }} /></div>
        <span>{rp(x.laba)}</span></div>)}</div>
  </>);
}

function Lainnya({ uid }) {
  const [sub, setSub] = useState("");
  const C = { acut: Acut, tren: Tren, tahun: Tahunan, notes: Notepad, pulih: Pulihkan }[sub];
  if (C) return (<><button className="back" onClick={() => setSub("")}>← Kembali</button><C uid={uid} /></>);
  const it = (k, ic, t, d) => <button className="mi-btn" onClick={() => setSub(k)}><span className="mi">{ic}</span><span><b>{t}</b><br /><span className="r2">{d}</span></span></button>;
  return (<div className="list">
    {it("acut", "👤", "Acut", "Fee per bulan, sudah dibayar atau belum")}
    {it("tren", "📈", "Tren produksi", "Berat panen dan harga per kg dari waktu ke waktu")}
    {it("tahun", "📆", "Rekap tahunan", "Total dan laba satu tahun, grafik per bulan")}
    {it("notes", "📝", "Notepad kebun", "Catatan bebas bertanggal")}
    {it("pulih", "♻️", "Pulihkan cadangan", "Kembalikan data dari file cadangan")}
  </div>);
}

function Acut({ uid }) {
  const pend = useCol(uid, "pendapatan").filter((x) => !x.dihapus);
  const [m, setM] = useState(today().slice(0, 7));
  const rows = pend.filter((x) => x.tanggal.startsWith(m));
  const sum = (a) => a.reduce((t, x) => t + N(x.fee), 0);
  const total = sum(rows), dibayar = sum(rows.filter((x) => x.lunas)), belum = total - dibayar, belumSemua = sum(pend.filter((x) => !x.lunas));
  const wa = () => window.open("https://wa.me/?text=" + encodeURIComponent([`*Fee Acut ${lbl(m)}*`, `Jumlah panen: ${rows.length}x`, `Total fee: ${rp(total)}`, `Sudah dibayar: ${rp(dibayar)}`, `Belum dibayar: ${rp(belum)}`].join("\n")), "_blank");
  return (<>
    <div className="mn"><button className="ic" onClick={() => setM(shift(m, -1))}>◀</button><b>{lbl(m)}</b><button className="ic" onClick={() => setM(shift(m, 1))}>▶</button></div>
    <div className="card hero"><div className="r2">Total fee Acut bulan ini</div><div className="hl">{rp(total)}</div></div>
    <div className="card"><div className="dl">
      <span>Sudah dibayar</span><span className="big ok">{rp(dibayar)}</span>
      <span>Belum dibayar</span><span className="big cost">{rp(belum)}</span>
      <span>Belum dibayar (semua bulan)</span><span className="big cost">{rp(belumSemua)}</span></div>
      <p className="r2" style={{ margin: "8px 0 0" }}>Fee dianggap dibayar kalau panennya sudah ditandai lunas.</p></div>
    <button className="wa" onClick={wa}>📤 Bagikan ke WhatsApp</button>
    <div className="list">{!rows.length && <div className="empty">Belum ada panen bulan ini.</div>}
      {rows.map((x) => (<div className={"row ro" + (x.lunas ? " lunas" : "")} key={x.id}>
        <div><div className="r1"><span className="big">{tgl(x.tanggal)}</span></div><div className="r2"><b>{x.tipe}</b> · {kg(x.bersih)} · {x.persenFee}%</div></div>
        <div style={{ textAlign: "right" }}><div className="big">{rp(x.fee)}</div><div className="r2">{x.lunas ? "✅ Dibayar" : "⚪ Belum"}</div></div></div>))}</div>
  </>);
}

function Tren({ uid }) {
  const pend = useCol(uid, "pendapatan").filter((x) => !x.dihapus);
  const [n, setN] = useState(6);
  const cur = today().slice(0, 7), sm = (mm) => BULAN[Number(mm.split("-")[1]) - 1].slice(0, 3) + " " + mm.slice(2, 4);
  const data = Array.from({ length: n }, (_, i) => shift(cur, i - n + 1)).map((mm) => {
    const r = pend.filter((x) => x.tanggal.startsWith(mm));
    const f = (t) => { const a = r.filter((x) => x.tipe === t); const bersih = a.reduce((q, x) => q + N(x.bersih), 0), total = a.reduce((q, x) => q + N(x.total), 0); return { bersih, avg: bersih ? total / bersih : 0 }; };
    return { mm, BB: f("BB"), BK: f("BK") };
  });
  const tot = (d) => d.BB.bersih + d.BK.bersih, max = Math.max(1, ...data.map(tot));
  const best = data.reduce((a, d) => (tot(d) > tot(a) ? d : a), data[0]);
  return (<>
    <div className="radio" style={{ marginBottom: 10 }}>{[6, 12].map((k) => <button key={k} className={n === k ? "on" : ""} onClick={() => setN(k)}>{k} bulan</button>)}</div>
    <div className="card"><h4>Berat bersih per bulan</h4>
      <div className="r2" style={{ marginBottom: 6 }}><span className="dot bb" /> BB &nbsp; <span className="dot bk" /> BK</div>
      {data.map((d) => <div className="b" key={d.mm}><span>{sm(d.mm)}</span>
        <div className="stk"><i className="bb" style={{ width: (d.BB.bersih / max) * 100 + "%" }} /><i className="bk" style={{ width: (d.BK.bersih / max) * 100 + "%" }} /></div>
        <span>{kg(tot(d))}</span></div>)}
      {tot(best) > 0 && <p className="r2" style={{ margin: "8px 0 0" }}>Terbanyak: {lbl(best.mm)} ({kg(tot(best))})</p>}</div>
    <div className="card"><h4>Harga rata-rata per kg</h4><div className="tbl">
      <span className="r2">Bulan</span><span className="r2">BB</span><span className="r2">BK</span>
      {data.map((d) => <><span className="big">{sm(d.mm)}</span><span>{d.BB.avg ? rp(d.BB.avg) : "-"}</span><span>{d.BK.avg ? rp(d.BK.avg) : "-"}</span></>)}</div></div>
  </>);
}

function agg(pend, biaya, pref) {
  const p = pend.filter((x) => !x.dihapus && x.tanggal.startsWith(pref)), b = biaya.filter((x) => !x.dihapus && x.tanggal.startsWith(pref));
  const sum = (a, k) => a.reduce((t, x) => t + N(x[k]), 0);
  const untung = sum(p, "untung"), biayaLain = sum(b, "nominal");
  return { n: p.length, ada: p.length + b.length, kotor: sum(p, "kotor"), bersih: sum(p, "bersih"), total: sum(p, "total"), angkut: sum(p, "ongkosAngkut"),
    panen: sum(p, "ongkosPanen"), fee: sum(p, "fee"), untung, biayaLain, laba: untung - biayaLain };
}

function Tahunan({ uid }) {
  const pend = useCol(uid, "pendapatan"), biaya = useCol(uid, "biayaLain");
  const [y, setY] = useState(today().slice(0, 4));
  const s = agg(pend, biaya, y), prev = agg(pend, biaya, String(Number(y) - 1));
  const diff = prev.ada && prev.laba ? ((s.laba - prev.laba) / Math.abs(prev.laba)) * 100 : null;
  const months = Array.from({ length: 12 }, (_, i) => { const mm = `${y}-${String(i + 1).padStart(2, "0")}`; const a = agg(pend, biaya, mm); return { i, laba: a.laba, ada: a.ada }; });
  const aktif = months.filter((x) => x.ada), max = Math.max(1, ...months.map((x) => Math.abs(x.laba)));
  const best = aktif.reduce((a, x) => (x.laba > a.laba ? x : a), aktif[0] || { laba: 0, i: 0 });
  const row = (l, v, b, c) => <><span className={b ? "big" : ""}>{l}</span><span className={(b ? "big " : "") + (c || "")}>{v}</span></>;
  return (<>
    <div className="mn"><button className="ic" onClick={() => setY(String(Number(y) - 1))}>◀</button><b>Tahun {y}</b><button className="ic" onClick={() => setY(String(Number(y) + 1))}>▶</button></div>
    <div className="card hero"><div className="r2">Laba akhir tahun</div><div className={"hl " + (s.laba < 0 ? "neg" : "ok")}>{rp(s.laba)}</div>
      <div className="r2">{diff === null ? "Belum ada pembanding tahun lalu" : `${diff >= 0 ? "▲ naik" : "▼ turun"} ${Math.abs(diff).toFixed(0)}% dari ${Number(y) - 1} (${rp(prev.laba)})`}</div></div>
    <div className="card"><h4>Panen</h4><div className="dl">{row("Jumlah panen", s.n + "x")}{row("Berat kotor", kg(s.kotor))}{row("Berat bersih", kg(s.bersih))}</div></div>
    <div className="card"><h4>Hitungan</h4><div className="dl">
      {row("Pendapatan", rp(s.total), 1)}{row("Ongkos angkut", "− " + rp(s.angkut))}{row("Ongkos panen", "− " + rp(s.panen))}{row("Fee Acut", "− " + rp(s.fee))}
      {row("Untung bersih panen", rp(s.untung), 1, "ok")}{row("Biaya lain", "− " + rp(s.biayaLain), 0, "cost")}{row("Laba akhir tahun", rp(s.laba), 1, s.laba < 0 ? "neg" : "ok")}</div></div>
    <div className="card"><h4>Laba per bulan</h4>
      {months.map((x) => <div className="b" key={x.i}><span>{BULAN[x.i].slice(0, 3)}</span>
        <div className="track"><div className={"fill" + (x.laba < 0 ? " neg" : "")} style={{ width: (Math.abs(x.laba) / max) * 100 + "%" }} /></div><span>{x.ada ? rp(x.laba) : "-"}</span></div>)}
      {aktif.length > 0 && <p className="r2" style={{ margin: "8px 0 0" }}>Terbaik: {BULAN[best.i]} ({rp(best.laba)}). Rata-rata {rp(s.laba / aktif.length)} per bulan ({aktif.length} bulan ada data).</p>}</div>
  </>);
}

function Notepad({ uid }) {
  const items = useCol(uid, "catatan");
  const [q, setQ] = useState(""), [form, setForm] = useState(null);
  const list = items.filter((x) => !q || x.teks.toLowerCase().includes(q.toLowerCase()) || x.tanggal.includes(q));
  const del = (x) => confirm("Hapus permanen catatan ini? Tidak bisa dibatalkan.") && deleteDoc(doc(db, "users", uid, "catatan", x.id));
  return (<>
    <button className="add" onClick={() => setForm({})}>+ Catatan Baru</button>
    <div className="bar"><input placeholder="Cari catatan" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <div className="list">{!list.length && <div className="empty">Belum ada catatan.</div>}
      {list.map((x) => (<div className="row note" key={x.id}>
        <div style={{ minWidth: 0 }}><div className="r2">{tgl(x.tanggal)}</div><div className="notetext">{x.teks}</div></div>
        <div className="acts"><button aria-label="Edit" onClick={() => setForm(x)}>✏️</button><button aria-label="Hapus" className="rm" onClick={() => del(x)}>🗑️</button></div></div>))}</div>
    {form && <NoteForm init={form} uid={uid} close={() => setForm(null)} />}
  </>);
}

function NoteForm({ init, uid, close }) {
  const [d, setD] = useState({ tanggal: today(), teks: "", ...init });
  const save = async () => {
    if (!d.teks.trim()) return alert("Tulis catatannya dulu.");
    const data = { tanggal: d.tanggal, teks: d.teks.trim(), terakhirDiedit: Date.now() };
    if (init.id) await updateDoc(doc(db, "users", uid, "catatan", init.id), data);
    else await addDoc(collection(db, "users", uid, "catatan"), data);
    close();
  };
  return (<Sheet close={close}><h3>{init.id ? "Edit catatan" : "Catatan baru"}</h3><div className="f">
    <label className="full">Tanggal<input type="date" value={d.tanggal} onChange={(e) => setD({ ...d, tanggal: e.target.value })} /></label>
    <label className="full">Catatan<textarea rows={8} placeholder="Mis. hujan deras, buah banyak busuk; jalan rusak; timbangan rusak…" value={d.teks} onChange={(e) => setD({ ...d, teks: e.target.value })} /></label></div>
    <div className="btns"><button onClick={close}>Batal</button><button className="pri" onClick={save}>Simpan</button></div></Sheet>);
}

function Pulihkan({ uid }) {
  const [info, setInfo] = useState(null), [busy, setBusy] = useState(false);
  const baca = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const ok = (a) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x.id === "string" && typeof x.tanggal === "string" && !x.dihapus);
      setInfo({ nama: f.name, dibuat: j.dibuat || "-", tarif: j.tarif || null, pendapatan: ok(j.pendapatan), biayaLain: ok(j.biayaLain), catatan: ok(j.catatan) });
    } catch { alert("File tidak bisa dibaca. Pastikan ini file cadangan Buku Kebun (.json)."); }
  };
  const pulihkan = async () => {
    if (!confirm(`Pulihkan ${info.pendapatan.length} panen, ${info.biayaLain.length} biaya, ${info.catatan.length} catatan?\nData dengan ID sama akan ditimpa, data lain tidak dihapus.`)) return;
    setBusy(true);
    try {
      const ops = [];
      for (const [col, arr] of [["pendapatan", info.pendapatan], ["biayaLain", info.biayaLain], ["catatan", info.catatan]])
        for (const { id, ...data } of arr) ops.push([doc(db, "users", uid, col, id), data]);
      if (info.tarif) ops.push([doc(db, "users", uid, "settings", "tarif"), { angkut: N(info.tarif.angkut), panen: N(info.tarif.panen), fee: N(info.tarif.fee), minAngkut: N(info.tarif.minAngkut ?? 6000) }]);
      for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach(([r, d]) => b.set(r, d)); await b.commit(); }
      alert("Selesai. Data cadangan sudah dikembalikan."); setInfo(null);
    } catch (e) { alert("Gagal memulihkan: " + e.message); }
    setBusy(false);
  };
  return (<>
    <div className="card"><h4>Pulihkan dari cadangan</h4>
      <p className="r2" style={{ margin: 0 }}>Pilih file cadangan (.json) dari Atur → Data → Cadangan semua data. Data dengan ID yang sama ditimpa, data yang tidak ada di file tidak dihapus. Pastikan ada sinyal internet.</p></div>
    <label className="add" style={{ display: "block", textAlign: "center" }}>📂 Pilih file cadangan
      <input type="file" accept=".json,application/json,text/plain" hidden onChange={baca} /></label>
    {info && <div className="card"><h4>Isi file</h4><div className="dl">
      <span>File</span><span>{info.nama}</span><span>Dibuat</span><span>{info.dibuat}</span>
      <span>Panen</span><span className="big">{info.pendapatan.length}</span><span>Biaya lain</span><span className="big">{info.biayaLain.length}</span>
      <span>Catatan</span><span className="big">{info.catatan.length}</span>
      <span>Tarif</span><span>{info.tarif ? `${info.tarif.angkut} / ${info.tarif.panen} / ${info.tarif.fee}%` : "-"}</span></div>
      <p className="r2" style={{ margin: "8px 0 0" }}>Tarif di file akan menggantikan tarif sekarang di Atur.</p>
      <div className="btns"><button onClick={() => setInfo(null)}>Batal</button><button className="pri" disabled={busy} onClick={pulihkan}>{busy ? "Memulihkan…" : "♻️ Pulihkan sekarang"}</button></div></div>}
  </>);
}

const dn = (t) => Math.round(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10)) / 864e5);
const addD = (t, d) => new Date((dn(t) + d) * 864e5).toISOString().slice(0, 10);
const dm = (t) => `${+t.slice(8)} ${BULAN[+t.slice(5, 7) - 1].slice(0, 3)}`;
const rentang = (a, b) => (a === b ? dm(a) : a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8)}–${dm(b)}` : `${dm(a)} – ${dm(b)}`);
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const wi = (c) => (c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 57 ? "🌦️" : c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 82 ? "🌧️" : "⛈️");

function Perkiraan({ uid, items }) {
  const [lok, setLok] = useState(undefined), [cw, setCw] = useState(null);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("fcOpen") === "1"; } catch { return false; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem("fcOpen", v ? "1" : "0"); } catch {} };
  useEffect(() => onSnapshot(doc(db, "users", uid, "settings", "lokasi"), (sn) => setLok(sn.exists() ? sn.data() : null)), [uid]);
  const la = lok && lok.lat, lo = lok && lok.lon;
  useEffect(() => {
    if (la == null || lo == null) return;
    let off = false; const key = `cuaca:${la},${lo}`;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=weathercode,precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=7`)
      .then((r) => r.json()).then((j) => { if (off || !j.daily) throw 0; const d = { t: Date.now(), daily: j.daily }; try { localStorage.setItem(key, JSON.stringify(d)); } catch {} setCw(d); })
      .catch(() => { if (off) return; try { const c = JSON.parse(localStorage.getItem(key) || "null"); setCw(c ? { ...c, lama: true } : "gagal"); } catch { setCw("gagal"); } });
    return () => { off = true; };
  }, [la, lo]);
  const act = items.filter((x) => !x.dihapus), tg = [...new Set(act.map((x) => x.tanggal))].sort();
  let l1, l1b = "", info = "", s1 = "";
  if (tg.length < 4) { l1 = "🔮 Perkiraan panen: data belum cukup (minimal 4 panen)"; s1 = "🔮 Perkiraan panen: data belum cukup"; }
  else {
    const dts = tg.slice(-7), gaps = dts.slice(1).map((d, i) => dn(d) - dn(dts[i])).sort((a, b) => a - b), n = gaps.length;
    const med = (gaps[(n - 1) >> 1] + gaps[n >> 1]) / 2, last = tg[tg.length - 1], ago = dn(today()) - dn(last);
    const ws = tg.slice(-5).map((d) => act.filter((x) => x.tanggal === d).reduce((a, x) => a + N(x.bersih), 0));
    const avg = ws.reduce((a, v, i) => a + v * (i + 1), 0) / ((ws.length * (ws.length + 1)) / 2), r10 = (v) => Math.round(v / 10) * 10;
    const from = addD(last, gaps[0]), to = addD(last, gaps[n - 1]);
    info = `Panen terakhir ${dm(last)} (${ago} hari lalu). Jarak antar panen biasanya ${gaps[0]}–${gaps[n - 1]} hari, tengahnya ${med} hari.`;
    l1 = dn(to) < dn(today()) ? `🔮 Sudah ${ago} hari sejak panen terakhir, lewat dari kebiasaan (tiap ~${Math.round(med)} hari)` : `🔮 Panen berikutnya sekitar ${rentang(from, to)}`;
    const df = dn(from) - dn(today()), dt = dn(to) - dn(today());
    s1 = dt < 0 ? `🔮 Sudah ${ago} hari sejak panen terakhir` : df <= 0 ? `🔮 Waktunya panen (s/d ${dm(to)})` : `🔮 Panen ${df === 1 ? "besok" : df + " hari lagi"} (${rentang(from, to)})`;
    const nf = (v) => r10(v).toLocaleString("id-ID");
    l1b = `≈ ${kg(r10(avg))} (${nf(Math.min(...ws))}–${nf(Math.max(...ws))} kg)`;
  }
  let w = "🌦️ Atur lokasi kebun di menu Atur untuk melihat cuaca", s2 = "🌦️ Atur lokasi", days = [], chip = "";
  if (lok && cw === "gagal") { w = "🌦️ Cuaca tidak tersedia (periksa internet)"; s2 = "🌦️ Cuaca off"; }
  else if (lok && cw) {
    const d = cw.daily; days = d.time.map((t, i) => ({ t, c: d.weathercode[i], mm: d.precipitation_sum[i], p: d.precipitation_probability_max[i], rain: (d.precipitation_probability_max[i] || 0) >= 60 || (d.precipitation_sum[i] || 0) >= 5 }));
    const rn = days.filter((x) => x.rain), lst = rn.map((x) => `${HARI[new Date(x.t + "T00:00").getDay()]} ${+x.t.slice(8)}`).join(", ");
    w = (rn.length ? `🌧️ Hujan: ${lst}` : "☀️ Tidak ada hujan berarti 7 hari ke depan") + (cw.lama ? " (data lama)" : "");
    s2 = rn.length ? `🌧️ ${lst}` : "☀️ Kering";
    const soon = rn.filter((x) => dn(x.t) >= dn(today()) && dn(x.t) - dn(today()) <= 1);
    if (soon.length) chip = soon.some((x) => dn(x.t) === dn(today())) ? "🌧️ hari ini" : "🌧️ besok";
  } else if (lok) { w = "🌦️ Memuat cuaca…"; s2 = "🌦️ …"; }
  return (<div className="fc" onClick={toggle}>
    {open ? <>
      <div className="l1">{l1}</div>{l1b && <div className="l2">{l1b}</div>}<div className="l2">{w}</div>
      {info && <div className="l2" style={{ marginTop: 6 }}>{info}</div>}
      {days.length > 0 && <div className="fcgrid">{days.map((x) => <div key={x.t} className={x.rain ? "rainy" : ""}><div>{HARI[new Date(x.t + "T00:00").getDay()]} {+x.t.slice(8)}</div><div className="ic2">{wi(x.c)}</div><div>{x.p == null ? "-" : x.p + "%"}</div><div>{Math.round(x.mm || 0)} mm</div></div>)}</div>}
      <div className="l2" style={{ marginTop: 6 }}>Hanya perkiraan dari data panenmu dan prakiraan cuaca, bukan jaminan.</div>
      <div className="r2" style={{ textAlign: "center", fontSize: 11 }}>▲ tutup</div></>
    : <div className="one"><span className="oneT">{s1}</span>{chip && <span className="chip">{chip}</span>}<span>▼</span></div>}
  </div>);
}
