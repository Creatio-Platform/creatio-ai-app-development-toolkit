// Visual-check helpers for a rendered Freedom UI page (see references/visual-check.md).
// Paste the whole file into the browser's JavaScript tool on an open Creatio tab. It defines
// __vcCensus, __vcOverflow, __vcRects, __vcOverlay and __vcOverlayOff on window, keeps full results in
// window.__visualCheck, and returns the list of installed helpers. It changes nothing on the page except
// the temporary overlay frame that __vcOverlay adds and __vcOverlayOff removes.
(() => {
  const store = window.__visualCheck = window.__visualCheck || {};
  // The shell is the same on both pages; the page body and any open dialog are what differ.
  const roots = () => {
    const s = document.querySelectorAll('crt-navigation-schema-outlet, .cdk-overlay-container');
    return s.length ? [...s] : [document];
  };
  const each = (root, fn) => {
    for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) each(el.shadowRoot, fn); fn(el); }
  };
  // Tool output is often cut after a few thousand characters: print one page, keep the rest.
  const page = (key, head, lines) => {
    store[key] = lines;
    const more = lines.length > 12 ? [`... ${lines.length - 12} more: __visualCheck.${key}.slice(12)`] : [];
    return [head, ...lines.slice(0, 12), ...more].join('\n');
  };
  const blank = v => !v || v === 'none' || v === 'normal' || v === 'transparent'
    || /^(0px ?)+$/.test(v) || /rgba\([^)]*,\s*0\)$/.test(v) || /\/\s*0\)$/.test(v);
  const sides = f => {
    const v = ['top', 'right', 'bottom', 'left'].map(f);
    return v.every(x => x === v[0]) ? v[0] : v.join(' ');
  };
  const PROPS = ['border', 'radius', 'shadow', 'background', 'padding', 'gap'];
  const styleOf = el => {
    const cs = getComputedStyle(el), g = p => cs.getPropertyValue(p);
    const border = sides(s => (g(`border-${s}-style`) === 'none' || g(`border-${s}-width`) === '0px')
      ? '-' : `${g(`border-${s}-width`)} ${g(`border-${s}-style`)} ${g(`border-${s}-color`)}`);
    const img = g('background-image');
    const out = {
      border: border === '-' ? '' : border,
      radius: g('border-radius'),
      shadow: g('box-shadow'),
      background: [g('background-color'), img === 'none' ? '' : img.slice(0, 60)].filter(x => !blank(x)).join(' + '),
      padding: sides(s => g(`padding-${s}`)),
      gap: g('row-gap') === g('column-gap') ? g('row-gap') : `${g('row-gap')} / ${g('column-gap')}`,
    };
    for (const p of PROPS) if (blank(out[p])) delete out[p];
    return out;
  };
  const shown = el => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  window.__vcCensus = (MODE, INNER = false) => {
    const rows = [];
    for (const root of roots()) each(root, el => {
      const name = el.getAttribute('element-name');
      if (!name || !shown(el)) return;
      const tag = el.tagName.toLowerCase();
      rows.push({ tag, name, style: styleOf(el) });
      if (INNER) for (const c of el.querySelectorAll('*')) {
        if (c.closest('[element-name]') !== el || !shown(c)) continue;
        const s = styleOf(c);
        if (Object.keys(s).length) rows.push({ tag: `${tag} > ${c.tagName.toLowerCase()}`, name, style: s });
      }
    });
    const sigs = {};
    for (const r of rows) for (const p of PROPS) if (r.style[p]) {
      const k = `${r.tag} | ${p}: ${r.style[p]}`;
      (sigs[k] = sigs[k] || []).push(r.name);
    }
    store[`census_${MODE}`] = sigs;
    const ref = store.census_reference;
    if (MODE === 'ours' && ref) {
      const extra = Object.keys(sigs).filter(k => !ref[k]).map(k => `+ ${k}   <- ${sigs[k].slice(0, 4).join(', ')}`);
      const lack = Object.keys(ref).filter(k => !sigs[k]).map(k => `- ${k}`);
      return page('census_diff', `ours vs reference: ${extra.length} only in ours (+), ${lack.length} only in the reference (-)`, [...extra, ...lack]);
    }
    const table = rows.filter(r => Object.keys(r.style).length)
      .map(r => `${r.tag} ${r.name} | ${PROPS.filter(p => r.style[p]).map(p => `${p}: ${r.style[p]}`).join(' | ')}`);
    return page(`census_${MODE}_lines`, `${MODE}: ${rows.length} named components, ${table.length} styled`, table);
  };

  window.__vcOverflow = (MODE, MIN = 8) => {
    const found = [];
    for (const root of roots()) each(root, el => {
      if (/^(svg|mat-icon|img)$/i.test(el.tagName)) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.clientWidth < 4 || el.clientHeight < 4) return;
      const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
      let kind = '';
      if (dx > 4 && cs.textOverflow === 'ellipsis') kind = 'text cut by ellipsis';
      else if (dx >= MIN && /hidden|clip/.test(cs.overflowX)) kind = 'clipped horizontally';
      else if (dx >= MIN && /auto|scroll/.test(cs.overflowX)) kind = 'scrolls horizontally';
      else if (dy >= MIN && /hidden|clip/.test(cs.overflowY)) kind = 'clipped vertically';
      if (!kind) return;
      const h = el.closest('[element-name]'), tag = el.tagName.toLowerCase();
      found.push({ key: `${kind} | ${h ? h.tagName.toLowerCase() : '-'} > ${tag}`,
        line: `${kind} | ${h ? h.getAttribute('element-name') : '-'} > ${tag} | shows ${el.clientWidth}x${el.clientHeight} of ${el.scrollWidth}x${el.scrollHeight} | "${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"` });
    });
    store[`overflow_${MODE}`] = found;
    const ref = MODE === 'ours' && store.overflow_reference;
    const keep = ref ? found.filter(f => f.key.startsWith('text cut') || !ref.some(r => r.key === f.key)) : found;
    return page(`overflow_${MODE}_lines`, `${MODE}: ${found.length} overflowing, ${keep.length} listed`
      + (ref ? ' (every ellipsis cut, other kinds only where the reference has none)' : ''), keep.map(f => f.line));
  };

  window.__vcRects = (SHOT_WIDTH = innerWidth) => {
    const k = SHOT_WIDTH / innerWidth, out = [];
    for (const root of roots()) for (const el of root.querySelectorAll('[element-name]')) {
      const cs = getComputedStyle(el), b = el.getBoundingClientRect();
      const card = !blank(cs.backgroundColor) || cs.borderTopStyle !== 'none'
        || /^crt-(expansion-panel|tab-panel-container)$/i.test(el.tagName);
      if (!card || b.width < 4 || b.height < 4 || b.bottom < 0 || b.top > innerHeight) continue;
      const r = [b.left, Math.max(b.top, 0), b.right, Math.min(b.bottom, innerHeight)].map(v => Math.round(v * k));
      out.push(`${el.getAttribute('element-name')} (${el.tagName.toLowerCase()}): [${r.join(', ')}]`);
    }
    return page('rects', `zoom regions in a ${SHOT_WIDTH}-wide screenshot frame (visible part only)`, out);
  };

  window.__vcOverlay = async (REF_URL, OURS_NAME, REF_NAME = OURS_NAME) => {
    document.getElementById('__vc_overlay')?.remove();
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const find = (doc, name) => doc.querySelector(`[element-name="${name}"]`);
    const ours = find(document, OURS_NAME);
    if (!ours) return `no element-name="${OURS_NAME}" on this page`;
    ours.scrollIntoView({ block: 'center' });
    const f = Object.assign(document.createElement('iframe'), { id: '__vc_overlay', src: REF_URL });
    Object.assign(f.style, { position: 'fixed', left: '0', top: '0', width: `${innerWidth}px`, height: `${innerHeight}px`,
      border: '0', mixBlendMode: 'difference', pointerEvents: 'none', zIndex: '2147483647' });
    document.body.appendChild(f);
    let theirs = null;
    for (let i = 0; i < 60 && !theirs; i++) {
      await sleep(500);
      try { theirs = find(f.contentDocument, REF_NAME); } catch (e) { f.remove(); return `frame refused: ${e.message}`; }
    }
    if (!theirs) { f.remove(); return `no element-name="${REF_NAME}" in the reference after 30 s`; }
    await sleep(1500);
    theirs.scrollIntoView({ block: 'center' });
    await sleep(500);
    const a = ours.getBoundingClientRect(), b = theirs.getBoundingClientRect();
    f.style.left = `${Math.round(a.left - b.left)}px`;
    f.style.top = `${Math.round(a.top - b.top)}px`;
    const box = r => `${Math.round(r.width)}x${Math.round(r.height)}`;
    return `overlay on: ours ${box(a)} at ${Math.round(a.left)},${Math.round(a.top)} (CSS px), reference ${box(b)}; `
      + 'zoom on that box, then remove it: __vcOverlayOff()';
  };
  window.__vcOverlayOff = () => { document.getElementById('__vc_overlay')?.remove(); return 'overlay removed'; };

  return 'installed: __vcCensus, __vcOverflow, __vcRects, __vcOverlay, __vcOverlayOff';
})();
