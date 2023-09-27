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
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";
import { Settings } from "./Settings.js";
import { isString } from "./util.js";

export class TerrainLayerToolBar extends Application {

  /** @type {Terrain|undefined} */
  #currentTerrain;

  get currentTerrain() {
    return this.#currentTerrain || (this.#currentTerrain = this._loadStoredTerrain());
  }

  set currentTerrain(terrain) {
    if ( isString(terrain) ) terrain = Terrain.fromEffectId(terrain);
    if ( !(terrain instanceof Terrain) ) {
      console.error("Current terrain must be an instance of terrain.", terrain);
      return;
    }
    this.#currentTerrain = terrain;
    Settings.setByName("CURRENT_TERRAIN", terrain.id); // async
  }

  /**
   * Check if the last stored terrain is present and return it if it is in the scene.
   * Otherwise, return the first terrain in the scene (may be undefined).
   * @returns {Terrain|undefined}
   */
  _loadStoredTerrain() {
    const storedId = Settings.getByName("CURRENT_TERRAIN");
    const sceneMap = canvas.terrain.sceneMap;
    if ( sceneMap.hasTerrainId(storedId) ) return sceneMap.get(storedId);

    // Otherwise, use the null terrain.
    return sceneMap.get(0);
  }

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
    const sceneMap = canvas.terrain.sceneMap;
    const terrains = Terrain.getAll();
    this._sortTerrains(terrains);
    terrains.unshift(sceneMap.get(0));

    const currId = this.currentTerrain?.id;
    const nonSceneTerrains = [];
    const sceneTerrains = [];

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
   * Handle when the user manually changes the terrain selection.
   * @param {Event} event
   */
  _onHandleChange(event) {
    console.debug("TerrainLayerToolBar|_onHandleChange");
    const terrainId = event.target.value;
    const sceneMap = canvas.terrain.sceneMap;
    const toolbar = canvas.terrain.toolbar;

    // Update the currently selected terrain.
    if ( sceneMap.terrainIds.has(terrainId) ) toolbar.currentTerrain = sceneMap.terrainIds.get(terrainId);
    else toolbar.currentTerrain = Terrain.fromEffectId(terrainId);
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }
}
