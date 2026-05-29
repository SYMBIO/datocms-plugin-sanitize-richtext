import { connect } from 'datocms-plugin-sdk';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { sanitize } from './sanitize';

/* ─── Cross-iframe coordination keys ────────────────────────────────────── */

// BroadcastChannel used to signal between background iframe (beforeSave)
// and field-extension render iframes (SanitizeAddon).
const BC_NAME = 'sanitize-richtext-v1';

// sessionStorage keys (shared by all same-origin iframes in this tab).
const SK_AUTOSAVE = 'srt-autosave-needed'; // set by beforeSave to request auto-save
const SK_CLEAN    = 'srt-clean-save';      // set by render addon before saveCurrentItem

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
  saving: { background: '#cfe2ff', borderColor: '#9ec5fe', color: '#084298' },
};

function StatusBar({ theme, icon, msg }) {
  return (
    <div style={{ ...BAR_STYLES, ...THEMES[theme] }}>
      <span>{icon}</span>
      <span>{msg}</span>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

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

function ssGet(key) {
  try { return sessionStorage.getItem(key); } catch (e) { return null; }
}
function ssSet(key, val) {
  try { sessionStorage.setItem(key, val); } catch (e) { /* */ }
}
function ssRemove(key) {
  try { sessionStorage.removeItem(key); } catch (e) { /* */ }
}

function bcPost(msg) {
  try {
    const bc = new BroadcastChannel(BC_NAME);
    bc.postMessage(msg);
    bc.close();
  } catch (e) { /* BroadcastChannel not supported */ }
}

/* ─── Field addon React component ────────────────────────────────────────── */

function SanitizeAddon({ ctx }) {
  const [status, setStatus] = useState(null);
  const lastCleanRef = useRef(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // Set to true when beforeSave signals that save was blocked and we should
  // trigger a new save automatically once the content is clean.
  const autoSaveRef = useRef(false);
  // Debounce timer for auto-save (lets other render iframes finish cleaning first).
  const autoSaveTimerRef = useRef(null);

  const fieldValue = getFormValue(ctx.formValues, ctx.fieldPath);

  console.log('[sanitize-richtext] SanitizeAddon render', {
    fieldPath: ctx.fieldPath,
    valueLength: typeof fieldValue === 'string' ? fieldValue.length : typeof fieldValue,
    hasSaveCurrentItem: typeof ctx.saveCurrentItem === 'function',
    autoSave: autoSaveRef.current,
    status,
  });

  // Trigger a debounced auto-save once everything is clean.
  // Uses a mutex (sessionStorage) so only ONE render iframe actually calls
  // saveCurrentItem even if multiple iframes finish cleaning around the same time.
  function scheduleAutoSave() {
    if (!autoSaveRef.current) return;
    if (typeof ctxRef.current.saveCurrentItem !== 'function') {
      console.warn('[sanitize-richtext] saveCurrentItem not available, cannot auto-save');
      return;
    }
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      // Try to claim the auto-save slot (first iframe wins).
      if (ssGet(SK_AUTOSAVE) !== '1') return; // already claimed by another iframe
      ssRemove(SK_AUTOSAVE);
      autoSaveRef.current = false;

      setStatus('saving');
      ssSet(SK_CLEAN, '1');
      console.log('[sanitize-richtext] auto-save triggered...');
      ctxRef.current.saveCurrentItem().then(() => {
        console.log('[sanitize-richtext] auto-save ✓');
        setStatus(null);
      }).catch((err) => {
        console.error('[sanitize-richtext] auto-save error', err);
        setStatus(null);
      }).finally(() => {
        ssRemove(SK_CLEAN);
      });
    }, 400); // 400 ms lets other render iframes finish their setFieldValue calls
  }

  // Listen for "save was blocked" broadcasts from beforeSave.
  // Also check sessionStorage on mount in case the message was sent before this
  // component was ready.
  useEffect(() => {
    if (ssGet(SK_AUTOSAVE) === '1') {
      console.log('[sanitize-richtext] found pending auto-save on mount');
      autoSaveRef.current = true;
      // If value is already clean, schedule immediately
      if (typeof fieldValue === 'string' && sanitize(fieldValue) === fieldValue) {
        scheduleAutoSave();
      }
    }

    let bc;
    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = ({ data }) => {
        if (data.type === 'save-blocked') {
          console.log('[sanitize-richtext] received save-blocked broadcast');
          autoSaveRef.current = true;
          // If current value is already clean, schedule auto-save now.
          const cur = getFormValue(ctxRef.current.formValues, ctxRef.current.fieldPath);
          if (typeof cur === 'string' && sanitize(cur) === cur) {
            scheduleAutoSave();
          }
          // Otherwise scheduleAutoSave will be called after setFieldValue resolves.
        }
      };
    } catch (e) { /* BroadcastChannel not supported */ }

    return () => {
      clearTimeout(autoSaveTimerRef.current);
      try { if (bc) bc.close(); } catch (e) { /* */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof fieldValue !== 'string') {
      console.log('[sanitize-richtext] fieldValue is not a string, skipping', typeof fieldValue);
      return;
    }
    if (fieldValue === lastCleanRef.current) {
      console.log('[sanitize-richtext] value unchanged since last clean, skipping');
      // Value is already clean; if auto-save is pending, trigger it.
      scheduleAutoSave();
      return;
    }

    const clean = sanitize(fieldValue);

    // Detailed diff log so we can diagnose idempotency issues after save/reload.
    if (clean !== fieldValue) {
      let firstDiff = 'no diff';
      for (let i = 0; i < Math.max(fieldValue.length, clean.length); i += 1) {
        if (fieldValue[i] !== clean[i]) {
          firstDiff = `index ${i} | input: "${fieldValue.substring(i, i + 80)}" | output: "${clean.substring(i, i + 80)}"`;
          break;
        }
      }
      console.warn('[sanitize-richtext] SANITIZE DIFF', {
        inputLength: fieldValue.length,
        outputLength: clean.length,
        firstDiff,
        fullInput: fieldValue,
        fullOutput: clean,
      });
    } else {
      console.log('[sanitize-richtext] sanitize — no change', { length: fieldValue.length });
    }

    if (clean !== fieldValue) {
      console.warn('[sanitize-richtext] DIRTY — calling setFieldValue');
      setStatus('sanitizing');
      lastCleanRef.current = clean;
      ctxRef.current.setFieldValue(ctxRef.current.fieldPath, clean)
        .then(() => {
          console.log('[sanitize-richtext] setFieldValue resolved ✓');
          setStatus('done');
          setTimeout(() => setStatus(null), 5000);
          scheduleAutoSave(); // trigger auto-save if beforeSave requested it
        })
        .catch((err) => {
          console.error('[sanitize-richtext] setFieldValue error', err);
          setStatus(null);
        });
    } else {
      lastCleanRef.current = fieldValue;
      setStatus(null);
      scheduleAutoSave();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldValue]);

  if (status === 'sanitizing') {
    return <StatusBar theme="sanitizing" icon="⏳" msg="Čistenie formátovania..." />;
  }
  if (status === 'saving') {
    return <StatusBar theme="saving" icon="💾" msg="Ukladám vyčistený obsah..." />;
  }
  if (status === 'done') {
    return <StatusBar theme="done" icon="✓" msg="Formátovanie vyčistené." />;
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
    hasSaveCurrentItem: typeof ctx.saveCurrentItem === 'function',
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

// Module-level flag for same-iframe auto-save re-entry guard.
let savingClean = false;

async function beforeSave(payload, ctx) {
  const payloadAttrs = payload?.data?.attributes ?? {};

  // Allow if this is our own clean re-save (signalled via sessionStorage or module flag)
  if (savingClean || ssGet(SK_CLEAN) === '1') {
    console.log('[sanitize-richtext] clean re-save pass-through, allowing');
    return true;
  }

  console.log('[sanitize-richtext] onBeforeItemUpsert fired', {
    payloadDataType: payload?.data?.type,
    payloadAttributeKeys: Object.keys(payloadAttrs),
    hasSetFieldValue: typeof ctx.setFieldValue === 'function',
    hasSaveCurrentItem: typeof ctx.saveCurrentItem === 'function',
    hasNotice: typeof ctx.notice === 'function',
  });

  // Check for dirty HTML in every string value inside the payload,
  // recursing into arrays (modular blocks) and nested objects.
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

  console.warn('[sanitize-richtext] BLOCKING save — dirty fields:', dirty.map((d) => d.path));

  // Best-case: setFieldValue + saveCurrentItem available in this context
  // (only happens when the SDK gives a full ctx, which may depend on DatoCMS version).
  if (typeof ctx.setFieldValue === 'function' && typeof ctx.saveCurrentItem === 'function') {
    console.log('[sanitize-richtext] full ctx available — cleaning and re-saving...');
    for (const { path, clean } of dirty) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.setFieldValue(path, clean);
    }
    savingClean = true;
    ssSet(SK_CLEAN, '1');
    try {
      await ctx.saveCurrentItem(true);
      console.log('[sanitize-richtext] re-save ✓');
    } finally {
      savingClean = false;
      ssRemove(SK_CLEAN);
    }
    return false; // block the original dirty save; the clean one was just triggered
  }

  // setFieldValue not available in this hook context (typical for DatoCMS render iframes).
  // Signal the render addon instances via sessionStorage + BroadcastChannel so they
  // will call saveCurrentItem() once their setFieldValue(clean) has resolved.
  ssSet(SK_AUTOSAVE, '1');
  bcPost({ type: 'save-blocked' });

  if (typeof ctx.notice === 'function') {
    ctx.notice('Formátovanie sa čistí, uloží sa automaticky...');
  }

  console.log('[sanitize-richtext] returning false — render addons will auto-save once clean');
  return false;
}

/* ─── Plugin entry point ─────────────────────────────────────────────────── */

console.log('[sanitize-richtext] loading plugin, calling connect()...');

connect({
  // Registering onBoot forces DatoCMS to create a background iframe.
  // Without it, render iframes get a limited ctx (no saveCurrentItem).
  // With it, DatoCMS uses callMethodMergingBootCtx which merges the full
  // boot ctx into every render iframe → saveCurrentItem becomes available.
  onBoot(ctx) {
    console.log('[sanitize-richtext] onBoot', {
      hasSaveCurrentItem: typeof ctx.saveCurrentItem === 'function',
      hasSetFieldValue: typeof ctx.setFieldValue === 'function',
      hasNotice: typeof ctx.notice === 'function',
    });
  },

  overrideFieldExtensions(field, ctx) {
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
