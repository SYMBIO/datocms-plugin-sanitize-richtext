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
  let sanitizeTimer = null;

  function applySanitized(sanitized) {
    console.log('[sanitize-richtext] applying sanitized value', { fieldPath: plugin.fieldPath, sanitized });
    lastSanitized = sanitized;
    plugin.setFieldValue(plugin.fieldPath, sanitized);
  }

  /**
   * Single entry point for both the initial load value and every subsequent
   * field change. Both go through the same 800 ms debounce so that our
   * setFieldValue always fires AFTER CKEditor's debounced onChange has
   * settled. This ensures our clean value is the LAST write before Save —
   * regardless of whether the dirty content came from a paste or was already
   * stored in the record.
   */
  function handleValue(value) {
    // Ignore echoes of values we already applied.
    if (value === lastSanitized) return;

    const sanitized = sanitize(value);

    if (sanitized !== value) {
      console.warn('[sanitize-richtext] dirty content detected');
      console.group('[sanitize-richtext] value diff');
      console.log('INPUT :', value);
      console.log('OUTPUT:', sanitized);
      for (let i = 0; i < Math.max(value.length, sanitized.length); i += 1) {
        if (value[i] !== sanitized[i]) {
          console.log('First diff at index', i,
            '| input:', JSON.stringify(value.substring(i, i + 40)),
            '| output:', JSON.stringify(sanitized.substring(i, i + 40)));
          break;
        }
      }
      console.groupEnd();

      showBar('⏳', 'Čistenie formátovania... pred uložením počkajte na ✓', '#fff3cd', '#856404', null);

      // Debounce: reset on every incoming event. setFieldValue fires only
      // once CKEditor has been quiet for 800 ms, so our write wins.
      if (sanitizeTimer) clearTimeout(sanitizeTimer);
      sanitizeTimer = setTimeout(() => {
        sanitizeTimer = null;
        applySanitized(sanitized);
        showBar('✓', 'Formátovanie vyčistené — teraz môžete uložiť.', '#e6f4ea', '#1e7e34', null);
      }, 800);
    } else {
      if (sanitizeTimer) clearTimeout(sanitizeTimer);
      console.log('[sanitize-richtext] content is clean ✓');
      lastSanitized = value;
      bar.style.display = 'none';
    }
  }

  // Process the initial value through the same debounce as changes.
  // This avoids the 2-save problem caused by an immediate setFieldValue on
  // load being overwritten by CKEditor's own initialisation onChange echo.
  const initial = plugin.getFieldValue(plugin.fieldPath);
  console.log('[sanitize-richtext] init', { fieldPath: plugin.fieldPath });
  handleValue(initial);

  plugin.addFieldChangeListener(plugin.fieldPath, handleValue);
});
