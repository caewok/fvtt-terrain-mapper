/* globals
expandObject,
FormApplication,
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, LABELS  } from "./const.js";

/**
 * Settings submenu for defining terrains.
 */
export class TerrainSettingsMenu extends FormApplication {
  static get defaultOptions() {
    const opts = super.defaultOptions;
    return foundry.utils.mergeObject(opts, {
      template: `modules/${MODULE_ID}/templates/terrain-settings-menu.html`,
      height: 390,
      title: game.i18n.localize(`${MODULE_ID}.settings.menu.title`),
      width: 600,
      classes: [MODULE_ID, "settings"],
      submitOnClose: false,
      closeOnSubmit: true
    });
  }

  getData(options={}) {
    const data = super.getData(options);
    return foundry.utils.mergeObject(data, {
      displayOptions: LABELS.DISPLAY_OPTIONS,
      rangeOptions: LABELS.RANGE_OPTIONS,
      visibilityOptions: LABELS.VISIBILITY_OPTIONS

    });
  }

  async _updateObject(_, formData) {
    const expandedFormData = expandObject(formData);
  }

}
