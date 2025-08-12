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
 * Region behavior to remove terrain from a token.
 * @property {string} terrain     The terrain id
 * @property {}
 */
export class RemoveTerrainRegionBehaviorType extends TerrainRegionBehaviorType {
  static defineSchema() {
    return {
      events: this._createEventsField(),
      terrains: this._createTerrainsField(`${MODULE_ID}.behavior.types.remove-terrain.fields.terrain.hint`),
      keepSelected: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.remove-terrain.fields.keepSelected.name`,
        hint: `${MODULE_ID}.behavior.types.remove-terrain.fields.keepSelected.hint`
      })
    };
  }

  async _handleRegionEvent(event) {
    log("RemoveTerrainRegionBehaviorType|Remove terrain", event, this);
    if ( !isFirstGM() ) return;

    // Confirm terrain and token are present.
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;

    // Remove all if terrains is empty.
    const Terrain = CONFIG[MODULE_ID].Terrain;
    if ( !this.terrains.size && !this.keepSelected ) return Terrain.removeAllFromToken(token);

    // Determine which terrains to remove.
    const terrains = new Set([...this.terrains].map(id => Terrain._instances.get(id)).filter(t => Boolean(t)));
    let toRemove = terrains;
    if ( this.keepSelected ) {
      const currTerrains = new Set(Terrain.allOnToken(token));
      toRemove = currTerrains.difference(terrains);
    }
    for ( const terrain of toRemove ) await terrain.removeFromToken(token);
  }
}
