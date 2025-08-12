/* globals
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { log, isFirstGM } from "../util.js";
import { TerrainRegionBehaviorType } from "./TerrainRegionBehaviorType.js";

/**
 * Region behavior to add terrain to token.
 * @property {Set<string>} terrains   The terrain ids for terrains to be added
 * @property {boolean} duplicates     Whether duplicate terrains are allowed
 * @property {boolean} removeOther    Whether to remove all other terrains
 * @property {boolean} secret         Whether to hide this terrain from users
 */
export class AddTerrainRegionBehaviorType extends TerrainRegionBehaviorType {
  static defineSchema() {
    return {
      events: this._createEventsField(),
      terrains: this._createTerrainsField(`${MODULE_ID}.behavior.types.add-terrain.fields.terrain.hint`),
      removeOther: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.add-terrain.fields.removeOther.name`,
        hint: `${MODULE_ID}.behavior.types.add-terrain.fields.removeOther.hint`
      }),
      secret: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.add-terrain.fields.secret.name`,
        hint: `${MODULE_ID}.behavior.types.add-terrain.fields.secret.hint`
      })
    };
  }

  async _handleRegionEvent(event) {
    log("AddTerrainRegionBehaviorType|Add terrain", event, this);
    if ( !isFirstGM() ) return;

    // Confirm terrain and token are present.
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;

    const Terrain = CONFIG[MODULE_ID].Terrain;
    const terrainsToAdd = new Set([...this.terrains].map(id => Terrain._instances.get(id)).filter(t => Boolean(t)));
    if ( !terrainsToAdd.size ) return;

    // Remove the old terrains first (otherwise add will remove other terrains already added).
    // Only remove terrains that we are not adding!
    const currTerrains = new Set(Terrain.allOnToken(token));
    if ( this.removeOther ) {
      const toRemove = currTerrains.difference(terrainsToAdd);
      for ( const terrain of toRemove ) await terrain.removeFromToken(token);
    }

    // Add terrains, possibly allowing duplicates.
    for ( const terrain of terrainsToAdd ) await terrain.addToToken(token);
  }
}
