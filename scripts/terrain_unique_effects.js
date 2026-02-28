/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { UniqueActiveEffect } from "./unique_effects/UniqueActiveEffect.js";
import { UniqueItemEffect } from "./unique_effects/UniqueItemEffect.js";
import { UniqueFlagEffect } from "./unique_effects/UniqueFlagEffect.js";
import { TerrainMixin } from "./UniqueEffectTerrainMixin.js";


export class TerrainActiveEffect extends TerrainMixin(UniqueActiveEffect) {}

export class TerrainItemEffect extends TerrainMixin(UniqueItemEffect) {}

export class TerrainFlagEffect extends TerrainMixin(UniqueFlagEffect) {}

export class TerrainPF2E extends TerrainItemEffect {

  /**
   * Override to use PF2e's "effect" item type for the flag storage document.
   */
  static get _flagStorageData() {
    return {
      name: "Unique Active Effects",
      img: "icons/svg/ruins.svg",
      type: "effect",
    };
  }

  /**
   * Default data required to be present in the base effect document.
   * @param {string} [activeEffectId]   The id to use
   * @returns {object}
   */
  static newDocumentData(activeEffectId) {
    const data = TerrainItemEffect.newDocumentData.call(this, activeEffectId);
    data.type = "effect";
    return data;
  }
}
