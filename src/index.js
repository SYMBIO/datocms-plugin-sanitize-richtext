const { sanitize } = require('./sanitize');

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  // Track the last value we have sanitized so that the change listener can
  // recognise (and ignore) the echo coming from our own `setFieldValue` call.
  let lastSanitized = sanitize(plugin.getFieldValue(plugin.fieldPath));
  if (lastSanitized !== plugin.getFieldValue(plugin.fieldPath)) {
    plugin.setFieldValue(plugin.fieldPath, lastSanitized);
  }

  plugin.addFieldChangeListener(plugin.fieldPath, (newValue) => {
    if (newValue === lastSanitized) return;

    const sanitized = sanitize(newValue);
    // Update the guard BEFORE writing back so that a synchronous re-entry of
    // this listener (some editor integrations call listeners synchronously)
    // hits the early-return above instead of running sanitize twice.
    lastSanitized = sanitized;

    if (sanitized !== newValue) {
      plugin.setFieldValue(plugin.fieldPath, sanitized);
    }
  });
});
