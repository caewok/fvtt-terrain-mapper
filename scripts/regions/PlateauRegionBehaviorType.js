/* globals
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export const PATCHES = {};
PATCHES.REGIONS = {};


/* Move In vs Enter
https://ptb.discord.com/channels/170995199584108546/1184176344276406292/1243510660550361138

Move In/Out: Triggers only if the token enters or exits the region by movement (changes of x, y, or elevation).

Enter/Exit: Triggers when moved in/out and ...
when the region boundary changes such that it now contains/no longer contains the token,
when the token is created/deleted within the area of the region
when a behavior becomes active/inactive, in which case the event is triggered only for this behavior and not others.

Tokens Move In: You'll find a couple of new behaviors for Scene Regions that differ slightly from Token Enter
and Token Exit, providing subtle but important differences. Token Enter or Exit should be used in cases where
you want your behavior to triggerregardless of how a token entered or left the region. Token Move In or
Token Move Out should be used in cases where you want the assigned behavior to trigger explicitly as a result
of a user dragging, using their arrow keys, or moving their token along a path to get into the region.
"Why is this necessary?" You might ask. Do you like infinitely looping teleportation?
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
 *   - @prop {Set<Region>} enter    All regions entered at this location;
 *                                  the region contains this point but not the previous
 *   - @prop {Set<Region>} exit     All regions exited at this location;
 *                                  the region contains this point but not the next
 *   - @prop {Set<Region>} move     All regions were already entered at the start
 * @prop {number} dist2             Distance squared to the start
 * @prop {RegionMovementWaypoint} start   Starting waypoint
 */

/**
 * Region behavior to set token to specific top/bottom elevation.
 * @property {number} elevation       The elevation at which to set the token
 * @property {number} floor           The elevation at which to reset the token when leaving the region
 *                                    Defaults to scene elevation
 * @property {number} rampStepHeight  The vertical size, in grid units, of ramp elevation increments
 * @property {number} rampDirection   The direction of incline for the ramp, in degrees
 * @property {boolean} reset          When enabled, elevation will be reset to floor on exit
 * @property {FLAGS.REGION.TERRAIN.CHOICES} algorithm       How elevation change should be handled. plateau, ramp, stairs
 */
export class PlateauTerrainRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {};
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn,
    [CONST.REGION_EVENTS.TOKEN_MOVE_OUT]: this.#onTokenMoveOut,
    [CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN]: this.#onTokenMoveWithin,
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit,
    [CONST.REGION_EVENTS.TOKEN_ANIMATE_IN]: this.#onTokenAnimateIn,
    [CONST.REGION_EVENTS.TOKEN_ANIMATE_OUT]: this.#onTokenAnimateOut,
  };


  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenMoveIn(event) {
    console.debug(`onTokenMoveIn: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenMoveOut(event) {
    console.debug(`onTokenMoveOut: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenMoveWithin(event) {
    console.debug(`onTokenMoveWithin: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenEnter(event) {
    console.debug(`onTokenEnter: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenExit(event) {
    console.debug(`onTokenExit: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenAnimateIn(event) {
    console.debug(`onTokenAnimateIn: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenAnimateOut(event) {
    console.debug(`onTokenAnimateOut: ${event.data.token.name}`);
  }
}

