/* globals
CONFIG,
InteractionLayer,
mergeObject,
PIXI,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Terrain } from "./Terrain.js";
import { TerrainSettings } from "./settings.js";
import { isString } from "./util.js";

export class TerrainLayer extends InteractionLayer {

  /** @type {number} */
  static MAX_TERRAIN_ID = Math.pow(2, 5) - 1;

  /** @type {Terrain} */
  #currentTerrain;

  /**
   * Container to hold objects to display wall information on the canvas
   */
  _wallDataContainer = new PIXI.Container();

  constructor() {
    super();
    this.controls = ui.controls.controls.find(obj => obj.name === "terrain");
  }

  /** @overide */
  static get layerOptions() {
    return mergeObject(super.layerOptions, {
      name: "Terrain"
    });
  }

  /**
   * Add the layer so it is accessible in the console.
   */
  static register() { CONFIG.Canvas.layers.terrain = { group: "primary", layerClass: TerrainLayer }; }

  // ----- NOTE: Access terrain data ----- //

  get currentTerrain() { return this.#currentTerrain; }

  get sceneMap() { return Terrain.sceneMap; }

  /**
   * Set the current terrain and if necessary, add the terrain to the scene.
   * @param {Terrain|String} terrain    Terrain or terrain id.
   */
  set currentTerrain(terrain) {
    if ( isString(terrain) ) terrain = Terrain.fromEffectId(terrain);
    if ( !(terrain instanceof Terrain) ) {
      console.error("Current terrain must be an instance of terrain.", terrain);
      return;
    }

    // Get terrain from the scene map or add to the scene map.
    if ( this.sceneMap.terrainIds.has(terrain.id) ) terrain = this.terrainForId(terrain.id);
    else this.sceneMap.add(terrain);
    this.#currentTerrain = terrain;
  }

  /**
   * Set up the terrain layer for the first time once the scene is loaded.
   */
  initialize() {
    const currId = TerrainSettings.getByName("CURRENT_TERRAIN");
    if ( currId ) {
      this.currentTerrain = this.sceneMap.terrainIds.get(currId);
    }

    if ( !this.currentTerrain ) {
      let pixelValue;
      [[pixelValue, this.currentTerrain]] = this.sceneMap;
    }
  }

  /**
   * Get the terrain data for a given pixel value.
   * @param {number} pixelValue
   * @returns {Terrain}
   */
  terrainForPixel(pixelValue) { return this.sceneMap.get(pixelValue); }

  /**
   * Get the terrain data for a given terrain id
   * @param {string} terrainId
   * @returns {Terrain}
   */
  terrainForId(terrainId) { return this.sceneMap.terrainIds.get(terrainId); }


  /**
   * Force the terrain id to be between 0 and the maximum value.
   * @param {number} id
   * @returns {number}
   */
  clampTerrainId(id) {
    id ??= 0;
    return Math.clamped(Math.round(id), 0, this.constructor.MAX_TERRAIN_ID);
  }

  /**
   * Clear terrain data in the scene.
   */
  clearData() {
    console.debug("I should be clearing terrain data for the scene...");
  }

  /**
   * Download terrain data from the scene.
   */
  downloadData() {
    console.debug("I should be downloading terrain data for the scene...");
  }

  /**
   * Undo application of terrain values in the scene.
   */
  undo() {
    console.debug("I should be undoing terrain data for the scene...");
  }

  /**
   * Import terrain data from an image file into the scene.
   */
  importFromImageFile() {
    console.debug("I should be importing terrain data for the scene...");
  }

}
