/* globals
RegionBehaviorType
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { Terrain } from "../Terrain.js";
import { log } from "../util.js";
import { TerrainRegionBehaviorType } from "./TerrainRegionBehaviorType.js";


/* Move In vs Enter
https://ptb.discord.com/channels/170995199584108546/1184176344276406292/1243510660550361138

Move In/Out: Triggers only if the token enters or exits the region by movement (changes of x, y, or elevation).

Enter/Exit: Triggers when moved in/out and ...
when the region boundary changes such that it now contains/no longer contains the token,
when the token is created/deleted within the area of the region
when a behavior becomes active/inactive, in which case the event is triggered only for this behavior and not others.

Tokens Move In: You'll find a couple of new behaviors for Scene Regions that differ slightly from Token Enter and Token Exit,
providing subtle but important differences. Token Enter or Exit should be used in cases where you want your behavior to trigger
regardless of how a token entered or left the region. Token Move In or Token Move Out should be used in cases where you want
the assigned behavior to trigger explicitly as a result of a user dragging, using their arrow keys, or moving their token along
a path to get into the region. "Why is this necessary?" You might ask. Do you like infinitely looping teleportation?
Because that is how you get infinitely looping teleportation.
*/

/**
 * Region behavior to add terrain to token.
 * @property {number} elevation       The elevation at which to set the token
 * @property {boolean} doNotReset     When enabled, elevation will not be reset to scene background on exit.
 */
export class SetElevationRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      elevation: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.elevation.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.elevation.hint`,
        initial: 0,
        step: 1
      }),

      doNotReset: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.doNotReset.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.doNotReset.hint`
      })
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn,
    [CONST.REGION_EVENTS.TOKEN_MOVE_OUT]: this.#onTokenMoveOut,
    [CONST.REGION_EVENTS.TOKEN_PRE_MOVE]: this.#onTokenPreMove
  };

  async _handleRegionEvent(event) {
    log("AddTerrainRegionBehaviorType|Set elevation", event, this);

    // Confirm token is present.
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;
  }

  static async #onTokenMoveIn(event) {
    console.log(`Token ${event.data.token} moving in!`);
  }

  static async #onTokenMoveOut(event) {
    console.log(`Token ${event.data.token} moving out!`);
  }

  static async #onTokenPreMove(event) {
    console.log(`Token ${event.data.token} premove!`);
  }

}
