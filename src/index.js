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
  if (autohide) {
    hideTimer = setTimeout(() => { bar.style.display = 'none'; }, autohide);
  }
}

/* ─── Plugin logic ───────────────────────────────────────────────────────── */

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  let lastSanitized = null;

  // Tracks the raw dirty value we already processed. CKEditor often fires its
  // debounced onChange again with the pre-sanitized content after we call
  // setFieldValue — this guard makes sure we process each unique dirty string
  // only once, breaking the save → dirty → save infinite loop.
  let lastDirtySeen = null;

  function applySanitized(sanitized) {
    console.log('[sanitize-richtext] applying sanitized value', { fieldPath: plugin.fieldPath, sanitized });
    lastSanitized = sanitized;
    plugin.setFieldValue(plugin.fieldPath, sanitized);
    showBar(
      '✓',
      'Formátovanie z Wordu/Outlooku bolo odstránené. Obsah bude uložený v čistej podobe.',
      '#e6f4ea',
      '#1e7e34',
      6000,
    );
  }

  // Sanitize existing value on load (marks the form dirty — editor must save).
  const initial = plugin.getFieldValue(plugin.fieldPath);
  const initialSanitized = sanitize(initial);
  if (initialSanitized !== initial) {
    console.warn('[sanitize-richtext] dirty content detected on load, sanitizing', { fieldPath: plugin.fieldPath });
    lastDirtySeen = initial;
    applySanitized(initialSanitized);
  } else {
    console.log('[sanitize-richtext] content is clean on load ✓', { fieldPath: plugin.fieldPath });
    lastSanitized = initial;
  }

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    // Echo from our own setFieldValue — ignore.
    if (newValue === lastSanitized) return;

    // CKEditor re-firing the exact dirty string we already sanitized.
    // Without this guard setFieldValue → CKEditor echo → setFieldValue → ∞.
    if (newValue === lastDirtySeen) {
      console.log('[sanitize-richtext] ignoring CKEditor echo of already-sanitized dirty content');
      return;
    }

    console.log('[sanitize-richtext] field changed, checking for dirty content');
    const sanitized = sanitize(newValue);

    if (sanitized !== newValue) {
      console.warn('[sanitize-richtext] dirty content detected, sanitizing');
      lastDirtySeen = newValue;
      applySanitized(sanitized);
    } else {
      console.log('[sanitize-richtext] content is clean ✓');
      lastSanitized = newValue;
      // Reset so the same dirty content can be caught again if user types
      // clean text in between and then pastes the same dirty content again.
      lastDirtySeen = null;
      bar.style.display = 'none';
    }
  });
});
