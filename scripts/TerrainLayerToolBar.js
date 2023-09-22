/* globals
Application,
canvas,
game,
mergeObject,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Terrain } from "./Terrain.js";

export class TerrainLayerToolBar extends Application {

  static get defaultOptions() {
    const options = {
      classes: ["form"],
      left: 98,
      popOut: false,
      template: `modules/${MODULE_ID}/templates/terrain-step-controls.html`,
      id: `${MODULE_ID}-config`,
      title: "TerrainLayer Terrain Selection",
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false
    };

    options.editable = game.user.isGM;
    return mergeObject(super.defaultOptions, options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    $("#terrainmapper-tool-select", html).on("change", this._onHandleChange.bind(this));
  }

  getData(_options) {
    const sceneMap = Terrain.sceneMap;
    const terrains = Terrain.getAll();
    this._sortTerrains(terrains);

    const nonSceneTerrains = [];
    const sceneTerrains = [];
    const currId = canvas.terrain.controls.currentTerrain?.id;
    for ( const terrain of terrains ) {
      const obj = {
        key: terrain.id,
        label: terrain.name,
        isSelected: currId === terrain.id
      };
      const arr = sceneMap.hasTerrainId(terrain.id) ? sceneTerrains : nonSceneTerrains;
      arr.push(obj);
    }

    return {
      sceneTerrains,
      nonSceneTerrains
    };
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

  /**
   * Handle when the user manually changes the elevation number
   * @param {Event} event
   */
  _onHandleChange(event) {
    console.debug("TerrainLayerToolBar|_onHandleChange");
    const terrainId = event.target.value;
    canvas.terrain.currentTerrain = terrainId;
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }
}
