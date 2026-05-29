const { sanitize } = require('./sanitize');

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  let lastSanitized = null;
  let retryTimer = null;

  /**
   * Write the sanitized value to the field and schedule one re-check after
   * 600 ms. CKEditor can fire its own debounced onChange *after* we call
   * setFieldValue and overwrite our clean value with the original dirty
   * content. The re-check catches that overwrite and corrects it.
   */
  function applySanitized(sanitized) {
    lastSanitized = sanitized;
    plugin.setFieldValue(plugin.fieldPath, sanitized);

    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const current = plugin.getFieldValue(plugin.fieldPath);
      if (current === lastSanitized) return;

      const reSanitized = sanitize(current);
      if (reSanitized !== current) {
        applySanitized(reSanitized);
      } else {
        lastSanitized = current;
      }
    }, 600);
  }

  // Sanitize existing value on load (marks the form dirty — editor must save).
  const initial = plugin.getFieldValue(plugin.fieldPath);
  const initialSanitized = sanitize(initial);
  if (initialSanitized !== initial) {
    applySanitized(initialSanitized);
  } else {
    lastSanitized = initial;
  }

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    // Ignore our own setFieldValue echoes.
    if (newValue === lastSanitized) return;

    const sanitized = sanitize(newValue);
    if (sanitized !== newValue) {
      applySanitized(sanitized);
    } else {
      lastSanitized = newValue;
    }
  });
});
