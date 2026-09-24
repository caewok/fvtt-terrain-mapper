/* globals
canvas,
CONFIG,
CONST,
foundry,
game,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
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

Token Animate: Animation in and out

Token outside, moves through a region to another point outside:
Enter -> MoveIn -> MoveWithin -> Exit -> MoveOut -> AnimateIn -> AnimateOut

Token outside, moves to point within region:
Enter -> MoveIn -> MoveWithin -> AnimateIn

Token inside, moves to point outside region:
MoveWithin -> Exit -> MoveOut -> AnimateOut

Token inside, moves to point within region:
MoveWithin


Token above, moves into region via elevation change (same as outside --> inside)
Enter -> MoveIn -> MoveWithin

Token within, moves above region via elevation change
MoveWithin -> Exit -> MoveOut  (No animation!)

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

// TokenMovementData: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementData.html
// TokenMovementOptions: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementOptions.html
// TokenMovementSegmentData: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementSegmentData.html
// TokenMovementWaypoint: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementWaypoint.html
// TokenProcessedMovementWaypoint: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenProcessedMovementWaypoint.html

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
    return {
      dialog: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.dialog.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.dialog.hint`,
        initial: false
      }),
    };
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
    const data = event.data;
    console.debug(`Token ${data.token.name} moving into ${event.region.name}!`);
    if ( event.user !== game.user ) return;
    const tokenD = data.token;

    // Determine if the projected token movement is below the plateau.
    if ( !this.#movementInRequiresElevationChange(data.movement, tokenD) ) return;

    // ----- No async operations before this! -----
    const resumeMovement = tokenD.pauseMovement();

    // Await movement animation
    // When the browser tab is/becomes hidden, don't wait for the movement animation and
    // proceed immediately. Otherwise wait for the movement animation to complete.
    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    /*
    if ( tokenD.rendered && tokenD.object.movementAnimationPromise ) {
      await game.raceWithWindowHidden(tokenD.object.movementAnimationPromise);
    }
    */
    // tokenD.stopMovement();

    if ( this.dialog ) {
      const content = game.i18n.localize(targetElevation > tokenD.elevation ? `${MODULE_ID}.phrases.terrain-up` : `${MODULE_ID}.phrases.terrain-down`);
      const changeElevation = await foundry.applications.api.DialogV2.confirm({ content, rejectClose: false, modal: true });
      if ( !changeElevation ) return resumeMovement?.();
    }

    // See Prompt to change the level of the Token if it moves into the Region. in foundry.js
    const movement = data.movement;
    const targetElevation = this.topElevation;
    const newWaypoints = this.#insertElevatedMove(movement, targetElevation, tokenD);
    console.debug(`MovingIn|Moving Token ${data.token.name} to ${targetElevation}.`);

    await tokenD.move(newWaypoints, {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
      split: false,
    });
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
    if ( event.user !== game.user ) return;
    const data = event.data;
    const tokenD = data.token;
    console.debug(`Token ${data.token.name} moving within ${event.region.name}!`);

    // Determine if the projected token movement is below the plateau.
    if ( !this.#movementWithInRequiresElevationChange(data.movement, tokenD) ) return;

    // ----- No async operations before this! -----
    tokenD.pauseMovement();

    // Await movement animation
    // When the browser tab is/becomes hidden, don't wait for the movement animation and
    // proceed immediately. Otherwise wait for the movement animation to complete.
   if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    /*
    if ( tokenD.rendered && tokenD.object.movementAnimationPromise ) {
      await game.raceWithWindowHidden(tokenD.object.movementAnimationPromise);
    }
    */

    // Insert vertical move.
    const movement = data.movement;
    const targetElevation = this.topElevation;
    const newWaypoints = this.#insertElevatedMove(movement, targetElevation, tokenD);
    console.debug(`MovingWithin|Moving Token ${data.token.name} to ${targetElevation}.`);

    await tokenD.move(newWaypoints, {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
    });
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
     if ( event.user !== game.user ) return;
    const data = event.data;
    const tokenD = data.token;
    console.debug(`Token ${data.token.name} moving out of ${event.region.name}!`);

    // Determine if the projected token movement is below the plateau.
    if ( !this.#movementOutRequiresElevationChange(data.movement, tokenD) ) return;

    // ----- No async operations before this! -----
    tokenD.pauseMovement();

    // Await movement animation
    // When the browser tab is/becomes hidden, don't wait for the movement animation and
    // proceed immediately. Otherwise wait for the movement animation to complete.


    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    /*
    if ( tokenD.rendered && tokenD.object.movementAnimationPromise ) {
      await game.raceWithWindowHidden(tokenD.object.movementAnimationPromise);
    }
    */
    // tokenD.stopMovement();

    /*
    if ( this.dialog ) {
      const content = game.i18n.localize(targetElevation > tokenD.elevation ? `${MODULE_ID}.phrases.terrain-up` : `${MODULE_ID}.phrases.terrain-down`);
      const changeElevation = await foundry.applications.api.DialogV2.confirm({ content, rejectClose: false, modal: true });
      if ( !changeElevation ) return resumeMovement?.();
    }
    */

    // See Prompt to change the level of the Token if it moves into the Region. in foundry.js
    const movement = data.movement;
    const targetElevation = canvas.level.elevation.bottom;
    const newWaypoints = this.#insertElevatedMove(movement, targetElevation, tokenD, false);
    console.debug(`MovingOut|Moving Token ${data.token.name} to ${targetElevation}.`);

    await tokenD.move(newWaypoints, {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
      split: false,
    });
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

  /** @type {number<grid units>} */
  get topElevation() {
    let elevation = this.region.elevation.top;
    if ( !this.region.elevation.topInclusive ) elevation -= 1;
    return elevation;
  }

  /**
   * Create a new waypoint with a set elevation representing a vertical climb.
   * @param {TokenProcessedMovementWaypoint}
   * @returns {TokenMovementWaypoint} Keeps excess values, changing only as necessary.
   */
  static newElevationFromWaypoint(waypoint, elevation) {
    return { ...waypoint, elevation, action: "climb", explicit: true, intermediate: false, checkpoint: false, snapped: false };
  }

  /**
   * Is the proposed token movement consistent with the plateau elevation?
   * Accounts for the type of movement and the elevation.
   * @param {RegionMovement} movement        The movement passed from a ReginEvent (data.movement) object
   *   - @prop {RegionWaypoint} destination
   *   - @prop {object} pending
   *     - @prop {RegionWaypoint[]} pending.waypoints
   * @param {TokenDocument} tokenD           	The token doing the movement
   * @returns {boolean}
   */
  #movementInRequiresElevationChange(movement, tokenD) {
    // Every waypoint that is within the region should be at the target elevation unless
    // the movement type allows otherwise.
    // Flying: can be above. (Probably shouldn't happen for a plateau. Might happen for ramps, hills.)
    // Burrowing: can be below.

    const targetElevation = this.topElevation;
    const waypoints = [movement.destination, ...movement.pending.waypoints];
    const { terrainWalkActions, terrainFlightActions, terrainBurrowActions } = CONFIG[MODULE_ID];
    for ( const waypoint of waypoints ) {
      // If near the target elevation, we are fine.
      if ( waypoint.elevation.almostEqual(targetElevation) ) continue;

      // If below elevation and burrowing, we are fine.
      if ( waypoint.elevation < targetElevation && terrainBurrowActions.has(waypoint.action) ) continue;

      // If above elevation and flying, we are fine.
      if ( waypoint.elevation > targetElevation && terrainFlightActions.has(waypoint.action) ) continue;

      // If doing any sort of walking, we need to be at elevation. Anything else, we skip.
      if ( !terrainWalkActions.has(waypoint.action) ) continue;

      // Is this waypoint within the region?
      const ctr = tokenD.getCenterPoint(waypoint); // The returned point keeps the elevation.
      if ( !this.region.testPoint(ctr) ) continue;

      // "Walking" or equivalent and need to move ("climb") up.
      return true;
    }
    return false;
  }

  #movementWithInRequiresElevationChange(movement, tokenD) {
    // Last waypoint in the region should be at elevation unless
    // the movement type allows otherwise.
    // Flying: can be above. (Probably shouldn't happen for a plateau. Might happen for ramps, hills.)
    // Burrowing: can be below.

    const targetElevation = this.topElevation;
    const waypoints = [(movement.passed.waypoints.at(-1) || movement.destination), ...movement.pending.waypoints];
    const { terrainWalkActions, terrainFlightActions, terrainBurrowActions } = CONFIG[MODULE_ID];
    for ( const waypoint of waypoints.reverse() ) {
      // If not within region, skip.
      const ctr = tokenD.getCenterPoint(waypoint); // The returned point keeps the elevation.
      if ( !this.region.testPoint(ctr) ) continue;

      // If near the target elevation, we are fine.
      if ( waypoint.elevation.almostEqual(targetElevation) ) return false;

      // If below elevation and burrowing, we are fine.
      if ( waypoint.elevation < targetElevation && terrainBurrowActions.has(waypoint.action) ) return false;

      // If above elevation and flying, we are fine.
      if ( waypoint.elevation > targetElevation && terrainFlightActions.has(waypoint.action) ) return false;

      // If doing any sort of walking, we need to be at elevation. Anything else, we skip.
      if ( !terrainWalkActions.has(waypoint.action) ) return false;

      return true;

    }
    return true;
  }

  /**
   * Is the proposed token movement consistent with the plateau elevation?
   * Accounts for the type of movement and the elevation.
   * @param {RegionMovement} movement        The movement passed from a RegionEvent (data.movement) object
   *   - @prop {RegionWaypoint} destination
   *   - @prop {object} pending
   *     - @prop {RegionWaypoint[]} pending.waypoints
   * @param {TokenDocument} tokenD           	The token doing the movement
   * @returns {boolean}
   */
  #movementOutRequiresElevationChange(movement, tokenD) {
    // Every waypoint that is outside the region should be at the scene ground elevation unless
    // the movement type allows otherwise.
    // Flying: can be above. (Probably shouldn't happen for a plateau. Might happen for ramps, hills.)
    // Burrowing: can be below.

    const targetElevation = canvas.level.elevation.bottom;
    const waypoints = [movement.destination, ...movement.pending.waypoints];
    const { terrainWalkActions, terrainFlightActions, terrainBurrowActions } = CONFIG[MODULE_ID];
    for ( const waypoint of waypoints ) {
      // If near the target elevation, we are fine.
      if ( waypoint.elevation.almostEqual(targetElevation) ) continue;

      // If below elevation and burrowing, we are fine.
      if ( waypoint.elevation < targetElevation && terrainBurrowActions.has(waypoint.action) ) continue;

      // If above elevation and flying, we are fine.
      if ( waypoint.elevation > targetElevation && terrainFlightActions.has(waypoint.action) ) continue;

      // If doing any sort of walking, we need to be at elevation. Anything else, we skip.
      if ( !terrainWalkActions.has(waypoint.action) ) continue;

      // Is this waypoint within the region?
      const ctr = tokenD.getCenterPoint(waypoint); // The returned point keeps the elevation.
      if ( this.region.testPoint(ctr) ) continue;

      // "Walking" or equivalent and need to move ("climb") up.
      return true;
    }
    return false;
  }

  /**
   * For a given movement in or within, add elevated movement
   * @param {TokenMovementData} movement
   * @param {number} targetElevation          The plateau elevation to use
   * @returns {TokenMovementWaypoint[]}
   */
  #insertElevatedMove(movement, targetElevation, tokenD, moveIn = true) {
    // const waypoint = this.nearestXYSnapPoint(movement.destination, movement.pending.waypoints.at(0), tokenD);
    // See https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementWaypoint.html
    /*
    interface TokenMovementWaypoint {
        action: string;
        checkpoint: boolean;
        depth: number;
        elevation: number;
        explicit: boolean;
        height: number;
        level: string;
        shape: TokenShapeType;
        snapped: boolean;
        width: number;
        x: number;
        y: number;
    }
    */

    // Insert vertical move.
    const dest = { ...(movement.passed.waypoints.at(-1) || movement.destination) };
    const newWaypoints = [dest];

    // Current bug in FoundryVTT causes the points to snap when elevating straight up more than 1 grid square.
    // Can avoid by incrementing elevation more slowly.
    if ( targetElevation.strictlyGreaterThan(dest.elevation) ) {
      for ( let e = dest.elevation + canvas.grid.distance; e < targetElevation; e += canvas.grid.distance ) {
        newWaypoints.push(this.constructor.newElevationFromWaypoint(dest, e));
      }
    } else if ( targetElevation.strictlyLessThan(dest.elevation) ) {
      for ( let e = dest.elevation - canvas.grid.distance; e > targetElevation; e -= canvas.grid.distance ) {
        newWaypoints.push(this.constructor.newElevationFromWaypoint(dest, e));
      }
    }

    // Insert the final move to the target elevation.
    const elevatedDest = this.constructor.newElevationFromWaypoint(dest, targetElevation);
    const adjustedWaypoints = movement.pending.waypoints
            .filter(w => !w.intermediate)
            .map(w => {
              const newW = { ...w };
              const ctr = tokenD.getCenterPoint(w);
              if ( moveIn ^ !this.region.testPoint(ctr) ) newW.elevation = targetElevation;
              return newW;
            });
    newWaypoints.push(elevatedDest, ...adjustedWaypoints);
    return newWaypoints;
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
}

