import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, onSnapshot, addDoc, updateDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

const rp = (n) => "Rp" + Math.round(n || 0).toLocaleString("id-ID");
const kg = (n) => (Number(n) || 0).toLocaleString("id-ID") + " kg";
const N = (v) => Number(v) || 0;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const DEF = { angkut: 190, panen: 250, fee: 15 };

// Semua hitungan pakai tarif yang tersimpan di transaksi; ongkos manual tidak ditimpa
function calc(d) {
  const total = Math.round(N(d.bersih) * N(d.harga));
  const angkut = d.angkutManual ? N(d.ongkosAngkut) : Math.round(N(d.kotor) * N(d.tarifAngkut));
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
    <nav className="top">
      {[["pendapatan", "Pendapatan"], ["biaya", "Biaya Lain"], ["set", "Pengaturan"]].map(([k, l]) =>
        <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
    </nav>
    <div className="wrap">
      {tab === "pendapatan" && <Pendapatan uid={user.uid} tarif={tarif} />}
      {tab === "biaya" && <Biaya uid={user.uid} />}
      {tab === "set" && <Pengaturan uid={user.uid} tarif={tarif} />}
    </div>
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

function Menu({ onView, onEdit, onDel, trash, onRestore }) {
  const [o, setO] = useState(false);
  const pick = (f) => () => { setO(false); f(); };
  return (<span style={{ position: "relative" }}>
    <button className="ic" aria-label="Menu" onClick={() => setO(!o)}>⋮</button>
    {o && <div className="dd">
      {trash ? <button onClick={pick(onRestore)}>♻️ Pulihkan</button> : <>
        <button onClick={pick(onView)}>👁️ Lihat</button>
        <button onClick={pick(onEdit)}>✏️ Edit</button>
        <button onClick={pick(onDel)}>🗑️ Hapus</button></>}
    </div>}</span>);
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
  const [q, setQ] = useState(""), [bln, setBln] = useState(""), [st, setSt] = useState("semua");
  const [form, setForm] = useState(null), [view, setView] = useState(null);
  const ref = (id) => doc(db, "users", uid, "pendapatan", id);
  const list = useMemo(() => items.filter((x) => !!x.dihapus === (st === "sampah")
    && (!bln || x.tanggal.startsWith(bln))
    && (st === "semua" || st === "sampah" || (st === "lunas") === !!x.lunas)
    && (!q || (x.pembeli || "").toLowerCase().includes(q.toLowerCase()) || x.tanggal.includes(q))), [items, q, bln, st]);
  const s = useSel(list);
  const sum = (k) => s.rows.reduce((a, x) => a + N(x[k]), 0);
  const belum = s.rows.filter((x) => !x.lunas).reduce((a, x) => a + N(x.untung), 0);
  const del = (x) => confirm(`Yakin hapus panen tanggal ${x.tanggal}? Data dipindah ke Sampah.`) && updateDoc(ref(x.id), { dihapus: true, terakhirDiedit: Date.now() });
  const lunas = (x) => updateDoc(ref(x.id), { lunas: !x.lunas, tanggalLunas: x.lunas ? "" : today() });
  return (<>
    <button className="add" onClick={() => setForm({})}>+ Panen Baru</button>
    <div className="bar"><input placeholder="Cari pembeli / tanggal" value={q} onChange={(e) => setQ(e.target.value)} />
      <input type="month" value={bln} onChange={(e) => setBln(e.target.value)} style={{ flex: "0 0 150px" }} /></div>
    <div className="chips">
      {[["semua", "Semua"], ["belum", "Belum lunas"], ["lunas", "Sudah lunas"], ["sampah", "Sampah"]].map(([k, l]) =>
        <button key={k} className={st === k ? "on" : ""} onClick={() => setSt(k)}>{l}</button>)}
      <button onClick={s.all}>Pilih semua</button></div>
    <div className="list">
      {!list.length && <div className="empty">Belum ada data. Ketuk “+ Panen” untuk mulai.</div>}
      {list.map((x) => (<div className="row" key={x.id}>
        <input type="checkbox" checked={s.sel.has(x.id)} onChange={() => s.toggle(x.id)} />
        <div onClick={() => setView(x)}>
          <div className="r1"><span className="big">{x.tanggal} · {x.tipe}</span><span className="big">{rp(x.total)}</span></div>
          <div className="r2">{kg(x.bersih)}{x.pembeli ? " · " + x.pembeli : ""}</div>
          <div className="r2">Untung bersih <b className="ok">{rp(x.untung)}</b></div></div>
        <div className="right">
          {!x.dihapus && <button className="ic" aria-label="Tandai lunas" onClick={() => lunas(x)}>{x.lunas ? "✅" : "⚪"}</button>}
          <Menu trash={!!x.dihapus} onView={() => setView(x)} onEdit={() => setForm(x)} onDel={() => del(x)}
            onRestore={() => updateDoc(ref(x.id), { dihapus: false })} /></div></div>))}
    </div>
    <div className="sum"><div>
      <span>{s.n ? `${s.n} dipilih` : "Semua yang tampil"} ({s.rows.length} panen)</span><span>{kg(sum("kotor"))} kotor / {kg(sum("bersih"))} bersih</span>
      <span>Pendapatan</span><b>{rp(sum("total"))}</b>
      <span>Ongkos angkut + panen</span><span>{rp(sum("ongkosAngkut") + sum("ongkosPanen"))}</span>
      <span>Fee Acut</span><span>{rp(sum("fee"))}</span>
      <span>Belum lunas</span><span>{rp(belum)}</span>
      <span className="big">Untung bersih</span><span className="u">{rp(sum("untung"))}</span></div></div>
    {form && <PForm init={form} tarif={tarif} uid={uid} close={() => setForm(null)} />}
    {view && <Sheet close={() => setView(null)}><h3>Panen {view.tanggal} ({view.tipe === "BB" ? "Buah Besar" : "Buah Kecil"})</h3>
      <div className="dl">
        <span>Pembeli</span><span>{view.pembeli || "-"}</span>
        <span>Berat kotor</span><span>{kg(view.kotor)}</span><span>Berat bersih</span><span>{kg(view.bersih)}</span>
        <span>Harga</span><span>{rp(view.harga)}/kg</span><span className="big">Total</span><b>{rp(view.total)}</b>
        <span>Ongkos angkut ({view.angkutManual ? "manual" : `${kg(view.kotor)} × ${view.tarifAngkut}`})</span><span>− {rp(view.ongkosAngkut)}</span>
        <span>Ongkos panen ({view.panenManual ? "manual" : `${kg(view.bersih)} × ${view.tarifPanen}`})</span><span>− {rp(view.ongkosPanen)}</span>
        <span>Fee Acut ({view.persenFee}%)</span><span>− {rp(view.fee)}</span>
        <span className="big">Untung bersih</span><b className="ok">{rp(view.untung)}</b>
        <span>Status</span><span>{view.lunas ? `✅ Lunas (${view.tanggalLunas})` : "Belum lunas"}</span>
        {view.terakhirDiedit && <><span>Terakhir diedit</span><span>{new Date(view.terakhirDiedit).toLocaleString("id-ID")}</span></>}
      </div><div className="btns"><button onClick={() => { setForm(view); setView(null); }}>Edit</button>
        <button className="del" onClick={() => { del(view); setView(null); }}>Hapus</button></div></Sheet>}
  </>);
}

function PForm({ init, tarif, uid, close }) {
  const baru = !init.id;
  const [d, setD] = useState({
    tanggal: today(), tipe: "BB", kotor: "", bersih: "", harga: "", pembeli: "",
    tarifAngkut: tarif.angkut, tarifPanen: tarif.panen, persenFee: tarif.fee,
    angkutManual: false, panenManual: false, ongkosAngkut: "", ongkosPanen: "", ...init });
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
    <label className="full">Pembeli (opsional)<input value={d.pembeli} onChange={(e) => set("pembeli", e.target.value)} /></label>
    {ongkos("ongkosAngkut", "angkutManual", `Ongkos angkut (${d.tarifAngkut}/kg kotor)`)}
    {ongkos("ongkosPanen", "panenManual", `Ongkos panen (${d.tarifPanen}/kg bersih)`)}
    <div className="prev"><span>Fee Acut ({d.persenFee}%)</span><span>{rp(c.fee)}</span>
      <b>Untung bersih</b><b className="ok">{rp(c.untung)}</b></div></div>
    <div className="btns"><button onClick={close}>Batal</button><button className="pri" onClick={save}>Simpan</button></div></Sheet>);
}

function Biaya({ uid }) {
  const items = useCol(uid, "biayaLain");
  const [q, setQ] = useState(""), [bln, setBln] = useState(""), [trash, setTrash] = useState(false);
  const [form, setForm] = useState(null), [view, setView] = useState(null);
  const ref = (id) => doc(db, "users", uid, "biayaLain", id);
  const list = useMemo(() => items.filter((x) => !!x.dihapus === trash && (!bln || x.tanggal.startsWith(bln))
    && (!q || x.keterangan.toLowerCase().includes(q.toLowerCase()))), [items, q, bln, trash]);
  const s = useSel(list);
  const total = s.rows.reduce((a, x) => a + N(x.nominal), 0);
  const del = (x) => confirm(`Yakin hapus biaya "${x.keterangan}"?`) && updateDoc(ref(x.id), { dihapus: true, terakhirDiedit: Date.now() });
  return (<>
    <button className="add" onClick={() => setForm({})}>+ Biaya Baru</button>
    <div className="bar"><input placeholder="Cari keterangan (mis. pupuk)" value={q} onChange={(e) => setQ(e.target.value)} />
      <input type="month" value={bln} onChange={(e) => setBln(e.target.value)} style={{ flex: "0 0 150px" }} /></div>
    <div className="chips"><button className={!trash ? "on" : ""} onClick={() => setTrash(false)}>Aktif</button>
      <button className={trash ? "on" : ""} onClick={() => setTrash(true)}>Sampah</button><button onClick={s.all}>Pilih semua</button></div>
    <div className="list two">
      {!list.length && <div className="empty">Belum ada biaya.</div>}
      {list.map((x) => (<div className="row" key={x.id}>
        <input type="checkbox" checked={s.sel.has(x.id)} onChange={() => s.toggle(x.id)} />
        <div onClick={() => setView(x)}><div className="r1"><span className="big">{x.tanggal}</span><span className="big">{rp(x.nominal)}</span></div>
          <div className="r2">{x.keterangan}</div></div>
        <Menu trash={trash} onView={() => setView(x)} onEdit={() => setForm(x)} onDel={() => del(x)} onRestore={() => updateDoc(ref(x.id), { dihapus: false })} />
      </div>))}</div>
    <div className="sum"><div><span>{s.n ? `${s.n} dipilih` : "Grand total"} ({s.rows.length} biaya)</span><span className="u">{rp(total)}</span></div></div>
    {form && <BForm init={form} uid={uid} close={() => setForm(null)} />}
    {view && <Sheet close={() => setView(null)}><h3>Biaya {view.tanggal}</h3><div className="dl">
      <span>Keterangan</span><span>{view.keterangan}</span><span className="big">Nominal</span><b>{rp(view.nominal)}</b></div>
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
  const [t, setT] = useState(tarif);
  const save = async () => { await setDoc(doc(db, "users", uid, "settings", "tarif"), { angkut: N(t.angkut), panen: N(t.panen), fee: N(t.fee) }); alert("Tarif disimpan. Berlaku untuk panen baru."); };
  const f = (k, l) => <label>{l}<input inputMode="decimal" value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>;
  return (<><h3>Tarif</h3><div className="f">
    {f("angkut", "Ongkos angkut (Rp/kg kotor)")}{f("panen", "Ongkos panen (Rp/kg bersih)")}{f("fee", "Fee Acut (%)")}</div>
    <p className="r2">Data panen lama tidak ikut berubah; tiap panen menyimpan tarifnya sendiri.</p>
    <div className="btns"><button className="pri" onClick={save}>Simpan tarif</button></div>
    <div className="btns"><button className="del" onClick={() => signOut(auth)}>Keluar (logout)</button></div></>);
}
