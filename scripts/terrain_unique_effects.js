/* globals
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "./settings.js";
import { MODULE_ID, FLAGS } from "./const.js";
import { UniqueActiveEffect } from "./unique_effects/UniqueActiveEffect.js";
import { UniqueItemEffect } from "./unique_effects/UniqueItemEffect.js";
import { UniqueFlagEffect } from "./unique_effects/UniqueFlagEffect.js";
import { TerrainMixin } from "./UniqueEffectTerrainMixin.js";

export class TerrainActiveEffect extends TerrainMixin(UniqueActiveEffect) {

  /**
   * Search documents for all stored effects.
   * Child class may also include default effects not yet created.
   * This should not require anything to be loaded, so it can be run at canvas.init.
   * @returns {Object<string, string>} Effect id keyed to effect name
   */
  static _mapStoredEffectNames() {
    const map = {}
    const storageData = this._storageMapData;
    const items = game.items ?? game.data.items;
    const item = items.find(item => item.name === storageData.name);
    if ( !item ) return map;
    item.effects.forEach(effect => {
      const id = effect.flags?.[MODULE_ID]?.[FLAGS.UNIQUE_EFFECT.ID];
      if ( id ) map[id] = effect.name;
    });
    // Currently no default names, otherwise those would be valid as well.
    return map;
  }

}

export class TerrainItemEffect extends TerrainMixin(UniqueItemEffect) {
  /**
   * Data to construct an effect from a default source of data.
   * Pull terrains from a compendium, if any.
   */
  static async defaultEffectData(uniqueEffectId) {
    const data = await UniqueItemEffect.defaultEffectData.call(this, uniqueEffectId);
    if ( !data ) return;

    const pack = game.packs.get(`${MODULE_ID}.${MODULE_ID}_items_${game.system.id}`);
    if ( !pack ) return;

    const compendiumData = await pack.getDocument(uniqueEffectId);
    if ( !compendiumData ) return;

    foundry.utils.mergeObject(data, compendiumData);
    return data;
  }

  /**
   * Obtain unique effect ids for all default effects that should be instantiated.
   * @returns {Set<string>}
   */
  static async defaultEffectIds() {
    const ids = new Set();
    const pack = game.packs.get(`${MODULE_ID}.${MODULE_ID}_items_${game.system.id}`);
    if ( !pack ) return ids;
    const index = await pack.getIndex({ fields: "_id" });
    index.forEach(idx => ids.add(idx._id));
    return ids;
  }

    /**
   * Search documents for all stored effects.
   * Child class may also include default effects not yet created.
   * This should not require anything to be loaded, so it can be run at canvas.init.
   * @returns {Object<string, string>} Effect id keyed to effect name
   */
  static _mapStoredEffectNames() {
    const map = {}
    const items = game.items ?? game.data.items;
    items.forEach(item => {
      const id = item.flags?.[MODULE_ID]?.[FLAGS.UNIQUE_EFFECT.ID];
      if ( id ) map[id] = item.name;
    });

    // Currently no default names, otherwise those would be valid as well.
    return map;
  }
}

export class TerrainFlagEffect extends TerrainMixin(UniqueFlagEffect) {
  /**
   * Search documents for all stored effects.
   * Child class may also include default effects not yet created.
   * This should not require anything to be loaded, so it can be run at canvas.init.
   * @returns {Object<string, string>} Effect id keyed to effect name
   */
  static _mapStoredEffectNames() {
    const map = {}
    const items = Settings._getStorageValue(this.settingsKey);
    items.forEach(item => {
      const id = item.flags?.[MODULE_ID]?.[FLAGS.UNIQUE_EFFECT.ID];
      if ( id ) map[id] = item.name;
    });

    // Currently no default names, otherwise those would be valid as well.
    return map;
  }

}
