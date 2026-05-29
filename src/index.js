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
  let retryTimer = null;

  /**
   * Write the sanitized value to the field and schedule one re-check after
   * 600 ms. CKEditor can fire its own debounced onChange *after* we call
   * setFieldValue and overwrite our clean value with the original dirty
   * content. The re-check catches that overwrite and corrects it.
   *
   * NOTE: Because field_addon plugins run in a separate iframe, setFieldValue
   * updates the DatoCMS store (= what gets saved) but does NOT force CKEditor
   * to re-render its visual display. The editor will visually show clean
   * content only after the page is refreshed. The status bar below lets
   * editors know the cleanup already happened.
   */
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

    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const current = plugin.getFieldValue(plugin.fieldPath);
      if (current === lastSanitized) {
        console.log('[sanitize-richtext] retry check: value is stable ✓');
        return;
      }
      console.warn('[sanitize-richtext] retry check: CKEditor overwrote the sanitized value, re-applying');
      const reSanitized = sanitize(current);
      if (reSanitized !== current) {
        applySanitized(reSanitized);
      } else {
        lastSanitized = current;
      }
    }, 600);
  }

  // Sanitize existing value on load (marks the form dirty — editor must save).
  const initial = plugin.getFieldValue(plugin.fieldPath);
  const initialSanitized = sanitize(initial);
  if (initialSanitized !== initial) {
    console.warn('[sanitize-richtext] dirty content detected on load, sanitizing', { fieldPath: plugin.fieldPath });
    applySanitized(initialSanitized);
  } else {
    console.log('[sanitize-richtext] content is clean on load ✓', { fieldPath: plugin.fieldPath });
    lastSanitized = initial;
  }

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    // Ignore our own setFieldValue echoes.
    if (newValue === lastSanitized) return;

    console.log('[sanitize-richtext] field changed, checking for dirty content');
    const sanitized = sanitize(newValue);
    if (sanitized !== newValue) {
      console.warn('[sanitize-richtext] dirty content detected, sanitizing');
      applySanitized(sanitized);
    } else {
      console.log('[sanitize-richtext] content is clean ✓');
      lastSanitized = newValue;
      bar.style.display = 'none';
    }
  });
});
