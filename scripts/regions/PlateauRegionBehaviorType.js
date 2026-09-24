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

Things about these events that the design below depends on (all verified in foundry.mjs):

1. Movement is split into segments at region boundaries. Events fire after each segment, with the token
   already at the end of that segment (`movement.passed.waypoints.at(-1)`) and the rest of the path in
   `movement.pending.waypoints`.

2. MOVE_WITHIN is *also* sent at the position where a token leaves the region
   (see TokenDocument.#onUpdateHandleMoveWithinRegionEvents). At that moment `token.regions` no longer
   contains the region, so MOVE_WITHIN and MOVE_OUT both fire for the same segment.

3. `token.move()` starts a brand new, unchained movement, which stops the paused one.
   It does not "modify" the paused movement; the new path must contain everything still to be walked.

4. The event handlers are not awaited by the movement workflow. The movement only stays put if
   `pauseMovement()` is called synchronously, before the first `await`.
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
 * Region behavior that makes a region act as plateau terrain for walking tokens.
 * - Entering (moving in): the token climbs to the top of the region.
 * - Moving within: the token stays at the top of the region.
 * - Leaving (moving out): the token drops to the ground (base elevation of its level).
 * Flying and burrowing tokens are exempt (see CONFIG[MODULE_ID].terrain*Actions).
 *
 * The three events all funnel into one handler. That handler:
 *   1. Synchronously decides whether the remaining path needs any change (pure function of the event data).
 *      If not, it does nothing at all, so it never pauses movement unnecessarily.
 *   2. If a change is needed, pauses the movement (synchronously) using a keyed pause.
 *   3. Waits for the animation, then re-validates that the world still looks the way it did at (1).
 *   4. Issues exactly one `move()` with the fully corrected remaining path.
 *   5. If it did not replace the paused movement for any reason, resumes it.
 *
 * @property {boolean} dialog   Ask before changing elevation when entering/leaving. When enabled,
 *                              MOVE_WITHIN no longer corrects elevation on its own.
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
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMove,
    [CONST.REGION_EVENTS.TOKEN_MOVE_OUT]: this.#onTokenMove,
    [CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN]: this.#onTokenMove,
  };

  /**
   * Loop breaker. Maps the id of a movement (the id of the first movement of a chain) to the set of
   * corrections already issued for that lineage. A correction is identified by the event, the position and
   * elevation it started from, and the elevation it wanted. If the same correction is requested twice in one
   * lineage, the corrections are not converging (e.g., the token keeps getting snapped back across the region
   * boundary, or a wall/surface blocks the vertical move) and we stop instead of looping forever.
   * @type {Map<string, Set<string>>}
   */
  static #lineages = new Map();

  /**
   * Cap on how many corrective vertical waypoints are generated for a single climb or drop.
   * @type {number}
   */
  static MAX_VERTICAL_STEPS = 50;

  /**
   * Movement action used for the corrective vertical waypoints.
   */
  static VERTICAL_ACTION = "climb";

  // ----- NOTE: Event handling ----- //





  /**
   * Handle TOKEN_MOVE_IN, TOKEN_MOVE_OUT, and TOKEN_MOVE_WITHIN
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   * @this {PlateauTerrainRegionBehaviorType}
   */
  static async #onTokenMove(event) {
    if ( !event.user.isSelf ) return;
    const { token: tokenD, movement } = event.data;
    if ( !movement ) return;
    console.debug(`Token ${event.data.token.name} ${event.name} of ${event.region.name}!`);

    // ----- No async operations before this! -----
    // The movement workflow does not wait for this handler. It continues the movement on
    // the next tick unless the movement is already paused.
    const plan = this.#planCorrection(event.name, tokenD, movement);
    if ( !plan ) return;

    const lineages = PlateauTerrainRegionBehaviorType.#lineages;
    const rootId = movement.chain.at(0) ?? movement.id;
    const seen = lineages.get(rootId) ?? new Set();
    if ( seen.has(plan.signature) ) {
      console.warn(`${MODULE_ID}|Plateau correction for ${tokenD.name} was already attempted from this state; not retrying.`, plan.signature);
      return;
    }

    // Keyed pause, like the core Teleport behavior. Several behaviors can pause the same movement, and the
    // movement resumes only when every key is resumed. The key must be unique per behavior.
    const key = this.parent.uuid;
    const paused = tokenD.pauseMovement(key) !== null;

    try {
      // Wait for the animation of the segment that just finished. When the browser tab is hidden,
      // the animation is not awaited.
      if ( tokenD.rendered && tokenD.object?.movementAnimationPromise ) {
        await game.raceWithWindowHidden(tokenD.object.movementAnimationPromise);
      }

      // Optionally ask (enter/exit only).
      if ( this.dialog && plan.confirm ) {
        const content = game.i18n.localize(plan.target > plan.start.elevation
          ? `${MODULE_ID}.phrases.terrain-up` : `${MODULE_ID}.phrases.terrain-down`);
        const change = await foundry.applications.api.DialogV2.confirm({ content, rejectClose: false, modal: true });
        if ( !change ) return;
      }

      // Nothing computed before the awaits can be trusted. Check again.
      if ( !this.#isCurrent(event.name, tokenD, movement, paused) ) return;

      // Issue the one correction. A fresh id lets the follow-up events be traced to this lineage.
      const id = foundry.utils.randomID();
      seen.add(plan.signature);
      lineages.delete(rootId);
      lineages.set(id, seen);
      if ( lineages.size > 100 ) lineages.delete(lineages.keys().next().value);

      console.debug(`${MODULE_ID}|${event.name}: moving ${tokenD.name} from elevation ${plan.start.elevation} to ${plan.target}.`);
      // `updateOptions` is on token.movement (TokenMovementData), not on the event's movement operation.
      const { animate, animation, pan } = tokenD.movement.updateOptions ?? {};
      await tokenD.move(plan.waypoints, {
        id,
        split: false,
        method: movement.method,
        animate,
        animation,
        pan,
        autoRotate: movement.autoRotate,
        showRuler: movement.showRuler,
        constrainOptions: movement.constrainOptions,
        terrainOptions: movement.terrainOptions,
        measureOptions: movement.measureOptions
      });
    } catch ( err ) {
      console.error(err);
    } finally {
      // If the paused movement was not replaced, do not leave the token frozen.
      const current = tokenD.movement;
      if ( paused && (current.id === movement.id) && (current.state === "paused") ) {
        tokenD.resumeMovement(movement.id, key);
      }
    }
  }

  /**
   * Is the token, after any awaits, still in the situation the event described?
   * @param {string} eventName
   * @param {TokenDocument} tokenD
   * @param {TokenMovementOperation} movement
   * @param {boolean} paused          Did we pause the movement?
   * @returns {boolean}
   */
  #isCurrent(eventName, tokenD, movement, paused) {
    const current = tokenD.movement;
    if ( current.id !== movement.id ) return false; // Another movement replaced this one.
    if ( paused && (current.state !== "paused") ) return false; // Stopped while we waited (e.g., user cancelled).
    return tokenD.regions.has(this.region) === PlateauTerrainRegionBehaviorType.#expectInside(eventName);
  }

  /**
   * Should the token be inside the region when this event is handled?
   * MOVE_IN and MOVE_WITHIN: inside. MOVE_OUT: outside.
   * @param {string} eventName
   * @returns {boolean}
   */
  static #expectInside(eventName) { return eventName !== CONST.REGION_EVENTS.TOKEN_MOVE_OUT; }

  //  ----- NOTE: Elevation ----- //

  /** @type {number<grid units>} */
  get topElevation() {
    const { top, topInclusive } = this.region.elevation;
    return topInclusive ? top : top - 1;
  }

  /**
   * The ground elevation of the level the token is on.
   * Uses the token's level, not the level being viewed, and `base`, which stays finite for unbounded levels.
   * @param {TokenDocument} tokenD
   * @param {string} [levelId]
   * @returns {number<grid units>}
   */
  static groundElevation(tokenD, levelId) {
    const level = tokenD.parent?.levels?.get(levelId ?? tokenD.level);
    return level?.elevation.base ?? 0;
  }

  /**
   * Would a waypoint have to change elevation to be consistent with the target elevation?
   * Flying may be above the target and burrowing below it. Anything that is not walking is left alone.
   * @param {{action: string, elevation: number}} waypoint
   * @param {number} target
   * @returns {boolean}
   */
  #needsAdjustment({ action, elevation }, target) {
    if ( elevation.almostEqual(target) ) return false;
    const { terrainWalkActions, terrainFlightActions, terrainBurrowActions } = CONFIG[MODULE_ID];
    if ( elevation < target && terrainBurrowActions.has(action) ) return false;
    if ( elevation > target && terrainFlightActions.has(action) ) return false;
    return terrainWalkActions.has(action);
  }

  // ----- NOTE: Planning ----- //

  /**
   * Compute the corrected remaining path, or null if no correction is needed.
   * This is a pure, synchronous function of the event data. Because it returns null when the path is already
   * consistent, it is idempotent: handling the events of a corrected movement does nothing.
   *
   * The rule is simple: while the token is on one side of the boundary, every remaining walking waypoint is
   * at that side's elevation.
   *   - Inside (MOVE_IN, MOVE_WITHIN): plateau elevation.
   *   - Outside (MOVE_OUT): ground elevation.
   * The token then reaches the next boundary at a constant elevation. That boundary produces the next event,
   * which flips the rest of the path. No path segment ever slopes across a boundary.
   *
   * @param {string} eventName
   * @param {TokenDocument} tokenD
   * @param {TokenMovementOperation} movement
   * @returns {{waypoints: object[], start: object, target: number, signature: string, confirm: boolean}|null}
   */
  #planCorrection(eventName, tokenD, movement) {
    const region = this.region;
    if ( !region ) return null;

    // Our corrective move cannot replay undo/paste, and those are not walking anyway.
    if ( (movement.method === "undo") || (movement.method === "paste") ) return null;

    // Stale event: another movement has already replaced this one.
    if ( tokenD.movement.id !== movement.id ) return null;

    // MOVE_WITHIN also fires at the exit position, when the token is no longer in the region.
    // MOVE_OUT owns that case. Without this check both handlers would fire and fight each other.
    const E = CONST.REGION_EVENTS;
    if ( tokenD.regions.has(region) !== PlateauTerrainRegionBehaviorType.#expectInside(eventName) ) return null;

    // With the dialog enabled the user decides; do not silently override that on every step.
    if ( this.dialog && (eventName === E.TOKEN_MOVE_WITHIN) ) return null;

    const start = movement.passed.waypoints.at(-1);
    if ( !start ) return null;
    const movingIn = PlateauTerrainRegionBehaviorType.#expectInside(eventName);
    const target = movingIn ? this.topElevation : this.constructor.groundElevation(tokenD, start.level);
    if ( !Number.isFinite(target) ) return null; // E.g., region with no top.

    const waypoints = [];
    let changed = false;

    // The token's current position.
    if ( this.#needsAdjustment(start, target) ) {
      changed = true;
      waypoints.push(...PlateauTerrainRegionBehaviorType.verticalMoves(start, target, tokenD.parent?.grid?.distance));
    }

    // The rest of the path. Skip intermediate waypoints; Foundry regenerates them.
    for ( const waypoint of movement.pending.waypoints ) {
      if ( waypoint.intermediate ) continue;
      if ( this.#needsAdjustment(waypoint, target) ) {
        changed = true;
        waypoints.push({ ...waypoint, elevation: target });
      } else waypoints.push({ ...waypoint });
    }
    if ( !changed ) return null;

    return {
      waypoints,
      start,
      target,
      signature: [eventName, start.x, start.y, start.elevation, target].join("|"),
      confirm: eventName !== E.TOKEN_MOVE_WITHIN
    };
  }

  // ----- NOTE: Waypoint helpers ----- //

  /**
   * Create a new waypoint with a set elevation representing a vertical climb.
   * @param {TokenProcessedMovementWaypoint}
   * @returns {TokenMovementWaypoint} Keeps excess values, changing only as necessary.
   */
  static newElevationFromWaypoint(waypoint, elevation) {
    const { x, y, width, height, depth, shape, level } = waypoint;
    return { x, y, elevation, width, height, depth, shape, level,
      action: this.VERTICAL_ACTION, snapped: false, explicit: true, checkpoint: false };
  }

  /**
   * Vertical move in place from the waypoint's elevation to the target.
   * Uses several small steps instead of one long vertical segment.
   * Avoids FoundryVTT bug causing snapping of the intermediate positions on long straight-up moves.
   * @param {TokenProcessedMovementWaypoint} waypoint
   * @param {number} target
   * @param {number} [stepSize=1]      Normally the grid distance
   * @returns {TokenMovementWaypoint[]}
   */
  static verticalMoves(waypoint, target, stepSize = 1) {
    const delta = target - waypoint.elevation;
    const direction = Math.sign(delta);
    if ( !direction ) return [];
    const step = Math.max(stepSize > 0 ? stepSize : 1, Math.abs(delta) / this.MAX_VERTICAL_STEPS);
    const moves = [];
    for ( let e = waypoint.elevation + (direction * step); ((target - e) * direction) > 1e-6; e += (direction * step) ) {
      moves.push(this.newElevationFromWaypoint(waypoint, e));
    }
    moves.push(this.newElevationFromWaypoint(waypoint, target));
    return moves;
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

