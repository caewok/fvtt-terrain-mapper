/* globals
CONFIG,
InteractionLayer,
mergeObject
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class TerrainLayer extends InteractionLayer {
  static MAX_TERRAIN_ID = Math.pow(2, 5) - 1;

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
