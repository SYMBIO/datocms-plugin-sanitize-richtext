import { connect } from 'datocms-plugin-sdk';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import { sanitize } from './sanitize';
import { isWysiwygTextField, collectDirtyWysiwyg, collectItemTypeIds } from './fields';

/* ─── Cross-iframe coordination keys ────────────────────────────────────── */

// BroadcastChannel used to signal between background iframe (beforeSave)
// and field-extension render iframes (SanitizeAddon).
const BC_NAME = 'sanitize-richtext-v1';

// sessionStorage keys (shared by all same-origin iframes in this tab).
const SK_AUTOSAVE = 'srt-autosave-needed'; // set by beforeSave to request auto-save
const SK_CLEAN    = 'srt-clean-save';      // set by render addon before saveCurrentItem

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
  const lastCleanRef = useRef(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // Set to true when beforeSave signals that save was blocked and we should
  // trigger a new save automatically once the content is clean.
  const autoSaveRef = useRef(false);
  // Debounce timer for auto-save (lets other render iframes finish cleaning first).
  const autoSaveTimerRef = useRef(null);

  const fieldValue = getFormValue(ctx.formValues, ctx.fieldPath);

  // Trigger a debounced auto-save once everything is clean.
  // Uses a mutex (sessionStorage) so only ONE render iframe actually calls
  // saveCurrentItem even if multiple iframes finish cleaning around the same time.
  function scheduleAutoSave() {
    if (!autoSaveRef.current) return;
    if (typeof ctxRef.current.saveCurrentItem !== 'function') return;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      // Try to claim the auto-save slot (first iframe wins).
      if (ssGet(SK_AUTOSAVE) !== '1') return; // already claimed by another iframe
      ssRemove(SK_AUTOSAVE);
      autoSaveRef.current = false;

      ssSet(SK_CLEAN, '1');
      ctxRef.current.saveCurrentItem().catch(() => {}).finally(() => {
        ssRemove(SK_CLEAN);
      });
    }, 400); // 400 ms lets other render iframes finish their setFieldValue calls
  }

  // Listen for "save was blocked" broadcasts from beforeSave.
  // Also check sessionStorage on mount in case the message was sent before this
  // component was ready.
  useEffect(() => {
    if (ssGet(SK_AUTOSAVE) === '1') {
      autoSaveRef.current = true;
      if (typeof fieldValue === 'string' && sanitize(fieldValue) === fieldValue) {
        scheduleAutoSave();
      }
    }

    let bc;
    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = ({ data }) => {
        if (data.type === 'save-blocked') {
          autoSaveRef.current = true;
          const cur = getFormValue(ctxRef.current.formValues, ctxRef.current.fieldPath);
          if (typeof cur === 'string' && sanitize(cur) === cur) {
            scheduleAutoSave();
          }
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
    if (typeof fieldValue !== 'string') return;
    if (fieldValue === lastCleanRef.current) {
      scheduleAutoSave();
      return;
    }

    const clean = sanitize(fieldValue);

    if (clean !== fieldValue) {
      lastCleanRef.current = clean;
      ctxRef.current.setFieldValue(ctxRef.current.fieldPath, clean)
        .then(() => { scheduleAutoSave(); })
        .catch(() => {});
    } else {
      lastCleanRef.current = fieldValue;
      scheduleAutoSave();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldValue]);

  return null;
}

/* ─── Root management ────────────────────────────────────────────────────── */

let reactRoot = null;

function renderExtension(id, ctx) {
  ctx.startAutoResizer();

  if (!reactRoot) {
    let container = document.getElementById('root');
    if (!container) {
      container = document.createElement('div');
      container.id = 'root';
      document.body.style.margin = '0';
      document.body.appendChild(container);
    }
    reactRoot = createRoot(container);
  }

  reactRoot.render(<SanitizeAddon ctx={ctx} />);
}

/* ─── Before-save sanitization ───────────────────────────────────────────── */

// Module-level flag for same-iframe auto-save re-entry guard.
let savingClean = false;

async function beforeSave(payload, ctx) {
  const payloadAttrs = payload?.data?.attributes ?? {};

  // Allow if this is our own clean re-save
  if (savingClean || ssGet(SK_CLEAN) === '1') {
    return true;
  }

  // Only inspect WYSIWYG text fields. Textarea / markdown HTML must stay intact.
  const itemTypeId = payload?.data?.relationships?.item_type?.data?.id;
  if (!itemTypeId) return true;

  const formValues = (ctx.formValues && typeof ctx.formValues === 'object')
    ? ctx.formValues
    : payloadAttrs;

  // ctx.fields only contains fields already loaded by the app. Load the field
  // definitions of the record's model and of every block model present in the
  // values, otherwise unknown fields would be silently skipped.
  const fieldsById = { ...ctx.fields };
  if (typeof ctx.loadItemTypeFields === 'function') {
    const loadedItemTypeIds = new Set(
      Object.values(fieldsById)
        .filter((f) => f?.relationships?.item_type?.data?.id)
        .map((f) => f.relationships.item_type.data.id),
    );
    const neededItemTypeIds = new Set(
      collectItemTypeIds(formValues, [itemTypeId]),
    );
    for (const id of neededItemTypeIds) {
      if (!loadedItemTypeIds.has(id)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const loaded = await ctx.loadItemTypeFields(id);
          loaded.forEach((f) => { fieldsById[f.id] = f; });
        } catch (e) { /* keep whatever we already have */ }
      }
    }
  }

  const dirty = collectDirtyWysiwyg(formValues, itemTypeId, fieldsById, sanitize);

  if (dirty.length === 0) return true;

  // Best-case: setFieldValue + saveCurrentItem available in this context.
  if (typeof ctx.setFieldValue === 'function' && typeof ctx.saveCurrentItem === 'function') {
    for (const { path, clean } of dirty) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.setFieldValue(path, clean);
    }
    savingClean = true;
    ssSet(SK_CLEAN, '1');
    try {
      await ctx.saveCurrentItem(true);
    } finally {
      savingClean = false;
      ssRemove(SK_CLEAN);
    }
    return false;
  }

  // setFieldValue not available in this hook context — signal render addons
  // via sessionStorage + BroadcastChannel to auto-save once cleaning is done.
  ssSet(SK_AUTOSAVE, '1');
  bcPost({ type: 'save-blocked' });

  if (typeof ctx.notice === 'function') {
    ctx.notice('Formátování se čistí, uloží se automaticky...');
  }

  return false;
}

/* ─── Plugin entry point ─────────────────────────────────────────────────── */

connect({
  // Registering onBoot forces DatoCMS to create a background iframe.
  // Without it, render iframes get a limited ctx (no saveCurrentItem).
  // With it, DatoCMS uses callMethodMergingBootCtx which merges the full
  // boot ctx into every render iframe → saveCurrentItem becomes available.
  onBoot() {},

  overrideFieldExtensions(field, ctx) {
    // Only HTML/WYSIWYG editors. Textarea and markdown keep raw markup.
    if (!isWysiwygTextField(field)) return undefined;
    const itemTypeId = field.relationships.item_type.data.id;
    const itemType = ctx.itemTypes[itemTypeId];
    if (!itemType) return undefined;
    return { addons: [{ id: 'sanitize-richtext' }] };
  },

  renderFieldExtension: renderExtension,

  onBeforeItemUpsert: beforeSave,
});
