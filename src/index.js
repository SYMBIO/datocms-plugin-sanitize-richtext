const { sanitize } = require('./sanitize');

/* ─── Status bar UI ──────────────────────────────────────────────────────── */

const bar = document.createElement('div');
bar.style.cssText = [
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  'font-size:12px',
  'padding:6px 10px',
  'border-radius:4px',
  'margin:4px 0',
  'display:none',
  'align-items:center',
  'gap:6px',
].join(';');
document.body.style.margin = '0';
document.body.appendChild(bar);

let hideTimer = null;

function showBar(icon, msg, bg, color, autohide) {
  if (hideTimer) clearTimeout(hideTimer);
  bar.style.display = 'flex';
  bar.style.background = bg;
  bar.style.color = color;
  bar.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  if (autohide) hideTimer = setTimeout(() => { bar.style.display = 'none'; }, autohide);
}

/* ─── Plugin logic ───────────────────────────────────────────────────────── */

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  let lastSanitized = null;

  // Debounce timer for setFieldValue. We wait for CKEditor to finish all its
  // debounced onChange events and then write the clean value LAST, so our
  // write wins over CKEditor's dirty echo when the user clicks Save.
  let sanitizeTimer = null;

  function applySanitized(sanitized) {
    console.log('[sanitize-richtext] applying sanitized value', { fieldPath: plugin.fieldPath, sanitized });
    lastSanitized = sanitized;
    plugin.setFieldValue(plugin.fieldPath, sanitized);
  }

  // On load CKEditor is not yet in "active edit" mode, so setFieldValue is
  // accepted immediately — no debounce needed here.
  const initial = plugin.getFieldValue(plugin.fieldPath);
  const initialSanitized = sanitize(initial);
  if (initialSanitized !== initial) {
    console.warn('[sanitize-richtext] dirty content on load, sanitizing immediately', { fieldPath: plugin.fieldPath });
    applySanitized(initialSanitized);
    showBar('✓', 'Formátovanie bolo vyčistené — uložte záznam.', '#e6f4ea', '#1e7e34', null);
  } else {
    console.log('[sanitize-richtext] content is clean on load ✓', { fieldPath: plugin.fieldPath });
    lastSanitized = initial;
  }

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    // Echo from our own setFieldValue — ignore.
    if (newValue === lastSanitized) return;

    console.log('[sanitize-richtext] field changed, checking for dirty content');
    const sanitized = sanitize(newValue);

    if (sanitized !== newValue) {
      // Show feedback immediately so the editor knows cleanup is pending.
      console.warn('[sanitize-richtext] dirty content detected, will sanitize after CKEditor settles');
      showBar('⏳', 'Čistenie formátovania z Wordu/Outlooku...', '#fff3cd', '#856404', null);

      // Debounce: reset the timer on every incoming dirty event.
      // setFieldValue fires only after CKEditor has been quiet for 800 ms,
      // ensuring our clean value is the LAST write to the store before Save.
      if (sanitizeTimer) clearTimeout(sanitizeTimer);
      sanitizeTimer = setTimeout(() => {
        sanitizeTimer = null;
        console.log('[sanitize-richtext] CKEditor settled, applying sanitized value');
        applySanitized(sanitized);
        showBar('✓', 'Formátovanie bolo vyčistené — uložte záznam.', '#e6f4ea', '#1e7e34', null);
      }, 800);
    } else {
      if (sanitizeTimer) clearTimeout(sanitizeTimer);
      console.log('[sanitize-richtext] content is clean ✓');
      lastSanitized = newValue;
      bar.style.display = 'none';
    }
  });
});
