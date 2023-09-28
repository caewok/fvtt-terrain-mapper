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
import { capitalizeFirstLetter } from "./util.js";

/**
 * Submenu for viewing terrains defined in the scene.
 */
export class TerrainSceneConfig extends FormApplication {

  /** @type {Terrain[]} */
  allTerrains;

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: `modules/${MODULE_ID}/templates/terrain-scene-config.html`,
      height: "auto",
      title: game.i18n.localize(`${MODULE_ID}.scene-config.title`),
      width: 700,
      classes: [MODULE_ID, "settings"],
      submitOnClose: false,
      closeOnSubmit: true
    });
  }

  getData(options={}) {
    const data = super.getData(options);
    const allTerrains = this.allTerrains = Terrain.getAll();
    this._sortTerrains(allTerrains);

    const allTerrainLabels = {};
    allTerrains.forEach(t => allTerrainLabels[t.id] = t.name);

    const sceneTerrains = allTerrains.filter(t => canvas.terrain.sceneMap.hasTerrainId(t.id));

    return foundry.utils.mergeObject(data, {
      anchorAbbrOptions: LABELS.ANCHOR_ABBR_OPTIONS,
      allTerrainLabels,
      sceneTerrains,
      allTerrains,
      maxPixelId: 31,
      noSceneTerrains: !sceneTerrains.length
    });
  }

  _sortTerrains(terrains) {
    terrains.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
      if ( nameA < nameB ) return -1;
      if ( nameA > nameB ) return 1;
      return 0;
    });
    return terrains;
  }

  async _updateObject(_, formData) {
    const expandedFormData = expandObject(formData);
    if ( expandedFormData.terrains ) {
      const promises = [];
      for ( const [idx, terrainData] of Object.entries(expandedFormData.allTerrains) ) {
        const terrain = this.allTerrains[Number(idx)];
        for ( const [key, value] of Object.entries(terrainData) ) {
          promises.push(terrain[`set${capitalizeFirstLetter(key)}`](value));
        }
      }
      await Promise.allSettled(promises);
    }

    if ( expandedFormData.sceneTerrains ) {
      // If the user has set the same terrain to multiple pixel values, create a duplicate.
      const terrainsUsed = new Set();
      const sceneMap = canvas.terrain.sceneMap;
      for ( const [idx, choiceData] of Object.entries(expandedFormData.sceneTerrains) ) {
        const terrainId = choiceData.anchorChoice;
        let terrain = sceneMap.terrainIds.get(terrainId);
        if ( !terrain ) continue;
        if ( terrainsUsed.has(terrain) ) terrain = await terrain.duplicate();
        else terrainsUsed.add(terrain);

        const pixelValue = Number(idx);
        if ( sceneMap.get(pixelValue) === terrain ) continue;
        canvas.terrain._replaceTerrainInScene(terrain, pixelValue);
      }
    }
  }

  async _onSubmit(event, { updateData=null, preventClose=false, preventRender=false } = {}) {
    const formData = await super._onSubmit(event, { updateData, preventClose, preventRender });
    if ( preventClose ) return formData;
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
