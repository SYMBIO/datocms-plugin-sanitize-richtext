const sanitizeHtml = require('sanitize-html');

/**
 * Remove MS Office / Outlook specific markup that `sanitize-html` does not strip
 * reliably on its own (namespaced tags, conditional comments, fragment markers,
 * inline `<style>` blocks, leftover `mso-*` style declarations, ...).
 *
 * This pre-processing step is intentionally aggressive because content pasted
 * from Word or the Outlook message body is the most common source of unwanted
 * formatting reported by editors.
 */
function stripMsOfficeArtifacts(html) {
  if (!html) return html;

  return html
    // <!--[if mso]>...<![endif]--> and similar MS conditional comments
    .replace(/<!--\[if[\s\S]*?\]>[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!\[if[\s\S]*?\]>[\s\S]*?<!\[endif\]>/gi, '')
    // clipboard fragment markers from Word / Outlook
    .replace(/<!--\s*Start[Ff]ragment\s*-->/g, '')
    .replace(/<!--\s*End[Ff]ragment\s*-->/g, '')
    // <style>...</style> blocks (Outlook ships inline stylesheets with pastes)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // <xml>...</xml> blocks with Office metadata
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    // MS Office namespaced tags: <o:p>, <w:wordDocument>, <v:shape>, <m:...>, <st1:...>
    .replace(/<\/?[a-z][a-z0-9]*:[^>]*>/gi, '')
    // mso-* style declarations left inside style="" attributes
    .replace(/mso-[^:;"']+:[^;"']+;?/gi, '')
    // class names that come exclusively from Word (MsoNormal, MsoListParagraph, ...)
    .replace(/\sclass="Mso[^"]*"/gi, '')
    .replace(/\sclass='Mso[^']*'/gi, '');
}

function sanitize(text) {
  if (!text) return text;

  const preCleaned = stripMsOfficeArtifacts(text);

  const result = sanitizeHtml(preCleaned, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol', 'li',
      'b', 'i', 'strong', 'em', 'strike', 'br', 'table', 'thead', 'caption', 'tbody', 'tfoot',
      'tr', 'th', 'td', 'iframe', 'img', 'button'],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'title'],
      iframe: ['src', 'width', 'height', 'data-name'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      th: ['colspan', 'rowspan', 'scope', 'style'],
      td: ['colspan', 'rowspan', 'scope', 'style'],
    },
    allowedIframeHostnames: ['www.youtube.com', 'www.podbean.com'],
    parser: {
      decodeEntities: false,
    },
    transformTags: {
      div: 'p',
    },
  });

  // sanitize-html outputs void elements as XHTML self-closing (<br />, <img ... />).
  // CKEditor normalises these to HTML5 form (<br>, <img ...>) on every render.
  return result
    .replace(/<(br|img)([^>]*?)\s*\/>/gi, '<$1$2>')
    // CKEditor strips \r from HTML (Windows line endings \r\n → \n).
    // Stripping here prevents a 1-char difference per \r on every page load.
    .replace(/\r/g, '')
    // CKEditor trims trailing plain spaces that appear just before a closing tag.
    // e.g. "text  </p>" → "text</p>" — strip to match what CKEditor stores.
    .replace(/ +(<\/(?:p|h[1-6]|li|td|th|blockquote)>)/gi, '$1');
}

module.exports = { sanitize, stripMsOfficeArtifacts };
