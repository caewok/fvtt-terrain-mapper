/* globals
canvas,
CONFIG,
CONST,
game,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log } from "../util.js";
import { ElevatedPoint } from "../geometry/3d/ElevatedPoint.js";

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
 * @property {FLAGS.REGION.CHOICES} algorithm       How elevation change should be handled. plateau, ramp, stairs
 */
export class StairsRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      algorithm: new foundry.data.fields.StringField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.algorithm.name`,
        initial: FLAGS.STAIRS_BEHAVIOR.CHOICES.ONE_WAY,
        choices: FLAGS.STAIRS_BEHAVIOR.LABELS,
        blank: false,
        required: true
      }),

      elevation: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.elevation.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.elevation.hint`,
        initial: 0
      }),

      floor: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.floor.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.floor.hint`,
        initial: () => {
          return canvas.scene[MODULE_ID].sceneFloor;
        }
      }),

      strict: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.strict.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.strict.hint`,
        initial: false
      }),

      dialog: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.dialog.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.dialog.hint`,
        initial: false
      }),

      resetOnExit: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.resetOnExit.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.resetOnExit.hint`,
        initial: false
      }),

    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn,
    [CONST.REGION_EVENTS.TOKEN_MOVE_OUT]: this.#onTokenMoveOut,
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
    const data = event.data;
    log(`Token ${data.token.name} moving into ${event.region.name}!`);
    if ( event.user !== game.user ) return;
    const tokenD = data.token;
    let takeStairs = !this.strict || tokenD.elevation === this.elevation || tokenD.elevation === this.floor;

    // Determine the target elevation.
    let targetElevation;
    if ( this.algorithm === FLAGS.STAIRS_BEHAVIOR.CHOICES.ONE_WAY ) targetElevation = this.elevation;
    else {
      // Stairs
      const midPoint = this.floor + ((this.elevation - this.floor) * 0.5);
      targetElevation = tokenD.elevation <= midPoint ? this.elevation : this.floor;
    }
    takeStairs &&= targetElevation !== tokenD.elevation;
    if ( !takeStairs ) return;

    // ----- No async operations before this! -----
    const resumeMovement = tokenD.pauseMovement();

    // Await movement animation
    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    if ( this.dialog ) {
      const content = game.i18n.localize(targetElevation > tokenD.elevation ? `${MODULE_ID}.phrases.stairs-go-up` : `${MODULE_ID}.phrases.stairs-go-down`);
      takeStairs = await foundry.applications.api.DialogV2.confirm({ content, rejectClose: false, modal: true });
      if ( !takeStairs ) return resumeMovement ? resumeMovement() : undefined;
    }
    tokenD.stopMovement();

    // Insert vertical move.
    // If snapping and the token center for the snap is within the region, use it instead.
    const movement = data.movement;
    const waypoint = this.nearestXYSnapPoint(movement.destination, movement.pending.waypoints.at(0), tokenD);
    waypoint.elevation = targetElevation;
    waypoint.action = this.stairsTokenAction;
    waypoint.cost = 0;
    waypoint.explicit = true;
    waypoint.intermediate = false;
    waypoint.checkpoint = false;

    // const adjustedWaypoints = movement.pending.waypoints
//             .filter((w) => !w.intermediate)
//             .map((w) => ({ ...w, elevation: chosenElevation }));

    await tokenD.move([movement.passed.waypoints.at(-1), waypoint], {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
    });


  }

  get stairsTokenAction() {
    const actions = Object.entries(CONFIG.Token.movement.actions);
    let out = actions.find(([_key, a]) => a.teleport && a.visualize);
    if ( !out ) out = actions.find(([_key, a]) => a.teleport);
    if ( !out ) out = actions[0];
    return out[0];
  }

  /**
   * Nearest snap point along a path that is still within the region.
   * Attempts first the current point, then moves along the line toward the next point.
   * If next point is close enough, it will try that. If all fails, returns the current point.
   * @param {Point} currPoint
   * @param {Point} nextPoint
   * @param {TokenDocument} tokenD         Token for which the snapping would apply
   */
  nearestXYSnapPoint(currPoint, nextPoint, tokenD) {
    currPoint = ElevatedPoint.fromObject(currPoint);
    let snap = tokenD.getSnappedPosition(currPoint);
    if ( snap.x.almostEqual(currPoint.x) && snap.y.almostEqual(currPoint.y) ) return currPoint;
    snap.elevation = currPoint.elevation;
    if ( this.region.testPoint(snap) ) return snap;
    if ( !nextPoint ) return currPoint;

    nextPoint = ElevatedPoint.fromObject(nextPoint);
    const other = PIXI.Point.distanceSquaredBetween(currPoint, nextPoint) < canvas.grid.size ** 2
      ? nextPoint : currPoint.towardsPoint(nextPoint, canvas.grid.size);
    snap = tokenD.getSnappedPosition(other);
    snap.elevation = other.elevation;
    if ( this.region.testPoint(snap) ) return snap;
    return currPoint;
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
    const data = event.data;
    log(`Token ${data.token.name} moving out of ${event.region.name}!`);
    if ( event.user !== game.user ) return;
    const tokenD = data.token;
    const groundElevation = canvas.scene[MODULE_ID].sceneFloor;
    let resetToGround = this.resetOnExit
      && tokenD.elevation !== groundElevation
      && (!this.strict || (tokenD.elevation === this.elevation || tokenD.elevation === this.floor));

    if ( !resetToGround ) return;

    // ----- No async operations before this! -----
    const resumeMovement = tokenD.pauseMovement();

    // Await movement animation
    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    // Confirm with user.
    if ( this.dialog && resetToGround ) {
      const content = game.i18n.localize(`${MODULE_ID}.phrases.resetOnExit`);
      resetToGround = await foundry.applications.api.DialogV2.confirm({ content, rejectClose: false, modal: true });
      if ( !resetToGround ) return resumeMovement ? resumeMovement() : undefined;
    }

    tokenD.stopMovement();

    // Insert vertical move.
    // If snapping and the token center for the snap is within the region, use it instead.
    const movement = data.movement;
    const waypoint = structuredClone(movement.destination);
    waypoint.elevation = groundElevation;
    waypoint.action = this.stairsTokenAction;
    waypoint.cost = 0;
    waypoint.explicit = true;
    waypoint.intermediate = false;
    waypoint.checkpoint = false;

    // const adjustedWaypoints = movement.pending.waypoints
//             .filter((w) => !w.intermediate)
//             .map((w) => ({ ...w, elevation: chosenElevation }));

    const adjustedWaypoints = movement.pending.waypoints
        .filter((w) => !w.intermediate)
        .map((w) => ({ ...w, elevation: groundElevation }));
    await tokenD.move([movement.passed.waypoints.at(-1), waypoint, ...adjustedWaypoints], {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
    });
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
  const elevation = topE ?? canvas.scene[MODULE_ID].sceneFloor;
  const floor = canvas.scene[MODULE_ID].sceneFloor;
  document.updateSource({ "system.elevation": elevation, "system.floor": floor });
}

PATCHES.REGIONS.HOOKS = { preCreateRegionBehavior };

