import { connect } from 'datocms-plugin-sdk';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { sanitize } from './sanitize';

/* ─── Status bar component ───────────────────────────────────────────────── */

const BAR_STYLES = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: '12px',
  padding: '8px 12px',
  borderRadius: '4px',
  margin: '4px 0',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  border: '1px solid transparent',
};

const THEMES = {
  sanitizing: { background: '#fff3cd', borderColor: '#ffc107', color: '#856404' },
  done: { background: '#e6f4ea', borderColor: '#a8d5b5', color: '#1e7e34' },
};

function StatusBar({ theme, icon, msg }) {
  return (
    <div style={{ ...BAR_STYLES, ...THEMES[theme] }}>
      <span>{icon}</span>
      <span>{msg}</span>
    </div>
  );
}

/* ─── Field addon React component ────────────────────────────────────────── */

function SanitizeAddon({ ctx }) {
  const [status, setStatus] = useState(null); // null | 'sanitizing' | 'done'
  const lastCleanRef = useRef(null);
  // keep a stable ref to ctx so async callbacks always see the latest version
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const fieldValue = ctx.formValues[ctx.fieldPath];

  useEffect(() => {
    if (typeof fieldValue !== 'string') return;
    if (fieldValue === lastCleanRef.current) return;

    const clean = sanitize(fieldValue);

    if (clean !== fieldValue) {
      setStatus('sanitizing');
      lastCleanRef.current = clean;
      ctxRef.current.setFieldValue(ctxRef.current.fieldPath, clean)
        .then(() => {
          setStatus('done');
          setTimeout(() => setStatus(null), 8000);
        })
        .catch(() => setStatus(null));
    } else {
      lastCleanRef.current = fieldValue;
      setStatus(null);
    }
  // fieldValue is the only reactive dep — ctx is accessed via the stable ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldValue]);

  if (status === 'sanitizing') {
    return <StatusBar theme="sanitizing" icon="⏳" msg="Čistenie formátovania..." />;
  }
  if (status === 'done') {
    return <StatusBar theme="done" icon="✓" msg="Formátovanie vyčistené — teraz môžete uložiť." />;
  }
  return null;
}

/* ─── Root management ────────────────────────────────────────────────────── */
// The SDK calls renderFieldExtension again on every ctx change.
// We create the React root once and re-render into it on each call.
let reactRoot = null;

function renderExtension(id, ctx) {
  ctx.startAutoResizer();
  if (!reactRoot) {
    reactRoot = createRoot(document.getElementById('root'));
  }
  reactRoot.render(<SanitizeAddon ctx={ctx} />);
}

/* ─── Before-save sanitization ───────────────────────────────────────────── */
// Safety net: if dirty content slips through to Save (e.g. user clicks Save
// faster than the render addon can react), onBeforeItemUpsert intercepts it,
// sanitizes all text fields, re-saves with clean content, and blocks the
// original dirty save.

let savingClean = false; // guard against recursive onBeforeItemUpsert calls

async function beforeSave(payload, ctx) {
  if (savingClean) return true;

  const attrs = (payload.data && payload.data.attributes) ? payload.data.attributes : {};
  const dirty = [];

  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'string') {
      const clean = sanitize(value);
      if (clean !== value) dirty.push({ key, clean });
    } else if (value && typeof value === 'object') {
      // localized field: { en: '...', cs: '...' }
      for (const [locale, localeValue] of Object.entries(value)) {
        if (typeof localeValue === 'string') {
          const clean = sanitize(localeValue);
          if (clean !== localeValue) dirty.push({ key: `${key}.${locale}`, clean });
        }
      }
    }
  }

  if (dirty.length === 0) return true;

  console.warn('[sanitize-richtext] onBeforeItemUpsert: dirty fields detected', dirty.map((d) => d.key));

  if (typeof ctx.setFieldValue !== 'function' || typeof ctx.saveCurrentItem !== 'function') {
    // Fallback: alert user and block this save — render addon will clean it
    await ctx.alert('Obsah obsahuje formátovanie z Wordu / Outlooku, ktoré sa práve automaticky vyčistilo. Uložte znova.');
    return false;
  }

  for (const { key, clean } of dirty) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.setFieldValue(key, clean);
  }

  savingClean = true;
  try {
    await ctx.saveCurrentItem(true);
  } finally {
    savingClean = false;
  }

  return false; // block the original dirty save (clean version was saved above)
}

/* ─── Plugin entry point ─────────────────────────────────────────────────── */

connect({
  overrideFieldExtensions(field) {
    if (field.attributes.field_type === 'text') {
      return { addons: [{ id: 'sanitize-richtext' }] };
    }
  },

  renderFieldExtension: renderExtension,

  onBeforeItemUpsert: beforeSave,
});
