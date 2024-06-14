/* globals
Application,
foundry,
isEmpty,
game,
saveDataToFile
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "./settings.js";
import { MODULE_ID, ICONS, FLAGS } from "./const.js";
import { UniqueActiveEffect } from "./unique_effects/UniqueActiveEffect.js";
import { UniqueItemEffect } from "./unique_effects/UniqueItemEffect.js";
import { UniqueFlagEffect } from "./unique_effects/UniqueFlagEffect.js";
import { TerrainMixin } from "./UniqueEffectTerrainMixin.js";

export class TerrainActiveEffect extends TerrainMixin(UniqueActiveEffect) {


}

export class TerrainItemEffect extends TerrainMixin(UniqueItemEffect) {
  /**
   * Data to construct an effect from a default source of data.
   * Pull terrains from a compendium, if any.
   */
  static async defaultEffectData(uniqueEffectId) {
    const data = await this.defaultEffectData(uniqueEffectId);
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
}

export class TerrainFlagEffect extends TerrainMixin(UniqueFlagEffect) {}
