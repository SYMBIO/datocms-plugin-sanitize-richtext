/* eslint-disable no-use-before-define */
/**
 * Field metadata helpers. Sanitization must only run on multiple-paragraph
 * text fields that use the DatoCMS HTML/WYSIWYG editor — never textarea or
 * markdown, where editors paste raw HTML on purpose.
 */

function isWysiwygTextField(field) {
  return Boolean(
    field
    && field.attributes
    && field.attributes.field_type === 'text'
    && field.attributes.appearance
    && field.attributes.appearance.editor === 'wysiwyg',
  );
}

function findField(fields, itemTypeId, apiKey) {
  if (!fields || !itemTypeId || !apiKey) return undefined;
  const list = Array.isArray(fields) ? fields : Object.values(fields);
  return list.find((field) => (
    field
    && field.attributes
    && field.attributes.api_key === apiKey
    && field.relationships
    && field.relationships.item_type
    && field.relationships.item_type.data
    && field.relationships.item_type.data.id === itemTypeId
  ));
}

const BLOCK_META_KEYS = {
  itemId: true,
  itemTypeId: true,
  type: true,
  id: true,
  key: true,
  blockModelId: true,
  children: true,
  relationships: true,
  meta: true,
  attributes: true,
};

function collectDirtyStrings(path, value, sanitizeFn, dirty) {
  if (typeof value === 'string') {
    if (!/<[a-zA-Z]/.test(value)) return;
    const clean = sanitizeFn(value);
    if (clean !== value) dirty.push({ path, clean });
    return;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value).forEach(([locale, nested]) => {
      collectDirtyStrings(`${path}.${locale}`, nested, sanitizeFn, dirty);
    });
  }
}

function walkItem(values, itemTypeId, pathPrefix, fields, sanitizeFn, dirty) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;

  Object.entries(values).forEach(([key, value]) => {
    if (BLOCK_META_KEYS[key]) return;

    const field = findField(fields, itemTypeId, key);
    if (!field) return;

    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    const fieldType = field.attributes.field_type;

    if (isWysiwygTextField(field)) {
      collectDirtyStrings(path, value, sanitizeFn, dirty);
      return;
    }

    if (fieldType === 'rich_text') {
      walkModularOrLocalized(path, value, fields, sanitizeFn, dirty);
      return;
    }

    if (fieldType === 'single_block') {
      walkSingleBlock(path, value, fields, sanitizeFn, dirty);
      return;
    }

    if (fieldType === 'structured_text') {
      walkStructured(path, value, fields, sanitizeFn, dirty);
    }
  });
}

function walkModularOrLocalized(path, value, fields, sanitizeFn, dirty) {
  if (Array.isArray(value)) {
    value.forEach((block, idx) => {
      walkBlock(`${path}.${idx}`, block, fields, sanitizeFn, dirty);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      walkModularOrLocalized(`${path}.${key}`, nested, fields, sanitizeFn, dirty);
    });
  }
}

function walkSingleBlock(path, value, fields, sanitizeFn, dirty) {
  if (!value || typeof value !== 'object') return;

  if (value.itemTypeId || value.blockModelId || value.relationships) {
    walkBlock(path, value, fields, sanitizeFn, dirty);
    return;
  }

  Object.entries(value).forEach(([key, nested]) => {
    walkSingleBlock(`${path}.${key}`, nested, fields, sanitizeFn, dirty);
  });
}

function walkBlock(path, block, fields, sanitizeFn, dirty) {
  if (!block || typeof block !== 'object') return;

  const itemTypeId = block.itemTypeId
    || block.blockModelId
    || (
      block.relationships
      && block.relationships.item_type
      && block.relationships.item_type.data
      && block.relationships.item_type.data.id
    );

  if (!itemTypeId) return;

  const attrs = (block.attributes && block.relationships)
    ? block.attributes
    : block;

  walkItem(attrs, itemTypeId, path, fields, sanitizeFn, dirty);
}

function walkStructured(path, value, fields, sanitizeFn, dirty) {
  if (Array.isArray(value)) {
    value.forEach((node, idx) => {
      walkSlateNode(`${path}.${idx}`, node, fields, sanitizeFn, dirty);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      walkStructured(`${path}.${key}`, nested, fields, sanitizeFn, dirty);
    });
  }
}

function walkSlateNode(path, node, fields, sanitizeFn, dirty) {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'block' && node.blockModelId) {
    walkItem(node, node.blockModelId, path, fields, sanitizeFn, dirty);
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, idx) => {
      walkSlateNode(`${path}.children.${idx}`, child, fields, sanitizeFn, dirty);
    });
  }
}

function collectDirtyWysiwyg(formValues, itemTypeId, fields, sanitizeFn) {
  const dirty = [];
  walkItem(formValues, itemTypeId, '', fields, sanitizeFn, dirty);
  return dirty;
}

/**
 * Collect every item type ID referenced by the record values: the record's own
 * model plus every block model found in modular content / single block /
 * structured text values (both formValues and CMA payload formats).
 */
function collectItemTypeIds(value, acc) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectItemTypeIds(item, acc));
    return acc;
  }

  if (value && typeof value === 'object') {
    const blockItemTypeId = value.itemTypeId
      || value.blockModelId
      || (
        value.relationships
        && value.relationships.item_type
        && value.relationships.item_type.data
        && value.relationships.item_type.data.id
      );
    if (blockItemTypeId) acc.push(blockItemTypeId);

    Object.values(value).forEach((nested) => collectItemTypeIds(nested, acc));
  }

  return acc;
}

module.exports = {
  isWysiwygTextField,
  findField,
  collectDirtyWysiwyg,
  collectItemTypeIds,
};
