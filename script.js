/* =========================================================
   007 Restaurant & Café — Digital Menu
   - عرض المنيو (PDF) باستخدام PDF.js
   - بحث داخل المنيو مع تظليل النتائج
   - لوحة أدمن مرتبطة بـ Google Apps Script
   ========================================================= */
'use strict';

const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyhkM0waTpgWBu4dM5nt2Xj-GH0FkDPu1ra6EB-iZuWxfhKr74F2l2a2GjeGlKUORb3/exec',
  PDFJS_WORKER: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  MAX_PAGE_WIDTH: 900,
  MAX_UPLOAD_MB: 8,
  MAX_ZOOM: 2.5,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = {
  info: null, bytes: null, pdf: null, pages: [], observer: null, zoom: 1,
  index: [], indexPromise: null, noText: false, matches: [], cur: -1,
  token: sessionStorage.getItem('m007_token') || '', user: sessionStorage.getItem('m007_user') || '',
};
let toastTimer;
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-bad', bad); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
function fmtSize(bytes) { if (!bytes) return '-'; return bytes > 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : Math.round(bytes / 1024) + ' KB'; }
function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function fileToB64(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(r.error); r.readAsDataURL(file); }); }

const idb = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('menu007', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
};

async function apiGet(action) { const r = await fetch(`${CONFIG.API_URL}?action=${encodeURIComponent(action)}&_=${Date.now()}`, { method: 'GET', redirect: 'follow' }); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'API error'); return j; }
async function apiPost(action, data = {}) { const r = await fetch(CONFIG.API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...data }) }); return r.json(); }

function showStatus(text, { error = false, actions = [] } = {}) {
  const s = $('#status'); s.hidden = false; s.classList.toggle('is-error', error); $('#statusText').textContent = text;
  const box = $('#statusActions'); box.innerHTML = ''; box.hidden = !actions.length;
  actions.forEach((a) => { const el = document.createElement(a.href ? 'a' : 'button'); el.className = 'btn ' + (a.ghost ? 'btn--ghost' : 'btn--gold'); el.textContent = a.label; if (a.href) { el.href = a.href; el.target = '_blank'; el.rel = 'noopener'; } else { el.type = 'button'; el.addEventListener('click', a.onClick); } box.appendChild(el); });
}

function cleanupViewer() { if (state.observer) state.observer.disconnect(); state.pages.forEach(releasePage); state.pages = []; state.pdf = null; state.index = []; state.indexPromise = null; state.noText = false; clearHighlights(); $('#pages').innerHTML = ''; $('#fallback').hidden = true; $('#fallback').src = 'about:blank'; $('#dock').hidden = true; $('#searchbar').hidden = false; }

async function loadMenu() {
  cleanupViewer(); showStatus('جاري تحضير المنيو...');
  if (typeof pdfjsLib === 'undefined') return showStatus('تعذر تحميل مكتبة عرض الـPDF. اتأكد من الإنترنت وجرّب تاني.', { error: true, actions: [{ label: 'إعادة المحاولة', onClick: loadMenu }] });
  pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.PDFJS_WORKER;
  let info = null; let bytes = null;
  try {
    info = await apiGet('info'); const cached = await idb.get('menu').catch(() => null);
    if (cached && cached.version === info.version && cached.bytes) bytes = cached.bytes;
    else { const res = await apiGet('pdf'); bytes = b64ToBytes(res.data); idb.set('menu', { version: info.version, bytes }).catch(() => {}); }
  } catch (err) {
    console.warn('Menu load error:', err); const cached = await idb.get('menu').catch(() => null);
    if (cached && cached.bytes) { bytes = cached.bytes; info = info || { name: 'menu-007.pdf', version: cached.version }; }
    else if (info && info.fileId) return showFallback(info);
    else return showStatus('مقدرناش نحمّل المنيو دلوقتي. اتأكد من الإنترنت وجرّب تاني.', { error: true, actions: [{ label: 'إعادة المحاولة', onClick: loadMenu }] });
  }
  state.info = info; state.bytes = bytes;
  try { await openPdf(bytes); } catch (err) { console.error('PDF render error:', err); if (info && info.fileId) showFallback(info); else showStatus('الملف مش بيفتح. جرّب تاني.', { error: true, actions: [{ label: 'إعادة المحاولة', onClick: loadMenu }] }); }
}

