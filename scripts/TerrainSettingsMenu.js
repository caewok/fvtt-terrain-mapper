/* globals
expandObject,
FormApplication,
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, LABELS } from "./const.js";
import { Terrain, TerrainMap } from "./Terrain.js";

/**
 * Settings submenu for defining terrains.
 */
export class TerrainSettingsMenu extends FormApplication {
  terrainMap = new TerrainMap();

  constructor(object, options) {
    const terrains = Terrain.toJSON() || [];
    terrains.forEach(t => this.terrainMap.set(t.id, t));
    super(terrains, options);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
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
      anchorOptions: LABELS.ANCHOR_OPTIONS,
      userVisible: true,
      anchor: 1,
      offset: 0,
      min: 0,
      max: 0
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

    if ( this.object.length > Terrain.MAX_TERRAINS ) {
      console.warn(`Sorry, cannot add more than ${Terrain.MAX_TERRAINS} terrains!`);
      return;
    }

    const terrain = new Terrain({}, { terrainMap: this.terrainMap });
    this.object.push(terrain.toJSON());
    this.render();
  }

  _onRemoveTerrain(event) {
    event.preventDefault();
    console.debug("removeTerrain clicked!");

    // For reasons, the target is sometimes the button value and sometimes the button.
    const target = event.target;
    const idx = Number(target.getAttribute("data-idx") || target.parentElement.getAttribute("data-idx"));
    const id = this.object[idx].id;
    this.terrainMap.delete(id);
    this.object.splice(idx, 1);
    this.render();
  }

  _onEditActiveEffect(event) {
    event.preventDefault();
    console.debug("edit active effect clicked!");
  }

  _onToggleVisibility(event) {
    event.preventDefault();
    console.debug("visibility toggle clicked!");

    const target = event.target;
    const idx = Number(target.getAttribute("data-idx") || target.parentElement.getAttribute("data-idx"));
    this.object[idx].userVisible ^= true;
    this.render();
  }

  async _onImport(event) {
    event.preventDefault();
    console.debug("import clicked!");
    Terrain.importFromFileDialog();
  }

  _onExport(event) {
    event.preventDefault();
    console.debug("export clicked!");
    Terrain.saveToFile();
  }

}
