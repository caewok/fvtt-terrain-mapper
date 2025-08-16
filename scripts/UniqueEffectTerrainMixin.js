/* globals
CONFIG,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ICONS, MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { loadDefaultTerrainJSONs } from "./default_terrains.js";

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

      // Re-create the terrains as necessary.
      for ( const key of defaultMap.keys() ) { await CONFIG[MODULE_ID].Terrain.create(key); }

      // Add a default terrain folder to the Terrain Book.
      await Settings.addFolder({
        name: game.i18n.localize(`${MODULE_ID}.terrainbook.default-terrain-folder`),
        id: `${MODULE_ID}.defaults`,
        effects: [...defaultMap.keys()],
      });
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

      // Recreate the default effects.
      await this._initializeDefaultEffects();
    }

    /**
     * Remove this terrain from any folders.
     */
    async destroy() {
      await Settings.removeEffectFromAllFolders(this.uniqueEffectId);
      return super.destroy();
    }
  };
}
