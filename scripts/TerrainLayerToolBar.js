/* globals
Application,
canvas,
foundry,
game,
mergeObject,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Terrain } from "./Terrain.js";
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
    Settings.setByName("CURRENT_TERRAIN", terrain.id); // Async
  }

  /** @type {number} */
  #currentLayer;

  get currentLayer() { return this.#currentLayer ?? (this.#currentLayer = this._loadStoredLayer()); }

  set currentLayer(value) {
    this.#currentLayer = Math.clamped(Math.round(value), 0, canvas.terrain.constructor.MAX_LAYERS);
    Settings.setByName("CURRENT_LAYER", this.#currentLayer); // Async

    // Update the layer variable in the shader that displays terrain.
    canvas.terrain._terrainColorsMesh.shader.updateTerrainLayer();
  }

  /**
   * Check if the last stored layer is present and return it if it is in the scene.
   * Otherwise, return the first layer (0) in the scene.
   * @returns {number}
   */
  _loadStoredLayer() {
    const storedId = Settings.getByName("CURRENT_LAYER");
    return storedId ?? 0;
  }

  /**
   * Check if the last stored terrain is present and return it if it is in the scene.
   * Otherwise, return the first terrain in the scene (may be undefined).
   * @returns {Terrain|undefined}
   */
  _loadStoredTerrain() {
    const storedId = Settings.getByName("CURRENT_TERRAIN");
    const sceneMap = canvas.terrain.sceneMap;
    if ( sceneMap.hasTerrainId(storedId) ) return sceneMap.terrainIds.get(storedId);

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
    $("#terrainmapper-tool-select-terrain", html).on("change", this._onHandleTerrainChange.bind(this));
    $("#terrainmapper-tool-select-layer", html).on("change", this._onHandleLayerChange.bind(this));
  }

  getData(options) {
    const data = super.getData(options);

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


    const nLayers = canvas.terrain.constructor.MAX_LAYERS;
    const sceneLayers = new Array(nLayers);
    for ( let i = 0; i < nLayers; i += 1 ) {
      sceneLayers[i] = {
        key: i,
        label: game.i18n.format(`${MODULE_ID}.phrases.layer-number`, { layerNumber: i }),
        isSelected: i === this.currentLayer
      };
    }

    return foundry.utils.mergeObject(data, {
      sceneTerrains,
      nonSceneTerrains,
      sceneLayers,
      isGM: game.user.isGM
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

  /**
   * Handle when the user manually changes the terrain selection.
   * @param {MouseEvent} event
   */
  _onHandleTerrainChange(event) {
    console.debug("TerrainLayerToolBar|_onHandleTerrainChange");
    const terrainId = event.target.value;
    const sceneMap = canvas.terrain.sceneMap;

    // Update the currently selected terrain.
    if ( sceneMap.terrainIds.has(terrainId) ) this.currentTerrain = sceneMap.terrainIds.get(terrainId);
    else this.currentTerrain = Terrain.fromEffectId(terrainId);
    this.render();
  }

  /**
   * Handle when the user manually changes the terrain selection.
   * @param {MouseEvent} event
   */
  _onHandleLayerChange(event) {
    console.debug("TerrainLayerToolBar|_onHandleLayerChange");
    const newLayer = Number(event.target.value);
    canvas.terrain.updateTerrainNames(this.currentLayer, newLayer);
    this.currentLayer = newLayer;
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }
}
