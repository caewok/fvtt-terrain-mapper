/* globals
CONFIG,
InteractionLayer,
mergeObject
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class TerrainLayer extends InteractionLayer {
  /** @overide */
  static get layerOptions() {
    return mergeObject(super.layerOptions, {
      name: "Terrain"
    });
  }

  /**
   * Add the layer so it is accessible in the console.
   */
  static register() {
    CONFIG.Canvas.layers.terrain = { group: "primary", layerClass: TerrainLayer };
  }
}
