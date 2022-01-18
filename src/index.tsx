import { connect, FieldAppearanceChange } from 'datocms-plugin-sdk';
import levenshtein from 'js-levenshtein';
import get from 'lodash-es/get';
import sanitize from 'sanitize-html';

const FIELD_EXTENSION_ID = 'sanitizeHtml';

let oldSanitizedValue: null | string = null;

connect({
  async onBoot(ctx) {
    if (ctx.plugin.attributes.parameters.migratedFromLegacyPlugin) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    const someUpgraded = (
      await Promise.all(
        fields.map(async (field) => {
          const { appearance } = field.attributes;

          const changes: FieldAppearanceChange[] = [];

          appearance.addons.forEach((addon, index) => {
            if (addon.field_extension === FIELD_EXTENSION_ID) {
              return;
            }

            changes.push({
              operation: 'updateAddon',
              index,
              newFieldExtensionId: FIELD_EXTENSION_ID,
            });
          });

          if (changes.length === 0) {
            return false;
          }

          await ctx.updateFieldAppearance(field.id, changes);
        }),
      )
    ).some((x) => x);

    ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      migratedFromLegacyPlugin: true,
    });

    if (someUpgraded) {
      ctx.notice('Plugin settings upgraded successfully!');
    }
  },
  manualFieldExtensions() {
    return [
      {
        id: FIELD_EXTENSION_ID,
        type: 'addon',
        name: 'Sanitize HTML',
        fieldTypes: ['text'],
        initialHeight: 0,
      },
    ];
  },
  renderFieldExtension(id, ctx) {
    const currentValue = get(ctx.formValues, ctx.fieldPath) as string | null;

    if (
      currentValue &&
      (!oldSanitizedValue || levenshtein(currentValue, oldSanitizedValue) > 10)
    ) {
      oldSanitizedValue = currentValue;
      ctx.setFieldValue(ctx.fieldPath, sanitize(currentValue));
    }
  },
});
