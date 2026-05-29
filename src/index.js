const { sanitize } = require('./sanitize');

/* ─── Status bar UI ──────────────────────────────────────────────────────── */

const style = document.createElement('style');
style.textContent = `
  #sr-bar {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 4px;
    margin: 4px 0;
    display: none;
    align-items: center;
    gap: 8px;
    border: 1px solid transparent;
    transition: opacity 0.2s;
  }
  #sr-bar.clickable {
    cursor: pointer;
    user-select: none;
  }
  #sr-bar.clickable:hover {
    filter: brightness(0.95);
  }
  #sr-bar .sr-btn {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 3px;
    border: 1px solid currentColor;
    background: transparent;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    color: inherit;
  }
`;
document.head.appendChild(style);

const bar = document.createElement('div');
bar.id = 'sr-bar';
document.body.style.margin = '0';
document.body.appendChild(bar);

let hideTimer = null;

function showBar({
  icon, msg, bg, borderColor, color, button, autohide,
}) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  bar.style.display = 'flex';
  bar.style.background = bg;
  bar.style.borderColor = borderColor || bg;
  bar.style.color = color;
  bar.className = button ? 'clickable' : '';
  const btnHtml = button ? `<button class="sr-btn" type="button">${button}</button>` : '';
  bar.innerHTML = `<span>${icon}</span><span>${msg}</span>${btnHtml}`;
  if (autohide) hideTimer = setTimeout(() => { bar.style.display = 'none'; }, autohide);
}

/* ─── Plugin logic ───────────────────────────────────────────────────────── */

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  let lastSanitized = null;
  let sanitizeTimer = null;
  // clean value waiting to be applied on bar click
  let pendingClean = null;

  function applySanitized(sanitized) {
    console.log('[sanitize-richtext] applying sanitized value', { fieldPath: plugin.fieldPath });
    lastSanitized = sanitized;
    pendingClean = null;
    plugin.setFieldValue(plugin.fieldPath, sanitized);
  }

  // When the user clicks the status bar, their browser moves focus from
  // CKEditor to our plugin iframe. Browser event order guarantees that
  // CKEditor's blur (and its final onChange) fires BEFORE our click handler.
  // So by the time we call setFieldValue(CLEAN) here, we are writing AFTER
  // CKEditor's last dirty write — and we win the race against Save.
  bar.addEventListener('click', () => {
    if (!pendingClean) return;
    if (sanitizeTimer) { clearTimeout(sanitizeTimer); sanitizeTimer = null; }
    console.log('[sanitize-richtext] bar clicked — applying clean value immediately');
    applySanitized(pendingClean);
    showBar({
      icon: '✓',
      msg: 'Formátovanie vyčistené — teraz môžete uložiť.',
      bg: '#e6f4ea',
      borderColor: '#a8d5b5',
      color: '#1e7e34',
      autohide: 8000,
    });
  });

  function handleValue(value) {
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

      pendingClean = sanitized;

      // Show clickable warning bar.
      // Clicking it blurs CKEditor first (browser guarantees this), then
      // our click handler fires setFieldValue(CLEAN) — after CKEditor's last
      // dirty write — so CLEAN is what DatoCMS saves.
      showBar({
        icon: '⚠️',
        msg: 'Nájdené formátovanie z Wordu / Outlooku.',
        bg: '#fff3cd',
        borderColor: '#ffc107',
        color: '#856404',
        button: 'Vyčistiť a uložiť',
      });

      // Also keep the 800ms debounce as fallback for the case when the user
      // blurs the editor by clicking somewhere other than Save.
      if (sanitizeTimer) clearTimeout(sanitizeTimer);
      sanitizeTimer = setTimeout(() => {
        sanitizeTimer = null;
        if (!pendingClean) return; // already applied via bar click
        applySanitized(sanitized);
        showBar({
          icon: '✓',
          msg: 'Formátovanie vyčistené — teraz môžete uložiť.',
          bg: '#e6f4ea',
          borderColor: '#a8d5b5',
          color: '#1e7e34',
          autohide: 8000,
        });
      }, 800);
    } else {
      if (sanitizeTimer) { clearTimeout(sanitizeTimer); sanitizeTimer = null; }
      pendingClean = null;
      console.log('[sanitize-richtext] content is clean ✓');
      lastSanitized = value;
      bar.style.display = 'none';
    }
  }

  const initial = plugin.getFieldValue(plugin.fieldPath);
  console.log('[sanitize-richtext] init', { fieldPath: plugin.fieldPath });
  handleValue(initial);

  plugin.addFieldChangeListener(plugin.fieldPath, handleValue);
});
