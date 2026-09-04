/* eslint-disable no-console */
const assert = require('assert');
const { sanitize } = require('../src/sanitize');
const { isWysiwygTextField, collectDirtyWysiwyg, collectItemTypeIds } = require('../src/fields');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function field(itemTypeId, apiKey, fieldType, editor) {
  return {
    id: `${itemTypeId}-${apiKey}`,
    attributes: {
      api_key: apiKey,
      field_type: fieldType,
      appearance: editor ? { editor } : undefined,
    },
    relationships: {
      item_type: { data: { id: itemTypeId } },
    },
  };
}

const PAGE = 'page-1';
const BLOCK = 'block-1';

const fields = {
  body: field(PAGE, 'body', 'text', 'wysiwyg'),
  htmlObal: field(PAGE, 'html_obal', 'text', 'textarea'),
  notes: field(PAGE, 'notes', 'text', 'markdown'),
  title: field(PAGE, 'title', 'string'),
  content: field(PAGE, 'content', 'rich_text'),
  blockHtml: field(BLOCK, 'text', 'text', 'wysiwyg'),
  blockWrap: field(BLOCK, 'html_obal', 'text', 'textarea'),
};

test('isWysiwygTextField accepts only WYSIWYG text fields', () => {
  assert.strictEqual(isWysiwygTextField(fields.body), true);
  assert.strictEqual(isWysiwygTextField(fields.htmlObal), false);
  assert.strictEqual(isWysiwygTextField(fields.notes), false);
  assert.strictEqual(isWysiwygTextField(fields.title), false);
  assert.strictEqual(isWysiwygTextField(fields.content), false);
  assert.strictEqual(isWysiwygTextField(undefined), false);
});

test('does not mark textarea HTML as dirty (the HTML obal case)', () => {
  const dirty = collectDirtyWysiwyg({
    html_obal: {
      cs: '<form action="/x" method="get">\n<input type="hidden" name="pc" value="group">\n{button}\n</form>',
    },
    body: { cs: '<p>clean</p>' },
  }, PAGE, fields, sanitize);

  assert.deepStrictEqual(dirty, []);
});

test('marks dirty WYSIWYG HTML and leaves textarea alone in the same record', () => {
  const dirty = collectDirtyWysiwyg({
    html_obal: '<form>{button}</form>',
    body: '<p><span style="color:red">Hello</span></p>',
  }, PAGE, fields, sanitize);

  assert.strictEqual(dirty.length, 1);
  assert.strictEqual(dirty[0].path, 'body');
  assert.strictEqual(dirty[0].clean, '<p>Hello</p>');
});

test('skips markdown text fields', () => {
  const dirty = collectDirtyWysiwyg({
    notes: '<div>should stay</div>',
  }, PAGE, fields, sanitize);

  assert.deepStrictEqual(dirty, []);
});

test('still sanitizes WYSIWYG fields inside modular blocks', () => {
  const dirty = collectDirtyWysiwyg({
    content: {
      cs: [
        {
          itemId: 'b1',
          itemTypeId: BLOCK,
          text: '<p><span style="color:red">Hello</span></p>',
          html_obal: '<form>{button}</form>',
        },
      ],
    },
  }, PAGE, fields, sanitize);

  assert.strictEqual(dirty.length, 1);
  assert.strictEqual(dirty[0].path, 'content.cs.0.text');
  assert.strictEqual(dirty[0].clean, '<p>Hello</p>');
});

test('handles CMA payload block format (attributes + relationships)', () => {
  // onBeforeItemUpsert payload serializes blocks in CMA style, not formValues style.
  const dirty = collectDirtyWysiwyg({
    content: {
      cs: [
        {
          type: 'item',
          id: 'b1',
          attributes: {
            text: '<p><span style="color:red">Hello</span></p>',
            html_obal: '<form>{button}</form>',
          },
          relationships: { item_type: { data: { id: BLOCK, type: 'item_type' } } },
        },
        'unchanged-block-id-as-string',
      ],
    },
  }, PAGE, fields, sanitize);

  assert.strictEqual(dirty.length, 1);
  assert.strictEqual(dirty[0].path, 'content.cs.0.text');
  assert.strictEqual(dirty[0].clean, '<p>Hello</p>');
});

test('collectItemTypeIds finds block models in both value formats', () => {
  const ids = collectItemTypeIds({
    content: {
      cs: [
        { itemId: 'b1', itemTypeId: BLOCK, text: 'x' },
        {
          type: 'item',
          attributes: { text: 'y' },
          relationships: { item_type: { data: { id: 'block-2' } } },
        },
      ],
    },
    title: 'plain',
  }, [PAGE]);

  assert.deepStrictEqual([...new Set(ids)].sort(), [BLOCK, 'block-2', PAGE].sort());
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err && err.stack ? err.stack : err);
    failed += 1;
  }
}

console.log(`\n${passed} passed, ${failed} failed (of ${tests.length})`);
process.exit(failed > 0 ? 1 : 0);
