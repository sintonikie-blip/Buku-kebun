import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, onSnapshot, addDoc, updateDoc, setDoc } from "firebase/firestore";
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
const TABS = [["pendapatan", "🌴", "Panen"], ["biaya", "🧾", "Biaya"], ["rekap", "📊", "Rekap"], ["set", "⚙️", "Atur"]];
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
    <header className="hd">Buku Kebun</header>
    <div className="wrap">
      {tab === "pendapatan" && <Pendapatan uid={user.uid} tarif={tarif} />}
      {tab === "biaya" && <Biaya uid={user.uid} />}
      {tab === "rekap" && <Rekap uid={user.uid} />}
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
  const [q, setQ] = useState(""), [bln, setBln] = useState(today().slice(0, 7)), [st, setSt] = useState("semua");
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
      <button onClick={() => setBln(bln ? "" : today().slice(0, 7))}>{bln ? "Semua bulan" : "Bulan ini"}</button><button onClick={s.all}>Pilih semua</button></div>
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
    {form && <PForm names={[...new Set(items.map((x) => x.pembeli).filter(Boolean))]} init={form} tarif={tarif} uid={uid} close={() => setForm(null)} />}
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

function PForm({ init, tarif, uid, close, names }) {
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
    <label className="full">Pembeli (opsional)<input list="pembeli-list" value={d.pembeli} onChange={(e) => set("pembeli", e.target.value)} /><datalist id="pembeli-list">{names.map((n) => <option key={n} value={n} />)}</datalist></label>
    {ongkos("ongkosAngkut", "angkutManual", `Ongkos angkut (${d.tarifAngkut}/kg kotor)`)}
    {ongkos("ongkosPanen", "panenManual", `Ongkos panen (${d.tarifPanen}/kg bersih)`)}
    <div className="prev"><span>Fee Acut ({d.persenFee}%)</span><span>{rp(c.fee)}</span>
      <b>Untung bersih</b><b className="ok">{rp(c.untung)}</b></div></div>
    <div className="btns"><button onClick={close}>Batal</button><button className="pri" onClick={save}>Simpan</button></div></Sheet>);
}

