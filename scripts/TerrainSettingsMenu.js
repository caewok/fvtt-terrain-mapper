/* globals
expandObject,
FormApplication,
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, LABELS } from "./const.js";

/**
 * Settings submenu for defining terrains.
 */
export class TerrainSettingsMenu extends FormApplication {
  static get defaultOptions() {
    const opts = super.defaultOptions;
    return foundry.utils.mergeObject(opts, {
      template: `modules/${MODULE_ID}/templates/terrain-settings-menu.html`,
      height: 800,
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
      rangeOptions: LABELS.RANGE_OPTIONS,
      visibilityOptions: LABELS.VISIBILITY_OPTIONS
    });
  }

  async _updateObject(_, formData) {
    const expandedFormData = expandObject(formData);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("button.tm-toggle-visibility").click(this._onToggleVisibility.bind(this));
    html.find("button.tm-edit-ae").click(this._onEditActiveEffect.bind(this));
    html.find("button.tm-remove-terrain").click(this._onRemoveTerrain.bind(this));

    html.find("button.tm-add-terrain").click(this._onAddTerrain.bind(this));
    html.find("button.import").click(this._onImport.bind(this));
    html.find("button.export").click(this._onExport.bind(this));
  }

  _onAddTerrain(event) {
    event.preventDefault();
    console.debug("addTerrain clicked!");
  }

  _onRemoveTerrain(event) {
    event.preventDefault();
    console.debug("removeTerrain clicked!");
  }

  _onEditActiveEffect(event) {
    event.preventDefault();
    console.debug("edit active effect clicked!");
  }

  _onToggleVisibility(event) {
    event.preventDefault();
    console.debug("visibility toggle clicked!");
  }

  _onImport(event) {
    event.preventDefault();
    console.debug("import clicked!");
  }

  _onExport(event) {
    event.preventDefault();
    console.debug("export clicked!");
  }
}