/*
tokenD = _token.document



waypoints = [
  { x: 2100, y: 1000, elevation: 0, snapped: true },
  { x: 2137, y: 927, elevation: 0 },
  { x: 2137, y: 927, elevation: 19 },
  { x: 2200, y: 800, elevation: 19, snapped: true },
]

tokenD.getCompleteMovementPath(waypoints)


waypoints = [
  { x: 2100, y: 1000, elevation: 0, snapped: true },
  { x: 2137, y: 927, elevation: 0, snapped: false },
  { x: 2137, y: 927, elevation: 2, snapped: false },
  { x: 2137, y: 927, elevation: 4, snapped: false },
  { x: 2137, y: 927, elevation: 6, snapped: false },
  { x: 2137, y: 927, elevation: 8, snapped: false },
  { x: 2137, y: 927, elevation: 10, snapped: false },
  { x: 2137, y: 927, elevation: 12, snapped: false },
  { x: 2137, y: 927, elevation: 14, snapped: false },
  { x: 2137, y: 927, elevation: 16, snapped: false },
  { x: 2137, y: 927, elevation: 18, snapped: false },
  { x: 2137, y: 927, elevation: 19, snapped: false },
  { x: 2200, y: 800, elevation: 19, snapped: true },
]

waypoints = [
  { x: 2100, y: 1000, elevation: 0, snapped: true },
  { x: 2137, y: 927, elevation: 0, snapped: false },
  { x: 2137, y: 927, elevation: 9, snapped: false },
  { x: 2137, y: 927, elevation: 18, snapped: false },
  { x: 2137, y: 927, elevation: 19, snapped: false },
  { x: 2200, y: 800, elevation: 19, snapped: true },
]



[
    {
        "x": 2294,
        "y": 900,
        "elevation": 0,
        "width": 1,
        "height": 1,
        "depth": 1,
        "shape": 4,
        "level": "defaultLevel0000",
        "action": "walk",
        "terrain": null,
        "snapped": false,
        "explicit": false,
        "checkpoint": true,
        "intermediate": false,
        "userId": "nx29hoGineoQv9Bs",
        "movementId": "dgNZyhfz70Qsr6TT",
        "subpathId": "dgNZyhfz70Qsr6TT",
        "cost": 5
    },
    {
        "x": 2300,
        "y": 900,
        "elevation": 19,
        "width": 1,
        "height": 1,
        "depth": 1,
        "shape": 4,
        "level": "defaultLevel0000",
        "action": "climb",
        "terrain": null,
        "snapped": false,
        "explicit": true,
        "checkpoint": false,
        "intermediate": false,
        "userId": "nx29hoGineoQv9Bs",
        "movementId": "dgNZyhfz70Qsr6TT",
        "subpathId": "dgNZyhfz70Qsr6TT",
        "cost": 5
    },
    {
        "x": 2300,
        "y": 900,
        "elevation": 19,
        "width": 1,
        "height": 1,
        "depth": 1,
        "shape": 4,
        "level": "defaultLevel0000",
        "action": "climb",
        "terrain": null,
        "snapped": false,
        "explicit": true,
        "checkpoint": false,
        "intermediate": false,
        "userId": "nx29hoGineoQv9Bs",
        "movementId": "dgNZyhfz70Qsr6TT",
        "subpathId": "dgNZyhfz70Qsr6TT",
        "cost": 5
    },
    {
        "x": 2200,
        "y": 900,
        "elevation": 19,
        "width": 1,
        "height": 1,
        "depth": 1,
        "shape": 4,
        "level": "defaultLevel0000",
        "action": "walk",
        "terrain": null,
        "snapped": true,
        "explicit": true,
        "checkpoint": true,
        "intermediate": false,
        "userId": "nx29hoGineoQv9Bs",
        "movementId": null,
        "subpathId": "dgNZyhfz70Qsr6TT",
        "cost": 5
    }
]
*/