/* لا نعرض Google Drive داخل iframe؛ المعاينة تفشل مع الملفات الكبيرة وتظهر شاشة سوداء مضللة. */
function showFallback(info) {
  $('#fallback').hidden = true; $('#fallback').src = 'about:blank'; $('#searchbar').hidden = true; $('#dock').hidden = true;
  const viewUrl = `https://drive.google.com/file/d/${encodeURIComponent(info.fileId)}/view`;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(info.fileId)}`;
  showStatus('الملف كبير على المعاينة داخل الموقع. استخدم التحميل لفتحه على جهازك.', { error: true, actions: [
    { label: 'فتح الملف في Google Drive', href: viewUrl, ghost: true },
    { label: 'تحميل ملف الـPDF', href: downloadUrl },
    { label: 'إعادة المحاولة', onClick: loadMenu },
  ] });
}

async function openPdf(bytes) { state.pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise; await buildPages(); $('#status').hidden = true; $('#dock').hidden = false; updatePageIndicator(); state.indexPromise = buildIndex(); }
async function buildPages() { const wrap = $('#pages'); wrap.innerHTML = ''; state.pages = []; state.observer = new IntersectionObserver(onIntersect, { rootMargin: '900px 0px' }); for (let n = 1; n <= state.pdf.numPages; n++) { const page = await state.pdf.getPage(n); const vp = page.getViewport({ scale: 1 }); const el = document.createElement('div'); el.className = 'page'; el.dataset.n = n; const hl = document.createElement('div'); hl.className = 'hl-layer'; el.appendChild(hl); wrap.appendChild(el); const p = { n, el, hl, baseW: vp.width, baseH: vp.height, scale: 1, gen: 0, rendered: false, busy: false, want: false, task: null }; el._p = p; state.pages.push(p); } layout(); }
function pageCssWidth() { const avail = Math.min($('#viewer').clientWidth - 24, CONFIG.MAX_PAGE_WIDTH); return Math.max(280, avail) * state.zoom; }
function layout() { const w = pageCssWidth(); state.pages.forEach((p) => { p.scale = w / p.baseW; p.el.style.width = w + 'px'; p.el.style.height = p.baseH * p.scale + 'px'; releasePage(p); state.observer.unobserve(p.el); state.observer.observe(p.el); }); }
function onIntersect(entries) { entries.forEach((e) => { const p = e.target._p; if (!p) return; if (e.isIntersecting) { p.want = true; renderPage(p); } else releasePage(p); }); }
async function renderPage(p) { if (p.rendered || p.busy) return; p.busy = true; const my = ++p.gen; try { const page = await state.pdf.getPage(p.n); if (my !== p.gen) return; const dpr = Math.min(window.devicePixelRatio || 1, 2); let s = p.scale * dpr; const px = p.baseW * s * (p.baseH * s); if (px > 12e6) s *= Math.sqrt(12e6 / px); const vp = page.getViewport({ scale: s }); const canvas = document.createElement('canvas'); canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height); p.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }); await p.task.promise; if (my !== p.gen) return; const old = p.el.querySelector('canvas'); if (old) old.remove(); p.el.prepend(canvas); p.el.classList.add('ready'); p.rendered = true; } catch (err) { if (!err || err.name !== 'RenderingCancelledException') console.warn('render', p.n, err); } finally { p.busy = false; p.task = null; if (p.want && !p.rendered) renderPage(p); } }
function releasePage(p) { p.want = false; p.gen++; if (p.task) { try { p.task.cancel(); } catch (_) {} } const c = p.el.querySelector('canvas'); if (c) { c.width = 0; c.height = 0; c.remove(); } p.rendered = false; p.el.classList.remove('ready'); }
function setZoom(z) { z = Math.min(CONFIG.MAX_ZOOM, Math.max(1, Math.round(z * 100) / 100)); if (z === state.zoom) return; const doc = document.documentElement; const ratio = window.scrollY / Math.max(1, doc.scrollHeight - window.innerHeight); state.zoom = z; layout(); window.scrollTo({ top: ratio * (doc.scrollHeight - window.innerHeight), behavior: 'instant' }); }
function updatePageIndicator() { if (!state.pages.length) return; const mid = window.innerHeight / 2; let cur = 1; for (const p of state.pages) { if (p.el.getBoundingClientRect().top <= mid) cur = p.n; else break; } $('#pageInd').textContent = `${cur} / ${state.pages.length}`; }
function normalize(s) { return String(s || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ی/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ک/g, 'ك').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).toLowerCase().replace(/\s+/g, ' ').trim(); }
async function buildIndex() { const pdf = state.pdf; const index = new Array(pdf.numPages); let total = 0; for (let n = 1; n <= pdf.numPages; n++) { if (state.pdf !== pdf) return; const page = await pdf.getPage(n); const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent(); const items = []; for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const t = pdfjsLib.Util.transform(vp.transform, it.transform); const h = Math.hypot(t[2], t[3]) || 10; items.push({ n: normalize(it.str), x: t[4], y: t[5] - h * .92, w: it.width || 0, h: h * 1.2, rtl: it.dir === 'rtl' }); } total += items.length; index[n - 1] = { w: vp.width, h: vp.height, items }; } state.index = index; state.noText = total === 0; }
function collectMatches(terms) { const out = []; state.index.forEach((pg, pi) => { if (!pg) return; for (const it of pg.items) { if (!it.n) continue; for (const t of terms) { let from = 0, i; while ((i = it.n.indexOf(t, from)) > -1) { const len = it.n.length; const f0 = i / len, f1 = (i + t.length) / len; const left = it.rtl ? it.x + it.w * (1 - f1) : it.x + it.w * f0; out.push({ page: pi, left: ((left - 2) / pg.w) * 100, top: (it.y / pg.h) * 100, width: ((it.w * (f1 - f0) + 4) / pg.w) * 100, height: ((it.h) / pg.h) * 100 }); from = i + t.length; if (out.length > 300) return out; } } } }); return out; }
function clearHighlights() { $$('.hl').forEach((e) => e.remove()); state.matches = []; state.cur = -1; }
async function runSearch(raw) { clearHighlights(); const msg = $('#searchMsg'); msg.hidden = true; $('#hits').hidden = true; const q = normalize(raw); if (q.length < 2) return; if (state.indexPromise) await state.indexPromise; if (state.noText) { msg.textContent = 'ملف المنيو عبارة عن صور فقط، فالبحث بالكلمات مش متاح. اتصفح الصفحات بالإيد.'; msg.hidden = false; return; } if (normalize($('#q').value) !== q) return; let found = collectMatches([q]); let approx = false; if (!found.length) { const tokens = q.split(' ').filter((t) => t.length >= 2); if (tokens.length > 1) { found = collectMatches(tokens); approx = found.length > 0; } } if (!found.length) { msg.textContent = 'مفيش نتائج للكلمة دي. جرّب كلمة تانية أو اكتبها بشكل مختلف.'; msg.hidden = false; return; } found.forEach((m) => { const el = document.createElement('div'); el.className = 'hl'; el.style.cssText = `left:${m.left}%;top:${m.top}%;width:${m.width}%;height:${m.height}%`; state.pages[m.page].hl.appendChild(el); m.el = el; }); state.matches = found; if (approx) { msg.textContent = 'مفيش نتيجة مطابقة تماماً — دي نتائج للكلمات كل واحدة لوحدها.'; msg.hidden = false; } $('#hits').hidden = false; goTo(0); }
function goTo(i) { const m = state.matches; if (!m.length) return; state.cur = (i + m.length) % m.length; m.forEach((x, k) => x.el.classList.toggle('active', k === state.cur)); m[state.cur].el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); $('#hitCount').textContent = `${state.cur + 1} / ${m.length}`; }
function bindSearch() { const q = $('#q'); let timer; q.addEventListener('input', () => { $('#qClear').hidden = !q.value; clearTimeout(timer); timer = setTimeout(() => runSearch(q.value), 280); }); q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (state.matches.length) goTo(state.cur + 1); else runSearch(q.value); q.blur(); } }); $('#qClear').addEventListener('click', () => { q.value = ''; $('#qClear').hidden = true; clearHighlights(); $('#hits').hidden = true; $('#searchMsg').hidden = true; q.focus(); }); $('#hitNext').addEventListener('click', () => goTo(state.cur + 1)); $('#hitPrev').addEventListener('click', () => goTo(state.cur - 1)); }

function openModal(id) { const m = $('#' + id); m.hidden = false; document.body.classList.add('lock'); if (id === 'loginModal') setTimeout(() => $('#lgUser').focus(), 50); }
function closeModals() { $$('.modal').forEach((m) => (m.hidden = true)); document.body.classList.remove('lock'); }
function setSession(token, user) { state.token = token || ''; state.user = user || ''; if (token) { sessionStorage.setItem('m007_token', token); sessionStorage.setItem('m007_user', user || ''); } else { sessionStorage.removeItem('m007_token'); sessionStorage.removeItem('m007_user'); } $('#adminDot').hidden = !token; }
function panelMsg(text, ok = true) { const n = $('#panelMsg'); if (!text) { n.hidden = true; return; } n.textContent = text; n.className = 'note ' + (ok ? 'is-ok' : 'is-bad'); n.hidden = false; }
function fillPanel() { const i = state.info || {}; $('#panelUser').textContent = state.user; $('#curName').textContent = i.name || '-'; $('#curDate').textContent = i.updated ? new Date(i.updated).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '-'; $('#curSize').textContent = fmtSize(i.size || (state.bytes && state.bytes.length)); panelMsg(''); }
function openPanel() { fillPanel(); openModal('panelModal'); }
function handleAuthError(r) { if (r && r.code === 'AUTH') { setSession('', ''); closeModals(); toast('انتهت الجلسة، سجّل دخول تاني', true); openModal('loginModal'); return true; } return false; }
function bindAdmin() {
  $('#adminBtn').addEventListener('click', () => (state.token ? openPanel() : openModal('loginModal'))); document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModals(); }); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
  $('#pwToggle').addEventListener('click', () => { const inp = $('#lgPass'); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; $('#pwToggle').textContent = show ? 'إخفاء' : 'إظهار'; });
  $('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); const err = $('#loginErr'); const btn = $('#loginBtn'); err.hidden = true; btn.disabled = true; btn.textContent = 'جاري التحقق...'; try { const r = await apiPost('login', { username: $('#lgUser').value.trim(), password: $('#lgPass').value }); if (r.ok) { setSession(r.token, r.username); $('#lgPass').value = ''; closeModals(); openPanel(); toast('تم تسجيل الدخول'); } else { err.textContent = r.error || 'بيانات الدخول غير صحيحة'; err.hidden = false; } } catch (ex) { console.error(ex); err.textContent = 'السيرفر مش بيرد. اتأكد من الإنترنت ومن نشر السكريبت.'; err.hidden = false; } finally { btn.disabled = false; btn.textContent = 'دخول'; } });
  $('#upFile').addEventListener('change', () => { const f = $('#upFile').files[0]; const drop = $('.drop'); if (!f) { $('#upName').textContent = 'اختار ملف PDF من الموبايل أو الكمبيوتر'; drop.classList.remove('has-file'); $('#upBtn').disabled = true; return; } if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { panelMsg('الملف لازم يكون PDF', false); $('#upFile').value = ''; return; } if (f.size > CONFIG.MAX_UPLOAD_MB * 1048576) { panelMsg(`حجم الملف ${fmtSize(f.size)} — الحد الأقصى ${CONFIG.MAX_UPLOAD_MB}MB. صغّر الملف الأول.`, false); $('#upFile').value = ''; return; } panelMsg(''); $('#upName').textContent = `${f.name} (${fmtSize(f.size)})`; drop.classList.add('has-file'); $('#upBtn').disabled = false; });
  $('#upBtn').addEventListener('click', async () => { const f = $('#upFile').files[0]; if (!f) return; const btn = $('#upBtn'); btn.disabled = true; btn.textContent = 'جاري الرفع... متقفلش الصفحة'; panelMsg(''); try { const data = await fileToB64(f); const r = await apiPost('upload', { token: state.token, name: f.name, data }); if (handleAuthError(r)) return; if (!r.ok) throw new Error(r.error || 'فشل الرفع'); state.info = r; fillPanel(); panelMsg('تم رفع المنيو الجديد ونشره', true); $('#upFile').value = ''; $('#upName').textContent = 'اختار ملف PDF من الموبايل أو الكمبيوتر'; $('.drop').classList.remove('has-file'); loadMenu(); } catch (ex) { console.error(ex); panelMsg(ex.message || 'حصلت مشكلة أثناء الرفع', false); btn.disabled = false; } finally { btn.textContent = 'رفع ونشر المنيو'; if (!$('#upFile').files[0]) btn.disabled = true; else btn.disabled = false; } });
  $('#lnkBtn').addEventListener('click', async () => { const link = $('#lnkInput').value.trim(); if (!link) return panelMsg('الصق لينك الملف الأول', false); const btn = $('#lnkBtn'); btn.disabled = true; panelMsg(''); try { const r = await apiPost('setLink', { token: state.token, link }); if (handleAuthError(r)) return; if (!r.ok) throw new Error(r.error || 'اللينك ده مش شغال'); state.info = r; fillPanel(); $('#lnkInput').value = ''; panelMsg('تم تغيير المنيو', true); loadMenu(); } catch (ex) { panelMsg(ex.message || 'حصلت مشكلة', false); } finally { btn.disabled = false; } });
  $('#logoutBtn').addEventListener('click', async () => { const t = state.token; setSession('', ''); closeModals(); toast('تم تسجيل الخروج'); try { await apiPost('logout', { token: t }); } catch (_) {} });
}
async function verifySession() { if (!state.token) return; $('#adminDot').hidden = false; try { const r = await apiPost('verify', { token: state.token }); if (!r.ok) setSession('', ''); } catch (_) {} }
function downloadPdf() { if (state.bytes) { let name = (state.info && state.info.name) || 'menu-007.pdf'; if (!/\.pdf$/i.test(name)) name += '.pdf'; const url = URL.createObjectURL(new Blob([state.bytes], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); } else if (state.info && state.info.fileId) window.open(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(state.info.fileId)}`, '_blank', 'noopener'); else toast('المنيو لسه بيتحمّل', true); }
function bindGeneral() { $('#dlBtn').addEventListener('click', downloadPdf); $('#zoomIn').addEventListener('click', () => setZoom(state.zoom + .25)); $('#zoomOut').addEventListener('click', () => setZoom(state.zoom - .25)); $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' })); let ticking = false; window.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { updatePageIndicator(); ticking = false; }); }, { passive: true }); let lastW = window.innerWidth, rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (window.innerWidth !== lastW && state.pages.length) { lastW = window.innerWidth; layout(); } }, 200); }); }
(function init() { bindGeneral(); bindSearch(); bindAdmin(); $('#adminDot').hidden = !state.token; verifySession(); loadMenu(); })();