function Biaya({ uid }) {
  const items = useCol(uid, "biayaLain");
  const [q, setQ] = useState(""), [bln, setBln] = useState(today().slice(0, 7)), [trash, setTrash] = useState(false);
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
      <button className={trash ? "on" : ""} onClick={() => setTrash(true)}>Sampah</button><button onClick={() => setBln(bln ? "" : today().slice(0, 7))}>{bln ? "Semua bulan" : "Bulan ini"}</button><button onClick={s.all}>Pilih semua</button></div>
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
  const pend = useCol(uid, "pendapatan"), biaya = useCol(uid, "biayaLain");
  const [bl, setBl] = useState("");
  const pick = (a) => a.filter((x) => !x.dihapus && (!bl || x.tanggal.startsWith(bl))).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const sfx = bl || "semua";
  const expPend = () => saveFile(`pendapatan-${sfx}.csv`, csv([["Tanggal", "Tipe", "Berat kotor", "Berat bersih", "Harga", "Total", "Pembeli", "Ongkos angkut", "Ongkos panen", "Fee Acut", "Untung bersih", "Lunas", "Tanggal lunas"],
    ...pick(pend).map((x) => [x.tanggal, x.tipe, x.kotor, x.bersih, x.harga, x.total, x.pembeli, x.ongkosAngkut, x.ongkosPanen, x.fee, x.untung, x.lunas ? "Ya" : "Belum", x.tanggalLunas])]), "text/csv");
  const expBiaya = () => saveFile(`biaya-${sfx}.csv`, csv([["Tanggal", "Keterangan", "Nominal"], ...pick(biaya).map((x) => [x.tanggal, x.keterangan, x.nominal])]), "text/csv");
  const backup = () => saveFile(`cadangan-buku-kebun-${today()}.json`, JSON.stringify({ dibuat: today(), tarif, pendapatan: pend, biayaLain: biaya }, null, 1), "text/plain");
  const [t, setT] = useState(tarif);
  const save = async () => { await setDoc(doc(db, "users", uid, "settings", "tarif"), { angkut: N(t.angkut), panen: N(t.panen), fee: N(t.fee) }); alert("Tarif disimpan. Berlaku untuk panen baru."); };
  const f = (k, l) => <label>{l}<input inputMode="decimal" value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>;
  return (<><h3>Tarif</h3><div className="f">
    {f("angkut", "Ongkos angkut (Rp/kg kotor)")}{f("panen", "Ongkos panen (Rp/kg bersih)")}{f("fee", "Fee Acut (%)")}</div>
    <p className="r2">Data panen lama tidak ikut berubah; tiap panen menyimpan tarifnya sendiri.</p>
    <div className="btns"><button className="pri" onClick={save}>Simpan tarif</button></div>
    <h3>Data</h3><div className="card">
      <label className="r2">Bulan untuk ekspor CSV (kosongkan = semua data)</label>
      <input type="month" value={bl} onChange={(e) => setBl(e.target.value)} style={{ width: "100%", padding: 10, margin: "6px 0 10px", border: "1px solid var(--ln)", borderRadius: 8 }} />
      <div className="btns" style={{ marginTop: 0 }}><button onClick={expPend}>⬇️ Pendapatan</button><button onClick={expBiaya}>⬇️ Biaya</button></div>
      <p className="r2">File CSV bisa dibuka di Excel. Setelah ditekan, pilih Simpan ke File / Drive / WhatsApp.</p>
      <div className="btns" style={{ marginTop: 0 }}><button onClick={backup}>💾 Cadangan semua data</button></div></div>
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
  const row = (l, v, b) => <><span className={b ? "big" : ""}>{l}</span><span className={b ? "big" : ""}>{v}</span></>;
  return (<>
    <div className="mn"><button className="ic" onClick={() => setM(shift(m, -1))}>◀</button>
      <b>{lbl(m)}</b><button className="ic" onClick={() => setM(shift(m, 1))}>▶</button></div>
    <div className="card hero"><div className="r2">Laba akhir bulan</div>
      <div className={"hl " + (s.laba < 0 ? "neg" : "ok")}>{rp(s.laba)}</div>
      <div className="r2">{diff === null ? "Belum ada pembanding bulan lalu" :
        `${diff >= 0 ? "▲ naik" : "▼ turun"} ${Math.abs(diff).toFixed(0)}% dari ${lbl(shift(m, -1))} (${rp(prev.laba)})`}</div></div>
    <button className="wa" onClick={wa}>📤 Bagikan rekap ke WhatsApp</button>
    <div className="card"><h4>Panen</h4><div className="dl">
      {row("Jumlah panen", s.n + "x")}{row("Berat kotor", kg(s.kotor))}{row("Berat bersih", kg(s.bersih))}</div></div>
    <div className="card"><h4>Per tipe buah</h4><div className="dl">
      {["BB", "BK"].map((t) => <>{row(t === "BB" ? "Buah Besar (BB)" : "Buah Kecil (BK)", rp(s[t].total))}
        <span className="r2">{s[t].n}x · {kg(s[t].bersih)}</span><span className="r2">rata-rata {rp(s[t].avg)}/kg</span></>)}</div></div>
    <div className="card"><h4>Hitungan</h4><div className="dl">
      {row("Pendapatan", rp(s.total), 1)}{row("Ongkos angkut", "− " + rp(s.angkut))}{row("Ongkos panen", "− " + rp(s.panen))}
      {row("Fee Acut", "− " + rp(s.fee))}{row("Untung bersih panen", rp(s.untung), 1)}
      {row("Biaya lain", "− " + rp(s.biayaLain))}{row("Laba akhir bulan", rp(s.laba), 1)}</div></div>
    <div className="card"><h4>Status lunas</h4><div className="dl">
      {row("Sudah lunas", s.lunas + " panen")}{row("Belum lunas", s.belum + " panen")}{row("Untung belum lunas", rp(s.belumRp))}</div></div>
    <div className="card"><h4>Laba 6 bulan terakhir</h4>
      {series.map((x) => <div className="b" key={x.mm}><span>{BULAN[Number(x.mm.split("-")[1]) - 1].slice(0, 3)} {x.mm.slice(2, 4)}</span>
        <div className="track"><div className={"fill" + (x.laba < 0 ? " neg" : "")} style={{ width: (Math.abs(x.laba) / max) * 100 + "%" }} /></div>
        <span>{rp(x.laba)}</span></div>)}</div>
  </>);
}
