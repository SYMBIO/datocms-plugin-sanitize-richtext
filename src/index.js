const levenshtein = require('js-levenshtein');
const sanitizeHtml = require('sanitize-html');

function sanitize(text) {
  if (text) {
    return sanitizeHtml(text, {
      allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol', 'li',
        'b', 'i', 'strong', 'em', 'strike', 'br', 'table', 'thead', 'caption', 'tbody', 'tfoot',
        'tr', 'th', 'td', 'iframe', 'img', 'button'],
      allowedAttributes: {
        a: ['href', 'name', 'target', 'rel'],
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
  }
  return text;
}

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  let oldValue = plugin.getFieldValue(plugin.fieldPath);
  plugin.setFieldValue(plugin.fieldPath, sanitize(oldValue));

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    let newV = newValue;
    if (!oldValue || !newValue || levenshtein(newValue, oldValue) > 10) {
      newV = sanitize(newV);
      if (newV !== oldValue) {
        plugin.setFieldValue(plugin.fieldPath, newV);
      }
    }
    oldValue = newV;
  });
});
