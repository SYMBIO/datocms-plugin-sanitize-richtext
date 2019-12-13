const levenshtein = require('js-levenshtein');
const sanitizeHtml = require('sanitize-html');

function sanitize(text) {
  return sanitizeHtml(text, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol', 'li', 'b',
      'i', 'strong', 'em', 'strike', 'br', 'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td',
      'iframe'],
    allowedAttributes: {
      a: ['href', 'name', 'target'],
      iframe: ['src'],
    },
    allowedIframeHostnames: ['www.youtube.com'],
    parser: {
      decodeEntities: false
    }
  });
}

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  let oldValue = plugin.getFieldValue(plugin.fieldPath);
  plugin.setFieldValue(plugin.fieldPath, sanitize(oldValue));

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    let newV = newValue;
    if (levenshtein(newValue, oldValue) > 10) {
      console.log('----newV------');
      console.log(newV);
      newV = sanitize(newV);
      if (newV !== oldValue) {
        console.log('----newV-sanitized----');
        console.log(newV);
        console.log('----oldValue------');
        console.log(oldValue);
        console.log('----------');
        plugin.setFieldValue(plugin.fieldPath, newV);
      }
    }
    oldValue = newV;
  });
});
