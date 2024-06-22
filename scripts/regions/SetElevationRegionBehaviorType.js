/* globals
canvas,
CONST,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log, isFirstGM } from "../util.js";

export const PATCHES = {};
PATCHES.REGIONS = {};


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
 * @property {boolean} reset          When enabled, elevation will be reset to scene background on exit.
 */
export class SetElevationRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      elevation: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.elevation.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.elevation.hint`,
        initial: 0
      }),

      reset: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.reset.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.reset.hint`,
        initial: true
      })
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit
  };

  static async #onTokenEnter(event) {
    const data = event.data;
    log(`Token ${data.token.name} entering ${event.region.name}!`);
    if ( !isFirstGM() ) return;
    const tokenD = data.token;
    return tokenD.update({ elevation: this.elevation });
  }

  static async #onTokenExit(event) {
    if ( !isFirstGM() ) return;
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;
    log(`Token ${tokenD.name} exiting ${event.region.name}!`);
    if ( !this.reset ) return;

    // Get all terrains for this region.
    // const otherTerrains = getAllElevationTerrainsForToken(token);
    if ( tokenD.elevation > this.elevation ) return;
    return tokenD.update({ elevation: canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0 });
  }
}


/**
 * Hook preCreateRegionBehavior
 * Set the default elevation to the region top elevation if defined.
 * @param {Document} document                     The pending document which is requested for creation
 * @param {object} data                           The initial data object provided to the document creation request
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modify the creation request
 * @param {string} userId                         The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                        Explicitly return false to prevent creation of this Document
 */
function preCreateRegionBehavior(document, data, options, userId) {
  log("preCreateRegionBehavior");
  if ( data.type !== `${MODULE_ID}.setElevation` ) return;
  const topE = document.region.elevation.top;
  const elevation = topE ?? canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  document.updateSource({ ["system.elevation"]: elevation });
}

PATCHES.REGIONS.HOOKS = { preCreateRegionBehavior };


/**
 * Get all the terrains that should currently be applied to a token via elevation behaviors.
 * @param {Token } token
 * @returns {Set<Terrain>}
 */
function getAllElevationTerrainsForToken(token) {
  const Terrain = CONFIG[MODULE_ID].Terrain;
  const terrains = new Set();
  for ( const region of token.document.regions.values() ) {
    for ( const behavior of region.behaviors.values() ) {
      if ( behavior.type !== `${MODULE_ID}.setElevation` ) continue;
      behavior.system.terrains.forEach(id => {
        const terrain = Terrain._instances.get(id);
        if ( terrain ) terrains.add(terrain);
      });
    }
  }
  return terrains;
}
