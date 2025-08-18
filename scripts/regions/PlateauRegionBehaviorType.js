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
import { ElevationHandler } from "../ElevationHandler.js";
import { RegionMovementWaypoint3d } from "../geometry/3d/RegionMovementWaypoint3d.js";
import { MatrixFloat32 } from "../geometry/MatrixFlat.js";

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
export class PlateauRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      algorithm: new foundry.data.fields.StringField({
        label: `${MODULE_ID}.behavior.types.plateau.fields.algorithm.name`,
        hint: `${MODULE_ID}.behavior.types.plateau.fields.algorithm.hint`,
        initial: FLAGS.PLATEAU_BEHAVIOR.CHOICES.PLATEAU,
        choices: FLAGS.PLATEAU_BEHAVIOR.LABELS,
        blank: false,
        required: true
      }),

      plateauElevation: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.plateau.fields.plateauElevation.name`,
        hint: `${MODULE_ID}.behavior.types.plateau.fields.plateauElevation.hint`,
        initial: () => ElevationHandler.sceneFloor,
      }),

      rampFloor: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.plateau.fields.rampFloor.name`,
        hint: `${MODULE_ID}.behavior.types.plateau.fields.rampFloor.hint`,
        initial: () => ElevationHandler.sceneFloor,
      }),

      rampDirection: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.plateau.fields.rampDirection.name`,
        hint: `${MODULE_ID}.behavior.types.plateau.fields.rampDirection.hint`,
        initial: 0,
        validate: value => value.between(0, 360),
        validationError: game.i18n.localize(`${MODULE_ID}.behavior.types.plateau.fields.rampDirection.validation`)
      }),

      rampStepSize: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.plateau.fields.rampStepSize.name`,
        hint: `${MODULE_ID}.behavior.types.plateau.fields.rampStepSize.hint`,
        initial: 0
      }),

      rampSplitPolygons: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.plateau.fields.splitPolygons.name`,
        hint: `${MODULE_ID}.behavior.types.plateau.fields.splitPolygons.hint`,
        initial: false
      }),
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
//     [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn,
    [CONST.REGION_EVENTS.TOKEN_MOVE_OUT]: this.#onTokenMoveOut,
    [CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN]: this.#onTokenMoveWithin,
  };

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *     - @prop {object} movement          Movement related data; frozen.
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
//   static async #onTokenMoveIn(event) {
//     const data = event.data;
//     log(`Token ${data.token.name} moving into ${event.region.name}!`);
//     if ( event.user !== game.user ) return;
//     const tokenD = data.token;
//   }

    // Each waypoint represents the action to get to the waypoint location.
    // Ex:
    // data.movement.origin: 3000, 2300 (no action)
    // data.movement.passed.waypoints: 2900, 2300 "walk"
    // data.movement.passed.waypoints: 2800, 2300 "walk"
    // data.movement.passed.waypoints: 2724, 2300 "walk" (at region edge; also data.movement.destination but destination has no action)
    // data.movement.pending.waypoints: 2600, 2300 "walk"
    // data.movement.pending.waypoints: 2500, 2300 "walk" (final location for token move)

  /**
   * A token entering this region may have its elevation set to the elevation of the plateau or ramp.
   * - No movement; token dropped in scene or teleported.
   *
   * The other waypoints after entry will be adjusted to the elevation if, for each waypoint:
   * - Movement is in CONFIG.terrainmapper.terrainSurfaceActions
   * - Movement is in CONFIG.terrainmapper.terrainFlyingActions and is below plateau elevation
   *
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  // data.movement.origin   Origin point of the move
  // tokenD.getCompleteMovementPath(waypoints)
  // tokenD.measureMovementPath(waypoints, { cost, aggregator });
  // canvas.grid.measurePath(waypoints, options)
  static async #onTokenEnter(event) {
    if ( event.user !== game.user ) return;
    const { token: tokenD, movement } = event.data;
    if ( !tokenD ) return;
    log(`Token ${tokenD.name} entering ${event.region.name}!`);


    // ----- No async operations before this! -----
    tokenD.stopMovement();

    // Await movement animation
    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    // If Token dropped into the region, determine highest supporting "floor".
    if ( !movement ) {
      log(`\tToken ${tokenD.name} dropped into ${event.region.name}.`);
      const elevation = this.elevationAt2dPoint(tokenD.object.center);
      await tokenD.update({ elevation });
      return;
    }

    // Determine elevation at the current point of the move, based on token center at that location
    log(`\t${movement.pending.waypoints.length} pending waypoints for Token ${tokenD.name}.`, movement.pending.waypoints);
    const tokenCenter = tokenD.object.getCenterPoint(movement.destination);
    const elevation = this.elevationAt2dPoint(tokenCenter);

    // Adjust pending movement waypoints.
    const adjustedWaypoints = movement.pending.waypoints.filter(w => !w.intermediate);

    // If the token's last move was a surface move or would fly it into the terrain, then make an elevation change.
    const priorWaypoint = movement.passed.waypoints.at(-1);
    const priorAction = priorWaypoint?.action;
    if ( priorAction
      && movement.destination.elevation !== elevation
      && (CONFIG.terrainmapper.terrainSurfaceActions.has(priorAction)
       || CONFIG.terrainmapper.terrainFlightActions.has(priorAction) && movement.destination.elevation < elevation) ) {

      // Move from current elevation to the new plateau.
      const waypoint = structuredClone(priorWaypoint);
      waypoint.elevation = elevation;
      log(`onTokenEnter|Changing elevation to ${elevation}`);
      adjustedWaypoints.unshift(waypoint);
    }

    log("onTokenEnter|Processing waypoints.", adjustedWaypoints);
    await tokenD.move(adjustedWaypoints, {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
    });
    log("Finished onTokenMoveEnter.");
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data                Data related to the event
   *     - @prop {Token} token              Token triggering the event
   *     - @prop {object} movement          Movement related data
   *   - @prop {string} name                Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument} region      Region for the event
   *   - @prop {User} user                  User that triggered the event
   */
  static async #onTokenMoveWithin(event) {
    if ( event.user !== game.user ) return;
    const { token: tokenD, movement } = event.data;
    if ( !tokenD ) return;
    log(`Token ${tokenD.name} moving within ${event.region.name} with ${movement.pending.waypoints.length} pending waypoints!`, movement.pending.waypoints);

    // ----- No async operations before this! -----
    tokenD.stopMovement();

    // Await movement animation
    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

     // Determine elevation at the current point of the move, based on token center at that location.
    const tokenCenter = tokenD.object.getCenterPoint(movement.destination);
    const elevation = this.elevationAt2dPoint(tokenCenter);

    // Will cause infinite loop.
//     if ( !movement.pending.waypoints.length ) {
//       // Ensure destination is at correct elevation.
//       log(`onTokenEnter|Changing elevation to ${elevation}`);
//       await tokenD.update({ elevation });
//       return;
//     }

    // Adjust pending movement waypoints.
    const adjustedWaypoints = movement.pending.waypoints
      .filter(w => !w.intermediate)
      .map(w => {
        const adjustElevation = (CONFIG.terrainmapper.terrainFlightActions.has(w.action) && w.elevation > elevation)
          || CONFIG.terrainmapper.terrainSurfaceActions.has(w.action);
        if ( !adjustElevation ) return { ...w }; // TODO: Shallow copy needed?
        const tokenCenter = tokenD.object.getCenterPoint(w);
        return { ...w, elevation: this.elevationAt2dPoint(tokenCenter) }; // TODO: Shallow copy needed?
      });

    log("onTokenMoveWithin|Processing waypoints.", adjustedWaypoints);
    await tokenD.move(adjustedWaypoints, {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
    });
    log("Finished onTokenMoveWithin.");
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data                Data related to the event
   *     - @prop {Token} token              Token triggering the event
   *     - @prop {object} movement          Movement related data
   *   - @prop {string} name                Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument} region      Region for the event
   *   - @prop {User} user                  User that triggered the event
   */
  static async #onTokenMoveOut(event) {
    if ( event.user !== game.user ) return;
    const { token: tokenD, movement } = event.data;
    if ( !tokenD ) return;
    log(`Token ${tokenD.name} moving out of ${event.region.name} with ${movement.pending.waypoints.length} pending waypoints!`, movement.pending.waypoints);

    // If the token's next move is not a surface move, no change to elevation.
    const nextWaypoint = movement.pending.waypoints[0];
    const nextAction = nextWaypoint?.action;
    if ( nextAction && !CONFIG.terrainmapper.terrainSurfaceActions.has(nextAction) ) return;

    // ----- No async operations before this! -----
    tokenD.stopMovement();

    // Await movement animation
    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    // Determine elevation at the current point of the move, based on token center at that location
    const tokenCenter = tokenD.object.getCenterPoint(movement.destination);
    const elevation = this.constructor.supportingFloorAtPosition(tokenCenter);

    // Adjust pending movement waypoints.
    // Drop all other waypoints to the floor if they are surface moves.
    const adjustedWaypoints = movement.pending.waypoints
      .filter(w => !w.intermediate)
      .map(w => {
        if ( !CONFIG.terrainmapper.terrainSurfaceActions.has(w.action) ) return { ...w };
        return { ...w, elevation };
      });

    // Move from current elevation to the supporting floor.
    const waypoint = structuredClone(nextWaypoint ?? movement.passed.waypoints.at(-1));
    waypoint.elevation = elevation;
    adjustedWaypoints.unshift(waypoint);
    log(`onTokenMoveOut|Changing elevation to ${elevation}`);


    log("onTokenMoveOut|Processing waypoints.", adjustedWaypoints);
    await tokenD.move(adjustedWaypoints, {
      ...movement.updateOptions,
      constrainOptions: movement.constrainOptions,
      autoRotate: movement.autoRotate,
      showRuler: movement.showRuler,
    });
    console.log("Finished onTokenMoveOut");
  }

  /** @type {PIXI.Polygon} */
  get nonHolePolygons() { return this.region.polygons.filter(poly => poly._isPositive); }

  /**
   * Cutpoints for the ramp.
   * @param {PIXI.Polygon} [poly]     If provided, will calculate cutpoints for a specific poly in the region
   * @returns {PIXI.Point[]}
   */
  getRampCutpoints(poly) {
    const usePoly = poly && this.splitPolygons;
    let minMax = this.#minMaxRegionPointsAlongAxis();
    if ( usePoly ) minMax = this.#minMaxPolys.get(poly);
    return this.#rampIdealCutpoints(minMax);
  }

  /**
   * Determine the elevation of the plateau/ramp region at a given 2d point.
   * Does not confirm the waypoint is within the region.
   * @param {PIXI.Point} location      2d location
   * @returns {number} The elevation at this location
   */
  elevationAt2dPoint(location) {
    if ( this.algorithm === FLAGS.PLATEAU_BEHAVIOR.CHOICES.PLATEAU ) return this.plateauElevation;
    return Math.round(this._rampElevation(location));
  }

  /**
   * Determine the supporting floor elevation at a given 3d location.
   * Supporting means the floor is at or below the location elevation.
   * @param {RegionMovementWaypoint3d|Point3d} position
   * @returns {number}
   */
  static supportingFloorAtPosition(position) {
    position = RegionMovementWaypoint3d.fromPoint(position);

    let foundFloor = false;
    let elevation = position.elevation;
    canvas.regions.placeables.forEach(region => {
      const b = region.document.behaviors.find(b => b.system instanceof PlateauRegionBehaviorType);
      if ( !b ) return;
      const regionElevation =  b.system.elevationAt2dPoint(position);
      if ( regionElevation <= elevation ) {
        foundFloor ||= true;
        elevation = regionElevation;
      }
    });
    if ( !foundFloor ) elevation = ElevationHandler.sceneFloor;
    return elevation;
  }

/**
   * Determine the elevation of the ramp at a given location.
   * Does not confirm the waypoint is within the region.
   * @param {PIXI.Point} location      2d location
   * @param {boolean} [useSteps=true]                Use steps to determine elevation if that option is enabled
   *                                                 (If false, forces treatment as ramp)
   * @param {boolean} [round=true]                   Round to the nearest point
   * @returns {number} The elevation of the ramp at this location.
   */
  _rampElevation(location, useSteps = true) {
    /* Example
    10 --> 25
    stepsize 5:
    10 --> 15 --> 20 --> 25
    equal division: (25 - 10) / 5 = 3. 3 splits, so 1/4, 2/4, 3/4

    stepsize 3:
    10 --> 13 --> 16 --> 19 --> 22 --> 25
    (25 - 10) / 3 = 5. 1/6,...

    stepsize 4:
    10 --> 14 --> 18 --> 22 --> 25
    (25 - 10) / 4 = 3.75 --> 4 splits. So 1/5, 2/5, 3/5, 4/5

    stepsize 6:
    10 --> 16 --> 22 --> 25
    15 / 6 = 2.5. 3 splits.

    stepsize 7:
    10 --> 17 --> 24 --> 25
    15 / 7 = ~2.14. 3 splits.
    */
    // See getRampCutpoints
    let minMax = this.#minMaxRegionPointsAlongAxis();
    if ( this.splitPolygons ) {
      const poly = this.nonHolePolygons.find(poly => poly.contains(location.x, location.y));
      minMax = this.#minMaxPolys.get(poly);
    }
    if ( !minMax ) return ElevationHandler.sceneFloor;
    const closestPt = foundry.utils.closestPointToSegment(location, minMax.min, minMax.max);
    const t0 = Math.clamp(PIXI.Point.distanceBetween(minMax.min, closestPt)
      / PIXI.Point.distanceBetween(minMax.min, minMax.max), 0, 1);

    // Floor (min) --> pt --> elevation (max)
    // If no stepsize, elevation is simply proportional
    // Formula will break if t0 = 1. It will go to the next step. E.g., 28 instead of 25
    const { rampFloor, plateauElevation, rampStepSize } = this;
    if ( t0.almostEqual(0) ) return rampFloor;
    if ( t0.almostEqual(1) ) return plateauElevation;
    if ( useSteps && rampStepSize ) {
      const cutPoints = this.#rampIdealCutpoints(minMax);
      const nearestPt = cutPoints.findLast(pt => pt.t.almostEqual(t0) || pt.t < t0);
      if ( !nearestPt ) return rampFloor;
      return nearestPt.elevation;
    }

    // Ramp is basic incline; no steps.
    const delta = plateauElevation - rampFloor;
    const out = rampFloor + (t0 * delta);
    return out;
  }

  /**
   * Determine the minimum/maximum points of the region along a given axis.
   * @returns {object}
   * - @prop {Point} min    Where region first intersects the line orthogonal to direction, moving in direction
   * - @prop {Point} max    Where region last intersects the line orthogonal to direction, moving in direction
   */
  #minMaxPolys = new WeakMap();

  #minMaxRegionPointsAlongAxis() {
    const { region, rampDirection } = this;

    // By definition, holes cannot be the minimum/maximum points.
    const polys = this.nonHolePolygons;
    const nPolys = polys.length;
    if ( !nPolys ) return undefined;

    // Set the individual min/max per polygon.
    this.#minMaxPolys = new WeakMap();
    for ( const poly of polys ) this.#minMaxPolys.set(poly, minMaxPolygonPointsAlongAxis(poly, rampDirection));

    // Determine the min/max for the bounds.
    // For consistency (and speed), rotate the bounds of the region.
    const center = region.bounds.center;
    const minMax = minMaxPolygonPointsAlongAxis(polys[0], rampDirection, center);
    minMax.min._dist2 = PIXI.Point.distanceSquaredBetween(minMax.min, center);
    minMax.max._dist2 = PIXI.Point.distanceSquaredBetween(minMax.max, center);
    for ( let i = 1; i < nPolys; i += 1 ) {
      const res = minMaxPolygonPointsAlongAxis(polys[i], rampDirection, center);

      // Find the point that is further from the centroid.
      res.min._dist2 = PIXI.Point.distanceSquaredBetween(res.min, center);
      res.max._dist2 = PIXI.Point.distanceSquaredBetween(res.max, center);
      if ( res.min._dist2 > minMax.min._dist2 ) minMax.min = res.min;
      if ( res.max._dist2 > minMax.max._dist2 ) minMax.max = res.max;
    }
    return minMax;
  }

  /**
   * Cutpoints for ramp steps, along the directional line for the ramp.
   * Smallest t follows the ramp floor; largest t is the switch to the plateauElevation.
   * @param {object} minMax         Uses the provided minMax to calculate the cutpoints.
   * @returns {PIXI.Point[]} Array of points on the ramp direction line. Additional properties:
   *   - @prop {number} elevation   New elevation when ≥ t
   *   - @prop {number} t           Percent distance from minPt
   */
  #rampIdealCutpoints(minMax) {
    const { rampFloor, plateauElevation, rampStepSize } = this;
    if ( !rampStepSize ) return [];
    const delta = plateauElevation - rampFloor;
    const numSplits = Math.ceil(delta / rampStepSize);
    const minPt = PIXI.Point.fromObject(minMax.min);
    const maxPt = PIXI.Point.fromObject(minMax.max);
    const splits = Array.fromRange(numSplits).map(i => (i + 1) / (numSplits + 1));
    return splits.map((t, idx) => {
      const pt = minPt.projectToward(maxPt, t);
      pt.t = t;
      pt.elevation = rampFloor + ((idx + 1) * rampStepSize);
      return pt;
    });
  }

}

// ----- NOTE: Helper functions ----- //

/**
 * Locate the minimum/maximum points of a polygon along a given axis.
 * E.g., if the axis is from high to low y (due north), the points would be min: maxY, max: minY.
 * @param {PIXI.Polygon} poly         The polygon
 * @param {number} [direction=0]      The axis direction, in degrees. 0º is S, 90º is W
 * @param {number} [centroid]         Center of the polygon
 * @returns {object}
 * - @prop {PIXI.Point} min    Where polygon first intersects the line orthogonal to direction, moving in direction
 * - @prop {PIXI.Point} max    Where polygon last intersects the line orthogonal to direction, moving in direction
 */
function minMaxPolygonPointsAlongAxis(poly, direction = 0, centroid) {
  centroid ??= poly.center;
  if ( direction % 90 ) {
    // Rotate the polygon to direction 0 (due south).
    const rotatedPoly = rotatePolygon(poly, Math.toRadians(360 - direction), centroid);
    const bounds = rotatedPoly.getBounds();

    // Rotate back
    const minMaxRotatedPoly = new PIXI.Polygon(centroid.x, bounds.top, centroid.x, bounds.bottom);
    const minMaxPoly = rotatePolygon(minMaxRotatedPoly, -Math.toRadians(360 - direction), centroid);
    return {
      min: new PIXI.Point(minMaxPoly.points[0], minMaxPoly.points[1]),
      max: new PIXI.Point(minMaxPoly.points[2], minMaxPoly.points[3])
    };
  }

  // Tackle the simple cases.
  const bounds = poly.getBounds();
  switch ( direction ) {
    case 0: return { min: new PIXI.Point(centroid.x, bounds.top), max: new PIXI.Point(centroid.x, bounds.bottom) }; // Due south
    case 90: return { min: new PIXI.Point(bounds.right, centroid.y), max: new PIXI.Point(bounds.left, centroid.y) }; // Due west
    case 180: return { min: new PIXI.Point(centroid.x, bounds.bottom), max: new PIXI.Point(centroid.x, bounds.top) }; // Due north
    case 270: return { min: new PIXI.Point(bounds.left, centroid.y), max: new PIXI.Point(bounds.right, centroid.y) }; // Due east
  }
}

/**
 * Rotate a polygon a given amount clockwise, in radians.
 * @param {PIXI.Polygon} poly   The polygon
 * @param {number} rotation     The amount to rotate clockwise in radians
 * @param {number} [centroid]   Center of the polygon
 */
function rotatePolygon(poly, rotation = 0, centroid) {
  if ( !rotation ) return poly;
  centroid ??= poly.center;

  // Translate to 0,0, rotate, translate back based on centroid.
  const rot = MatrixFloat32.rotationZ(rotation, false);
  const trans = MatrixFloat32.translation(-centroid.x, -centroid.y);
  const revTrans = MatrixFloat32.translation(centroid.x, centroid.y);
  const M = trans.multiply3x3(rot).multiply3x3(revTrans);

  // Multiply by the points of the polygon.
  const nPoints = poly.points.length * 0.5;
  const polyM = MatrixFloat32.empty(nPoints, 3);
  for ( let i = 0; i < nPoints; i += 1 ) {
    const j = i * 2;
    polyM.arr.set([poly.points[j], poly.points[j+1], 1], i * 3);
  }
  const rotatedM = polyM.multiply(M);

  const rotatedPoints = new Float32Array(poly.points.length * 2);
  for ( let i = 0; i < nPoints; i += 1 ) {
    const pt = rotatedM.arr.subarray(i * 3, (i * 3) + 2);
    rotatedPoints.set(pt, i * 2);
  }
  return new PIXI.Polygon(...rotatedPoints);
}