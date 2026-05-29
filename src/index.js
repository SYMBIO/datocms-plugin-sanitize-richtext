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

// ctx.fieldPath can be 'body' (non-localized) or 'body.cs' (localized).
// ctx.formValues uses NESTED objects for localized fields:
//   { body: { cs: '...', en: '...' } }  — NOT { 'body.cs': '...' }
// So we must traverse the path segment by segment.
function getFormValue(formValues, fieldPath) {
  return fieldPath.split('.').reduce(
    (obj, key) => (obj != null ? obj[key] : undefined),
    formValues,
  );
}

function SanitizeAddon({ ctx }) {
  const [status, setStatus] = useState(null);
  const lastCleanRef = useRef(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const fieldValue = getFormValue(ctx.formValues, ctx.fieldPath);

  console.log('[sanitize-richtext] SanitizeAddon render', {
    fieldPath: ctx.fieldPath,
    valueLength: typeof fieldValue === 'string' ? fieldValue.length : typeof fieldValue,
    lastClean: lastCleanRef.current ? `${lastCleanRef.current.substring(0, 60)}…` : null,
    status,
  });

  useEffect(() => {
    if (typeof fieldValue !== 'string') {
      console.log('[sanitize-richtext] fieldValue is not a string, skipping', typeof fieldValue);
      return;
    }
    if (fieldValue === lastCleanRef.current) {
      console.log('[sanitize-richtext] value unchanged since last clean, skipping');
      return;
    }

    const clean = sanitize(fieldValue);
    console.log('[sanitize-richtext] sanitize result', {
      inputLength: fieldValue.length,
      outputLength: clean.length,
      changed: clean !== fieldValue,
    });

    if (clean !== fieldValue) {
      console.warn('[sanitize-richtext] DIRTY — calling setFieldValue');
      setStatus('sanitizing');
      lastCleanRef.current = clean;
      ctxRef.current.setFieldValue(ctxRef.current.fieldPath, clean)
        .then(() => {
          console.log('[sanitize-richtext] setFieldValue resolved ✓');
          setStatus('done');
          setTimeout(() => setStatus(null), 8000);
        })
        .catch((err) => {
          console.error('[sanitize-richtext] setFieldValue error', err);
          setStatus(null);
        });
    } else {
      lastCleanRef.current = fieldValue;
      setStatus(null);
    }
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

let reactRoot = null;

function renderExtension(id, ctx) {
  console.log('[sanitize-richtext] renderFieldExtension called', {
    id,
    fieldPath: ctx.fieldPath,
    fieldType: ctx.field && ctx.field.attributes && ctx.field.attributes.field_type,
    formValueKeys: Object.keys(ctx.formValues || {}),
    mode: ctx.mode,
  });

  ctx.startAutoResizer();

  if (!reactRoot) {
    let container = document.getElementById('root');
    if (!container) {
      console.warn('[sanitize-richtext] #root not found in DOM, creating dynamically');
      container = document.createElement('div');
      container.id = 'root';
      document.body.style.margin = '0';
      document.body.appendChild(container);
    }
    reactRoot = createRoot(container);
    console.log('[sanitize-richtext] React root created');
  }

  reactRoot.render(<SanitizeAddon ctx={ctx} />);
}

/* ─── Before-save sanitization ───────────────────────────────────────────── */

let savingClean = false;

async function beforeSave(payload, ctx) {
  console.log('[sanitize-richtext] onBeforeItemUpsert fired', {
    savingClean,
    payloadDataType: payload && payload.data && payload.data.type,
    payloadAttributeKeys: payload && payload.data && payload.data.attributes
      ? Object.keys(payload.data.attributes)
      : [],
    formValueKeys: ctx.formValues ? Object.keys(ctx.formValues) : [],
    hasSetFieldValue: typeof ctx.setFieldValue === 'function',
    hasSaveCurrentItem: typeof ctx.saveCurrentItem === 'function',
  });

  if (savingClean) {
    console.log('[sanitize-richtext] savingClean=true, allowing save through');
    return true;
  }

  // DatoCMS may only put CHANGED fields in payload.data.attributes.
  // We check ctx.formValues (all current field values) to catch everything.
  const valuesToCheck = ctx.formValues || {};
  const dirty = [];

  function checkValue(path, value) {
    if (typeof value === 'string') {
      const clean = sanitize(value);
      if (clean !== value) {
        dirty.push({ path, clean });
        console.warn('[sanitize-richtext] dirty field:', path, {
          inputLen: value.length,
          outputLen: clean.length,
          firstDiff: (() => {
            for (let i = 0; i < Math.max(value.length, clean.length); i += 1) {
              if (value[i] !== clean[i]) {
                return `index ${i}: input="${value.substring(i, i + 30)}" → output="${clean.substring(i, i + 30)}"`;
              }
            }
            return 'no diff found';
          })(),
        });
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // localized field: { en: '...', cs: '...' }
      for (const [locale, localeValue] of Object.entries(value)) {
        if (typeof localeValue === 'string') {
          checkValue(`${path}.${locale}`, localeValue);
        }
      }
    }
  }

  for (const [key, value] of Object.entries(valuesToCheck)) {
    checkValue(key, value);
  }

  if (dirty.length === 0) {
    console.log('[sanitize-richtext] all fields clean, allowing save');
    return true;
  }

  console.warn('[sanitize-richtext] blocking save to apply sanitization on:', dirty.map((d) => d.key));

  if (typeof ctx.setFieldValue !== 'function' || typeof ctx.saveCurrentItem !== 'function') {
    console.warn('[sanitize-richtext] setFieldValue/saveCurrentItem not available on ctx, using alert fallback');
    await ctx.alert('Obsah obsahuje formátovanie z Wordu / Outlooku, ktoré sa práve automaticky vyčistilo. Uložte znova.');
    return false;
  }

  for (const { key, clean } of dirty) {
    console.log('[sanitize-richtext] setFieldValue', key);
    // eslint-disable-next-line no-await-in-loop
    await ctx.setFieldValue(key, clean);
  }

  savingClean = true;
  try {
    console.log('[sanitize-richtext] calling saveCurrentItem...');
    await ctx.saveCurrentItem(true);
    console.log('[sanitize-richtext] saveCurrentItem done ✓');
  } finally {
    savingClean = false;
  }

  return false;
}

/* ─── Plugin entry point ─────────────────────────────────────────────────── */

console.log('[sanitize-richtext] loading plugin, calling connect()...');
console.log('[sanitize-richtext] is in iframe:', window.self !== window.top);
console.log('[sanitize-richtext] window.DatoCmsPlugin (old SDK):', typeof window.DatoCmsPlugin);

connect({
  overrideFieldExtensions(field, ctx) {
    // Apply to all multiple-paragraph text fields (HTML/WYSIWYG),
    // including text fields inside block models.
    // Only exclude: string (single-line), structured_text, rich_text, etc.
    if (field.attributes.field_type !== 'text') return undefined;

    const itemTypeId = field.relationships.item_type.data.id;
    const itemType = ctx.itemTypes[itemTypeId];

    console.log('[sanitize-richtext] overrideFieldExtensions', {
      apiKey: field.attributes.api_key,
      type: field.attributes.field_type,
      itemTypeApiKey: itemType && itemType.attributes.api_key,
      isBlock: itemType && itemType.attributes.modular_block,
    });

    return { addons: [{ id: 'sanitize-richtext' }] };
  },

  renderFieldExtension: renderExtension,

  onBeforeItemUpsert: beforeSave,
}).then(() => {
  console.log('[sanitize-richtext] connect() resolved');
}).catch((err) => {
  console.error('[sanitize-richtext] connect() rejected', err);
});
