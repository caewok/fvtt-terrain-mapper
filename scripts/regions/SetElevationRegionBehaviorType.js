/* globals
CONST,
foundry,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log, isFirstGM } from "../util.js";
import { ElevationHandler } from "../ElevationHandler.js";

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


Token outside, moves to point within region:
PreMove –> Enter -> MoveIn -> Move

Token inside, moves to point outside region:
PreMove -> Exit -> Move -> MoveOut

Token inside, moves to point within region:
PreMove -> Move

Token outside, moves through a region to another point outside:
PreMove -> Move

Token above, moves into region via elevation change (same as outside --> inside)
PreMove –> Enter -> MoveIn -> Move

Token within, moves above region via elevation change
PreMove -> Exit -> Move -> MoveOut

*/

/**
 * @typedef RegionPathWaypoint extends RegionMovementWaypoint
 * RegionMovementWaypoint with added features to describe its position along a segment and the regions encountered
 * @prop {object} regions
 *   - @prop {Set<Region>} enter    All regions entered at this location; the region contains this point but not the previous
 *   - @prop {Set<Region>} exit     All regions exited at this location; the region contains this point but not the next
 *   - @prop {Set<Region>} move     All regions were already entered at the start
 * @prop {number} dist2             Distance squared to the start
 * @prop {RegionMovementWaypoint} start   Starting waypoint
 */

/**
 * Region behavior to add terrain to token.
 * @property {number} elevation       The elevation at which to set the token
 * @property {number} floor           The elevation at which to reset the token when leaving the region; default scene background
 * @property {number} rampStepHeight  The vertical size, in grid units, of ramp elevation increments
 * @property {number} rampDirection   The direction of incline for the ramp, in degrees
 * @property {boolean} reset          When enabled, elevation will be reset to floor on exit
 * @property {FLAGS.REGION.CHOICES} algorithm       How elevation change should be handled. plateau, ramp, stairs
 */
export class SetElevationRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      algorithm: new foundry.data.fields.StringField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.algorithm.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.algorithm.hint`,
        initial: FLAGS.SET_ELEVATION_BEHAVIOR.CHOICES.ONE_WAY,
        choices: FLAGS.SET_ELEVATION_BEHAVIOR.LABELS
      }),

      elevation: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.elevation.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.elevation.hint`,
        initial: 0
      }),

      floor: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.floor.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.floor.hint`,
        initial: () => {
          return ElevationHandler.sceneFloor;
        }
      }),
    }
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
  };

  static async #onTokenEnter(event) {
    const data = event.data;
    log(`Token ${data.token.name} entering ${event.region.name}!`);
    if ( !isFirstGM() ) return;

    // TODO: Stairs

    const tokenD = data.token;
    return tokenD.update({ elevation: this.elevation });
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
function preCreateRegionBehavior(document, data, _options, _userId) {
  log("preCreateRegionBehavior");
  if ( data.type !== `${MODULE_ID}.setElevation` ) return;
  const topE = document.region.elevation.top;
  const elevation = topE ?? ElevationHandler.sceneFloor;
  const floor = ElevationHandler.sceneFloor;
  document.updateSource({ ["system.elevation"]: elevation, ["system.floor"]: floor });
}

PATCHES.REGIONS.HOOKS = { preCreateRegionBehavior };

