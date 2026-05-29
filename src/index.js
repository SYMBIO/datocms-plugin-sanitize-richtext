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
  // Log the full payload and available ctx methods so we can diagnose
  const payloadAttrs = payload?.data?.attributes ?? {};
  console.log('[sanitize-richtext] onBeforeItemUpsert fired', {
    savingClean,
    payloadDataType: payload?.data?.type,
    payloadAttributeKeys: Object.keys(payloadAttrs),
    hasSetFieldValue: typeof ctx.setFieldValue === 'function',
    hasSaveCurrentItem: typeof ctx.saveCurrentItem === 'function',
    hasNotice: typeof ctx.notice === 'function',
    hasAlert: typeof ctx.alert === 'function',
    hasFormValues: !!ctx.formValues,
  });
  // Log full payload for structure inspection (truncate large strings)
  console.log('[sanitize-richtext] payload attributes:', JSON.stringify(payloadAttrs, (k, v) => (typeof v === 'string' && v.length > 200 ? `${v.substring(0, 200)}…` : v), 2));

  if (savingClean) {
    console.log('[sanitize-richtext] savingClean=true, allowing save through');
    return true;
  }

  // IMPORTANT: check the PAYLOAD (what DatoCMS will actually send to the API),
  // not ctx.formValues. formValues may already be CLEAN because the render
  // addon called setFieldValue() — but DatoCMS saves using the payload that
  // was built when Save was clicked (from CKEditor's blur onChange = DIRTY).
  //
  // Recurse into nested objects AND arrays so we catch text inside blocks.
  const dirty = [];

  function checkPayloadValue(path, value) {
    if (typeof value === 'string') {
      const clean = sanitize(value);
      if (clean !== value) {
        dirty.push({ path, clean });
        console.warn('[sanitize-richtext] DIRTY field in payload:', path, {
          inputLen: value.length,
          outputLen: clean.length,
          firstDiff: (() => {
            for (let i = 0; i < Math.max(value.length, clean.length); i += 1) {
              if (value[i] !== clean[i]) {
                return `i=${i} in="${value.substring(i, i + 40)}" out="${clean.substring(i, i + 40)}"`;
              }
            }
            return 'no diff';
          })(),
        });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, idx) => checkPayloadValue(`${path}.${idx}`, item));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        checkPayloadValue(`${path}.${k}`, v);
      }
    }
  }

  for (const [key, value] of Object.entries(payloadAttrs)) {
    checkPayloadValue(key, value);
  }

  if (dirty.length === 0) {
    console.log('[sanitize-richtext] payload is clean, allowing save');
    return true;
  }

  console.warn('[sanitize-richtext] BLOCKING save — dirty fields in payload:', dirty.map((d) => d.path));

  // Best case: setFieldValue + saveCurrentItem available → auto-clean and re-save
  if (typeof ctx.setFieldValue === 'function' && typeof ctx.saveCurrentItem === 'function') {
    console.log('[sanitize-richtext] setFieldValue + saveCurrentItem available, applying...');
    for (const { path, clean } of dirty) {
      console.log('[sanitize-richtext] setFieldValue', path);
      // eslint-disable-next-line no-await-in-loop
      await ctx.setFieldValue(path, clean);
    }
    savingClean = true;
    try {
      console.log('[sanitize-richtext] saveCurrentItem...');
      await ctx.saveCurrentItem(true);
      console.log('[sanitize-richtext] saveCurrentItem ✓');
    } finally {
      savingClean = false;
    }
    return false; // block the original dirty save (clean version was just saved)
  }

  // setFieldValue/saveCurrentItem not available — block this save via return false.
  // The render addon is already calling setFieldValue(CLEAN) asynchronously;
  // by the time the user clicks Save again the content will be clean.
  // Use ctx.notice() (non-blocking toast) so the hook returns immediately
  // and DatoCMS doesn't show the "operation taking longer" timeout warning.
  console.warn('[sanitize-richtext] setFieldValue/saveCurrentItem not available, blocking with notice');
  if (typeof ctx.notice === 'function') {
    ctx.notice('Formátovanie bolo vyčistené. Uložte znova.'); // non-blocking toast
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
