const levenshtein = require('js-levenshtein');
const sanitizeHtml = require('sanitize-html');

function sanitize(text) {
  return sanitizeHtml(text, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol', 'li', 'b',
      'i', 'strong', 'em', 'strike', 'br', 'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td',
      'iframe'],
    allowedAttributes: {
      a: ['href', 'name', 'target'],
    },
    allowedIframeHostnames: ['www.youtube.com'],
  });
}

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  let oldValue = plugin.getFieldValue(plugin.fieldPath);
  console.log(oldValue);
  plugin.setFieldValue(plugin.fieldPath, sanitize(oldValue));
  console.log(sanitize(oldValue));

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    let newV = newValue;
    if (levenshtein(newValue, oldValue) > 10) {
      console.log(oldValue);
      newV = sanitize(newV);
      console.log(newV);
      plugin.setFieldValue(plugin.fieldPath, newV);
    }
    oldValue = newV;
  });
});
