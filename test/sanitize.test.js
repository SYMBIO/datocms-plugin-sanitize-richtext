/* eslint-disable no-console */
const assert = require('assert');
const { sanitize, stripMsOfficeArtifacts } = require('../src/sanitize');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// The exact paragraph copied from the customer screenshot. The <span> with
// font-family / font-size / color must be removed; the surrounding <p><b> must
// stay; HTML entities must be preserved (parser.decodeEntities = false).
// ---------------------------------------------------------------------------
const SCREENSHOT_INPUT = '<p><b><span style="font-size: 11.0pt; font-family: \'Calibri\',sans-serif; color: black;">'
  + 'Spole&ccaron;nost BOHEMIA SEKT bude i nad&aacute;le partnerem premi&eacute;rov&yacute;ch '
  + 've&ccaron;er&uring; N&aacute;rodn&iacute;ho divadla. Ob&ecaron; instituce '
  + 'prost&rcaron;ednictv&iacute;m gener&aacute;ln&iacute;ho &rcaron;editele N&aacute;rodn&iacute;ho '
  + 'divadla Jana Buriana a &rcaron;editele spole&ccaron;nosti BOHEMIA SEKT Ond&rcaron;eje '
  + 'Ber&aacute;nka letos stvrdily pokra&ccaron;ov&aacute;n&iacute; spolupr&aacute;ce podpisem '
  + 'nov&eacute; t&rcaron;&iacute;let&eacute; smlouvy. Partnerstv&iacute;, kter&eacute; za&ccaron;alo '
  + 'v roce 1997, tak vstupuje u&zcaron; do sv&eacute;ho 29. roku a d&iacute;ky nov&ecaron; '
  + 'uzav&rcaron;en&eacute; spolupr&aacute;ci spole&ccaron;n&ecaron; p&rcaron;ekro&ccaron;&iacute; '
  + 'hranici t&rcaron;&iacute;dek&aacute;d a vykro&ccaron;&iacute; sm&ecaron;rem ke sv&eacute; '
  + '&ccaron;tvrt&eacute; dek&aacute;d&ecaron;.'
  + '</span></b></p>';

test('removes the <span style="..."> from the exact screenshot HTML', () => {
  const out = sanitize(SCREENSHOT_INPUT);

  assert.ok(!/<span\b/i.test(out), `<span> tag was not removed:\n${out}`);
  assert.ok(!/font-size/i.test(out), `font-size leaked through:\n${out}`);
  assert.ok(!/font-family/i.test(out), `font-family leaked through:\n${out}`);
  assert.ok(!/color:\s*black/i.test(out), `color: black leaked through:\n${out}`);
  assert.ok(/<p><b>/i.test(out), `<p><b> wrapper was lost:\n${out}`);
  assert.ok(/<\/b><\/p>/i.test(out), `closing </b></p> was lost:\n${out}`);
  assert.ok(/Spole&ccaron;nost BOHEMIA SEKT/.test(out), `entities should be preserved:\n${out}`);
});

test('removes <span style="..."> in a minimal Word-style paragraph', () => {
  const input = '<p><span style="color:red">Hello</span></p>';
  const expected = '<p>Hello</p>';
  assert.strictEqual(sanitize(input), expected);
});

test('keeps allowed inline tags (b, i, strong, em, a)', () => {
  const input = '<p><b>bold</b> <i>italic</i> <strong>strong</strong> '
    + '<em>em</em> <a href="https://example.com" title="t" target="_blank" rel="noopener">link</a></p>';
  const out = sanitize(input);
  assert.ok(/<b>bold<\/b>/.test(out));
  assert.ok(/<i>italic<\/i>/.test(out));
  assert.ok(/<strong>strong<\/strong>/.test(out));
  assert.ok(/<em>em<\/em>/.test(out));
  assert.ok(/<a href="https:\/\/example\.com" title="t" target="_blank" rel="noopener">link<\/a>/.test(out));
});

test('<br /> is normalised to <br> to match CKEditor output (prevents infinite dirty loop)', () => {
  assert.strictEqual(sanitize('<p>line1<br>line2</p>'), '<p>line1<br>line2</p>');
  assert.strictEqual(sanitize('<p>line1<br />line2</p>'), '<p>line1<br>line2</p>');
  assert.strictEqual(sanitize('<p>line1<BR/>line2</p>'), '<p>line1<br>line2</p>');
});

