/* Contact links + admin editor. The editor requires a valid Apps Script login. */
(() => {
  'use strict';
  const API_URL = 'https://script.google.com/macros/s/AKfycbyhkM0waTpgWBu4dM5nt2Xj-GH0FkDPu1ra6EB-iZuWxfhKr74F2l2a2GjeGlKUORb3/exec';
  const KEY = 'menu007_contacts';
  const defaults = { instagram: 'https://instagram.com/', facebook: 'https://facebook.com/', whatsapp: 'https://wa.me/' };
  let contacts = { ...defaults };
  let token = sessionStorage.getItem('m007_token') || '';
  let user = sessionStorage.getItem('m007_user') || '';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  const validUrl = (v) => /^(https?:\/\/|tel:)/i.test(String(v || '').trim());
  const post = (action, data = {}) => fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...data }) }).then((r) => r.json());

  function render() {
    let strip = $('#contactStrip');
    if (!strip) { strip = document.createElement('section'); strip.id = 'contactStrip'; strip.className = 'contact-strip'; $('.hero')?.insertAdjacentElement('beforebegin', strip); }
    strip.innerHTML = `<div class="contact-strip__title">تواصل معانا</div>
      <a class="contact-link contact-link--instagram" href="${esc(contacts.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><span class="contact-link__icon">◎</span><span>Instagram</span></a>
      <a class="contact-link contact-link--facebook" href="${esc(contacts.facebook)}" target="_blank" rel="noopener" aria-label="Facebook"><span class="contact-link__icon">f</span><span>Facebook</span></a>
      <a class="contact-link contact-link--whatsapp" href="${esc(contacts.whatsapp)}" target="_blank" rel="noopener" aria-label="WhatsApp"><span class="contact-link__icon">◔</span><span>WhatsApp</span></a>`;
  }

  async function loadContacts() {
    try { const r = await fetch(`${API_URL}?action=getContacts&_=${Date.now()}`); const data = await r.json(); if (data.ok && data.contacts) contacts = { ...contacts, ...data.contacts }; } catch (_) {}
    try { contacts = { ...contacts, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) {}
    render();
  }

  function closeEditor() { $('#contactAdmin')?.remove(); }
  function openEditor() {
    if (!token) return openLogin();
    closeEditor();
    const box = document.createElement('section'); box.id = 'contactAdmin'; box.className = 'contact-admin';
    box.innerHTML = `<h3>تعديل روابط التواصل</h3><p style="margin:0 0 8px;color:#666;font-size:12px">المستخدم: ${esc(user)}</p><label>Instagram<input id="contactInstagram" value="${esc(contacts.instagram)}"></label><label>Facebook<input id="contactFacebook" value="${esc(contacts.facebook)}"></label><label>WhatsApp<input id="contactWhatsapp" value="${esc(contacts.whatsapp)}"></label><div class="contact-admin__actions"><button class="contact-admin__save" id="saveContacts">حفظ البيانات</button><button class="contact-admin__close" id="closeContacts">إغلاق</button></div>`;
    $('.hero')?.insertAdjacentElement('afterend', box);
    $('#closeContacts').onclick = closeEditor;
    $('#saveContacts').onclick = async () => {
      const next = { instagram: $('#contactInstagram').value.trim(), facebook: $('#contactFacebook').value.trim(), whatsapp: $('#contactWhatsapp').value.trim() };
      if (!Object.values(next).every(validUrl)) return alert('اكتب روابط صحيحة تبدأ بـ https://');
      try { const r = await post('saveContacts', { token, contacts: next }); if (!r.ok) throw new Error(r.error || 'فشل الحفظ'); contacts = next; localStorage.setItem(KEY, JSON.stringify(contacts)); render(); closeEditor(); alert('تم حفظ روابط التواصل'); } catch (e) { alert(e.message || 'تعذر حفظ الروابط'); }
    };
  }

  function openLogin() {
    closeEditor();
    const old = $('#contactLogin'); if (old) { old.hidden = false; $('#contactUser')?.focus(); return; }
    const box = document.createElement('section'); box.id = 'contactLogin'; box.className = 'contact-admin';
    box.innerHTML = `<h3>دخول الإدارة</h3><label>اسم المستخدم<input id="contactUser" autocomplete="username"></label><label>كلمة المرور<input id="contactPass" type="password" autocomplete="current-password"></label><p id="contactError" style="color:#a5111e" hidden></p><div class="contact-admin__actions"><button class="contact-admin__save" id="contactLoginBtn">دخول</button><button class="contact-admin__close" id="contactCloseBtn">إغلاق</button></div>`;
    $('.hero')?.insertAdjacentElement('afterend', box);
    $('#contactCloseBtn').onclick = () => box.remove();
    $('#contactLoginBtn').onclick = async () => { const btn = $('#contactLoginBtn'); btn.disabled = true; try { const r = await post('login', { username: $('#contactUser').value.trim(), password: $('#contactPass').value }); if (!r.ok) throw new Error(r.error || 'بيانات الدخول غير صحيحة'); token = r.token; user = r.username || $('#contactUser').value.trim(); sessionStorage.setItem('m007_token', token); sessionStorage.setItem('m007_user', user); box.remove(); openEditor(); } catch (e) { const error = $('#contactError'); error.textContent = e.message; error.hidden = false; } finally { btn.disabled = false; } };
  }

  window.addEventListener('load', () => { loadContacts(); $('#adminBtn')?.addEventListener('click', openEditor); });
})();
