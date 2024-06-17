/* globals
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ICONS, MODULE_ID } from "./const.js";

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

    /**
     * Default data required to be present in the base effect document.
     * @param {string} [activeEffectId]   The id to use
     * @returns {object}
     */
    static newDocumentData(activeEffectId) {
      const data = Base.newDocumentData.call(this, activeEffectId);
      data.name = game.i18n.localize(`${MODULE_ID}.phrases.new-terrain`);
      data.img = "icons/svg/hazard.svg";
      return data;
    }
  };
}
