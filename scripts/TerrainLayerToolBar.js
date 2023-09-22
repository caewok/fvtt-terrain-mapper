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
import { TerrainSettings } from "./settings.js";
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

    // Add to scene map if necessary.
    terrain.addToScene();
    this.#currentTerrain = terrain;
    TerrainSettings.setByName("CURRENT_TERRAIN", terrain.id); // async
  }

  /**
   * Check if the last stored terrain is present and return it if it is in the scene.
   * Otherwise, return the first terrain in the scene (may be undefined).
   * @returns {Terrain|undefined}
   */
  _loadStoredTerrain() {
    const storedId = TerrainSettings.getByName("CURRENT_TERRAIN");
    if ( Terrain.sceneMap.hasTerrainId(storedId) ) return Terrain.fromEffectId(storedId);

    // Get the first scene terrain, if any.
    const sceneMap = Terrain.sceneMap;
    const sceneTerrains = Terrain.getAll().filter(t => sceneMap.hasTerrainId(t.id));
    this._sortTerrains(sceneTerrains);
    return sceneTerrains[0];
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
    const sceneMap = Terrain.sceneMap;
    const terrains = Terrain.getAll();
    this._sortTerrains(terrains);

    const nonSceneTerrains = [];
    const sceneTerrains = [];
    const currId = this.currentTerrain?.id;
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

    // If this terrain is not in the scene, add it.
    const sceneMap = Terrain.sceneMap;
    const terrain = Terrain.fromEffectId(terrainId);
    if ( !sceneMap.hasTerrainId(terrainId) ) terrain.addToScene();

    // Update the currently selected terrain.
    canvas.terrain.toolbar.currentTerrain = terrain;
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }
}
