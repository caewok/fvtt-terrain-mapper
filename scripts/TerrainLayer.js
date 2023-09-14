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
import { getSetting, SETTINGS } from "./settings.js";

export class TerrainLayer extends InteractionLayer {

  /** @type {number} */
  static MAX_TERRAIN_ID = Math.pow(2, 5) - 1;

  /** @type {TerrainMap<number,Terrain>} */
  #terrainMap = Terrain.TERRAINS;

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

  /**
   * Pull terrain data from settings and initialize.
   */
  _initializeTerrains() {
    const terrainData = getSetting(SETTINGS.TERRAINS);
    Terrain.importFromJSON(terrainData);
  }

  /**
   * Get the terrain data for a given id.
   */
  terrainForId(id) { return this.#terrainMap.get(id); }

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
    console.debug("I should be clearing terrain data...");
  }

  /**
   * Download terrain data from the scene.
   */
  downloadData() {
    console.debug("I should be downloading terrain data...");
  }

  /**
   * Undo application of terrain values in the scene.
   */
  undo() {
    console.debug("I should be undoing terrain data...");
  }

  /**
   * Import terrain data from an image file into the scene.
   */
  importFromImageFile() {
    console.debug("I should be importing terrain data...");
  }

}
