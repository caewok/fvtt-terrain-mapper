/* globals
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ICONS } from "./const.js";

/**
 * A mixin which extends the UniqueEffect with specialized terrain behaviors
 * @category - Mixins
 * @param {AbstractUniqueEffect} Base         The base class mixed with terrain features
 * @returns {Terrain}                         The mixed Terrain class definition
 */
export function TerrainMixin(Base) {
  return class Terrain extends Base {
    /**
     * Alias
     * Test if a token has this terrain already.
     * @param {Token} token
     * @returns {boolean}
     */
    tokenHasTerrain(token) { return this.isOnToken(token); }

    /** @type {string} */
    static type = "Terrain";

    /** @type {object} */
    static get _storageMapData() {
      return {
        name: "Terrains",
        img: ICONS.MODULE,
        type: "base",
      };
    }
  };
}