test('real-world: br normalisation is idempotent with CKEditor round-trip', () => {
  // Simulate: plugin sanitizes → CKEditor stores <br> → plugin sanitizes again
  const afterPlugin = sanitize('<p>A<br>B</p>');      // CKEditor input
  const afterCKEditor = afterPlugin;                   // CKEditor keeps <br> unchanged
  const afterPlugin2 = sanitize(afterCKEditor);
  assert.strictEqual(afterPlugin, afterPlugin2, 'must be stable across CKEditor round-trips');
});

test('converts <div> to <p>', () => {
  assert.strictEqual(sanitize('<div>x</div>'), '<p>x</p>');
});

// ---------------------------------------------------------------------------
// MS Office / Outlook specific cleanup
// ---------------------------------------------------------------------------
test('removes <o:p> and other Office-namespaced tags', () => {
  const input = '<p>Hello<o:p></o:p></p><w:WordDocument><w:View>Normal</w:View></w:WordDocument>'
    + '<p><v:shape id="_x0000_i1025"/>World</p>';
  const out = sanitize(input);
  assert.ok(!/<o:p/i.test(out), `<o:p> not removed:\n${out}`);
  assert.ok(!/<w:/i.test(out), `<w:*> not removed:\n${out}`);
  assert.ok(!/<v:/i.test(out), `<v:*> not removed:\n${out}`);
  assert.ok(/Hello/.test(out));
  assert.ok(/World/.test(out));
});

test('removes MS conditional comments <!--[if mso]>...<![endif]-->', () => {
  const input = '<p>Before<!--[if mso]><b>secret office payload</b><![endif]-->After</p>';
  const out = sanitize(input);
  assert.ok(!/if mso/i.test(out), `mso conditional not removed:\n${out}`);
  assert.ok(!/secret office payload/.test(out), `mso conditional payload leaked:\n${out}`);
  assert.ok(/Before/.test(out) && /After/.test(out));
});

test('removes clipboard <!--StartFragment--> / <!--EndFragment--> markers', () => {
  const input = '<!--StartFragment--><p>Body</p><!--EndFragment-->';
  const out = sanitize(input);
  assert.ok(!/StartFragment|EndFragment/.test(out), `fragment markers leaked:\n${out}`);
  assert.ok(/<p>Body<\/p>/.test(out));
});

test('removes embedded <style> blocks (Outlook pastes inline stylesheets)', () => {
  const input = '<style>p { color: red; }</style><p>Hello</p>';
  const out = sanitize(input);
  assert.ok(!/<style/i.test(out), `<style> not removed:\n${out}`);
  assert.ok(!/color: red/.test(out), `style content leaked:\n${out}`);
  assert.ok(/<p>Hello<\/p>/.test(out));
});

test('removes <xml> blocks with Office metadata', () => {
  const input = '<xml><o:DocumentProperties><o:Author>John</o:Author></o:DocumentProperties></xml><p>x</p>';
  const out = sanitize(input);
  assert.ok(!/<xml/i.test(out), `<xml> not removed:\n${out}`);
  assert.ok(!/Author/.test(out), `xml content leaked:\n${out}`);
  assert.ok(/<p>x<\/p>/.test(out));
});

test('removes MsoNormal / MsoListParagraph class attributes', () => {
  const input = '<p class="MsoNormal">A</p><p class="MsoListParagraph">B</p>';
  const out = sanitize(input);
  assert.ok(!/Mso/.test(out), `Mso* class leaked:\n${out}`);
  assert.ok(/<p>A<\/p>/.test(out));
  assert.ok(/<p>B<\/p>/.test(out));
});

test('strips mso-* declarations even when other styles exist alongside', () => {
  const out = stripMsOfficeArtifacts(
    '<p style="mso-margin-top-alt:auto; color:red; mso-pagination:widow-orphan;">x</p>',
  );
  assert.ok(!/mso-/i.test(out), `mso-* leaked:\n${out}`);
  assert.ok(/color:red/.test(out), `non-mso styles must remain in pre-cleaning:\n${out}`);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
test('returns falsy input untouched', () => {
  assert.strictEqual(sanitize(''), '');
  assert.strictEqual(sanitize(null), null);
  assert.strictEqual(sanitize(undefined), undefined);
});

test('is idempotent (sanitize(sanitize(x)) === sanitize(x))', () => {
  const once = sanitize(SCREENSHOT_INPUT);
  const twice = sanitize(once);
  assert.strictEqual(twice, once);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
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
