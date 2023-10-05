/* globals
canvas,
expandObject,
FormApplication,
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { Terrain } from "./Terrain.js";

/**
 * Submenu for viewing terrains defined in the scene.
 */
export class TerrainSceneConfig extends FormApplication {

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

    const allTerrains = Terrain.getAll();
    this._sortTerrains(allTerrains);
    const sceneTerrains = allTerrains.filter(t => canvas.terrain.sceneMap.hasTerrainId(t.id));

    const layerElevations = canvas.scene.getFlag(MODULE_ID, FLAGS.LAYER_ELEVATIONS) ?? (new Array(8)).fill(0);

    const allTerrainLabels = {};
    allTerrains.forEach(t => allTerrainLabels[t.id] = t.name);

    return foundry.utils.mergeObject(data, {
      layerElevations,
      sceneTerrains,
      allTerrainLabels,
      gridUnits: canvas.scene.grid.units || game.i18n.localize("GridUnits"),
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

    if ( expandedFormData.layerElevations ) {
      const layerElevations = canvas.scene.getFlag(MODULE_ID, FLAGS.LAYER_ELEVATIONS) ?? (new Array(8)).fill(0);
      const iter = Object.entries(expandedFormData.layerElevations);
      for ( const [idx, elevation] of iter ) layerElevations[idx] = elevation;
      await canvas.scene.setFlag(MODULE_ID, FLAGS.LAYER_ELEVATIONS, layerElevations);
    }
  }

  async _onSubmit(event, { updateData=null, preventClose=false, preventRender=false } = {}) {
    const formData = await super._onSubmit(event, { updateData, preventClose, preventRender });
    if ( preventClose ) return formData;
  }
}
