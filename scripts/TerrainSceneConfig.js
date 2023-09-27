/* globals
ActiveEffect,
canvas,
expandObject,
FormApplication,
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, LABELS } from "./const.js";
import { Terrain } from "./Terrain.js";
import { TerrainMap } from "./TerrainMap.js";
import { EnhancedEffectConfig } from "./EnhancedEffectConfig.js";
import { Settings } from "./Settings.js";

/**
 * Submenu for viewing terrains defined in the scene.
 */
export class TerrainSceneConfig extends FormApplication {

  /**
   * Temporary terrain map to hold the terrains to be updated.
   * @type {TerrainMap}
   */
  terrainMap = new TerrainMap();

  constructor(object, options) {
    const terrains = [];
    for ( const [key, terrain] of canvas.terrain.sceneMap) {
      const obj = terrain.toJSON();
      obj.pixelId = key;
      terrains.push(obj);
    }
    super(terrains, options);

    terrains.forEach(t => this.terrainMap.set(t.pixelId, t));

  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: `modules/${MODULE_ID}/templates/terrain-scene-config.html`,
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
      anchorAbbrOptions: LABELS.ANCHOR_ABBR_OPTIONS,
      maxPixelId: 31
    });
  }

  async _updateObject(_, formData) {
    const expandedFormData = expandObject(formData);
    if ( !expandedFormData.terrains ) return;
    for ( const [idx, terrain] of Object.entries(expandedFormData.terrains) ) {
      const terrainData = this.object[idx];
      for ( const [key, value] of Object.entries(terrain) ) terrainData[key] = value;
    }
  }

  async _onSubmit(event, { updateData=null, preventClose=false, preventRender=false } = {}) {
    const formData = await super._onSubmit(event, { updateData, preventClose, preventRender });
    if ( preventClose ) return formData;

    const terrains = this.object.map(t => t.toJSON());

    await Settings.set(Settings.KEYS.TERRAINS, terrains);
    canvas.terrain._initializeTerrains();
  }

  async _onSelectFile(selection, filePicker) {
    console.debug("_onSelectFile", selection);
    const idx = Number(filePicker.button.getAttribute("data-idx"));
    this.object[idx].icon = selection;
    this.render(); // Redraw the icon image.
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("button.tm-toggle-visibility").click(this._onToggleVisibility.bind(this));
    html.find("button.tm-edit-ae").click(this._onEditActiveEffect.bind(this));
    html.find("button.tm-remove-terrain").click(this._onRemoveTerrain.bind(this));
    html.find("button.tm-add-terrain").click(this._onAddTerrain.bind(this));
  }

  async _onAddTerrain(event) {
    event.preventDefault();
    console.debug("addTerrain clicked!");

    if ( this.object.length > Terrain.MAX_TERRAINS ) {
      console.warn(`Sorry, cannot add more than ${Terrain.MAX_TERRAINS} terrains!`);
      return;
    }

    const terrain = new Terrain({}, { terrainMap: this.terrainMap });
    this.object.push(terrain.toJSON());

    await this._onSubmit(event, { preventClose: true });
    this.render();
  }

  async _onRemoveTerrain(event) {
    event.preventDefault();
    console.debug("removeTerrain clicked!");
    const idx = this._indexForEvent(event);
    const id = this.object[idx].id;
    this.terrainMap.delete(id);
    this.object.splice(idx, 1);

    await this._onSubmit(event, { preventClose: true });
    this.render();
  }

  async _onEditActiveEffect(event) {
    event.preventDefault();
    console.debug("edit active effect clicked!");
    await this._onSubmit(event, { preventClose: true });

    const idx = this._indexForEvent(event);
    const id = this.object[idx].id;
    const effect = this.object[idx].activeEffect ??= new ActiveEffect({ name: `TerrainEffect.${id}`});
    const app = new EnhancedEffectConfig(effect);
    app.render(true);
  }

  async _onToggleVisibility(event) {
    event.preventDefault();
    console.debug("visibility toggle clicked!");

    const idx = this._indexForEvent(event);
    this.object[idx].userVisible ^= true;
    await this._onSubmit(event, { preventClose: true });
    this.render();
  }

  _indexForEvent(event) {
    // For reasons, the target is sometimes the button value and sometimes the button.
    const target = event.target;
    return Number(target.getAttribute("data-idx") || target.parentElement.getAttribute("data-idx"));
  }

}
