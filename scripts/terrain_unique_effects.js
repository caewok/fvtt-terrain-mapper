/* globals
CONFIG,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { UniqueActiveEffect } from "./unique_effects/UniqueActiveEffect.js";
import { UniqueItemEffect } from "./unique_effects/UniqueItemEffect.js";
import { UniqueFlagEffect } from "./unique_effects/UniqueFlagEffect.js";
import { TerrainMixin } from "./UniqueEffectTerrainMixin.js";
import { loadDefaultTerrainJSONs } from "./default_terrains.js";

export class TerrainActiveEffect extends TerrainMixin(UniqueActiveEffect) {

  /**
   * Initialize default effects by adding the document(s) to the storage map.
   */
  static async _initializeDefaultEffects() {
    if ( !CONFIG[MODULE_ID].defaultTerrainJSONs.length ) return;
    const defaultMap = await loadDefaultTerrainJSONs(CONFIG[MODULE_ID].defaultTerrainJSONs);
    const promises = [];
    defaultMap.forEach(data => {
      data.name = game.i18n.localize(data.name);
      promises.push(this._createNewDocument(data));
    });
    await Promise.allSettled(promises);
  }

  /**
   * Reset default effects by removing the existing ids and re-adding.
   */
  static async _resetDefaultEffects() {
    if ( !CONFIG[MODULE_ID].defaultTerrainJSONs.length ) return;
    const defaultMap = await loadDefaultTerrainJSONs(CONFIG[MODULE_ID].defaultTerrainJSONs);

    // Delete existing.
    for ( const key of defaultMap.keys() ) {
      const terrain = this._instances.get(key);
      if ( !terrain ) continue;
      await terrain._deleteDocument();
    }

    const promises = [];
    defaultMap.forEach(data => {
      data.name = game.i18n.localize(data.name);
      promises.push(this._createNewDocument(data));
    });
    await Promise.allSettled(promises);

    // Re-create the terrains as necessary.
    for ( const key of defaultMap.keys() ) { await CONFIG[MODULE_ID].Terrain.create(key); }
  }

}

export class TerrainItemEffect extends TerrainMixin(UniqueItemEffect) {}

export class TerrainFlagEffect extends TerrainMixin(UniqueFlagEffect) {}

export class TerrainPF2E extends TerrainItemEffect {

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
