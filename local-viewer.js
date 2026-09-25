/* Local PDF viewer: uses the compressed PDF committed in this repository.
   It intentionally bypasses Google Drive preview, which fails for some files. */
(() => {
  'use strict';
  const PDF_URL = './menu-compressed.pdf';
  let bytes = null;

  const $ = (s) => document.querySelector(s);
  const show = (el, value) => { if (el) el.hidden = !value; };

  async function loadLocalPdf() {
    const status = $('#status');
    const text = $('#statusText');
    const pages = $('#pages');
    const fallback = $('#fallback');
    const searchbar = $('#searchbar');
    const dock = $('#dock');
    if (!pages || typeof pdfjsLib === 'undefined') return;

    try {
      if (text) text.textContent = 'جاري تحميل المنيو...';
      const response = await fetch(`${PDF_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      pages.innerHTML = '';
      show(fallback, false);
      show(searchbar, false);
      show(status, false);
      show(dock, false);

      for (let number = 1; number <= pdf.numPages; number += 1) {
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const width = Math.min(Math.max((document.querySelector('#viewer')?.clientWidth || 900) - 24, 280), 900);
        const scale = width / base.width;
        const viewport = page.getViewport({ scale: scale * Math.min(devicePixelRatio || 1, 2) });
        const box = document.createElement('div');
        box.className = 'page ready';
        box.style.width = `${width}px`;
        box.style.height = `${base.height * scale}px`;
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        box.appendChild(canvas);
        pages.appendChild(box);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
    } catch (error) {
      console.error('Local PDF error:', error);
      show(status, true);
      if (text) text.textContent = 'تعذر تحميل ملف المنيو المحلي. جرّب تحديث الصفحة.';
      const actions = $('#statusActions');
      if (actions) {
        actions.hidden = false;
        actions.innerHTML = `<a class="btn btn--gold" href="${PDF_URL}" download="menu-compressed.pdf">تحميل المنيو</a>`;
      }
    }
  }

  function bindLocalDownload() {
    const button = $('#dlBtn');
    if (!button) return;
    button.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = bytes ? URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })) : PDF_URL;
      a.download = 'menu-compressed.pdf';
      a.click();
      if (bytes) setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    });
  }

  window.addEventListener('load', () => {
    bindLocalDownload();
    loadLocalPdf();
  });
})();
