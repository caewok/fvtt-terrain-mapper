/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import {
  log,
  isFirstGM,
  regionWaypointsXYEqual,
  regionWaypointsEqual,
  findSetElevation,
  regionsWithSetElevation } from "../util.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Plane } from "../geometry/3d/Plane.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

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
        initial: FLAGS.REGION.CHOICES.PLATEAU,
        choices: FLAGS.REGION.LABELS
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
          return canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
        }
      }),

      rampStepHeight: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.rampStepHeight.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.rampStepHeight.hint`,
        min: 0,
        initial: 0
      }),

      rampDirection: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.rampDirection.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.rampDirection.hint`,
        min: 0,
        max: 359,
        initial: 0
      }),

      reset: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.reset.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.reset.hint`,
        initial: true
      }),
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit,
    [CONST.REGION_EVENTS.TOKEN_PRE_MOVE]: this.#onTokenPreMove,
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn,
    [CONST.REGION_EVENTS.TOKEN_MOVE]: this.#onTokenMove,
    [CONST.REGION_EVENTS.TOKEN_MOVE_OUT]: this.#onTokenMoveOut,
  };

  static async #onTokenEnter(event) {
    const data = event.data;
    log(`Token ${data.token.name} entering ${event.region.name}!`);
    if ( !isFirstGM() ) return;
//     const tokenD = data.token;
//     return tokenD.update({ elevation: this.elevation });
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
//     if ( tokenD.elevation > this.elevation ) return;
//     return tokenD.update({ elevation: canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0 });
  }

  static async #onTokenPreMove(event) {
    if ( !isFirstGM() ) return;
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;
    log(`Token ${tokenD.name} pre-move into ${event.region.name}!`);
  }

  static async #onTokenMoveIn(event) {
    if ( !isFirstGM() ) return;
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;
    log(`Token ${tokenD.name} move into ${event.region.name}!`);
  }

  static async #onTokenMove(event) {
    if ( !isFirstGM() ) return;
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;
    log(`Token ${tokenD.name} move within ${event.region.name}!`);
  }

  static async #onTokenMoveOut(event) {
    if ( !isFirstGM() ) return;
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;
    log(`Token ${tokenD.name} move out of ${event.region.name}!`);
  }

  /**
   * Determine the elevation after an enter move into this behavior's region.
   * @param {RegionMovementWaypoint} waypoint   Position and elevation immediately upon entry;
   *                                            Position required only for ramps
   * @returns {number} The elevation after accounting for any triggering move.
   */
  elevationUponEntry(waypoint) {
    const { PLATEAU, RAMP, STAIRS } = FLAGS.REGION.CHOICES;
    switch ( this.algorithm ) {
      case PLATEAU:
      case RAMP: return this.plateauElevation(waypoint);
      case STAIRS: {
        const midE = Math.round((this.elevation - this.floor) * 0.5);
        return waypoint.elevation <= midE ? this.elevation : this.floor;
      }
    }
    return canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  }

  /**
   * Determine the elevation at a given point.
   * Assumes, without testing, that the point is within this behavior's region.
   * Treats points above the behavior's plateau elevation as falling to the plateau.
   * Points below the plateau fall to the terrain background elevation.
   * @param {RegionMovementWaypoint} waypoint   Position and elevation to test;
   *                                            Position required only for ramps
   * @param {boolean} [useStairs=false]         If true, adjust for stairs
   * @returns {number} The elevation after accounting for any triggering move
   */
  groundElevationAtPoint(waypoint, useStairs = false) {
    const { PLATEAU, RAMP, STAIRS } = FLAGS.REGION.CHOICES;
    const terrainFloor = canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
    switch ( this.algorithm ) {
      case PLATEAU:
      case RAMP: {
        const elevation = this.plateauElevation(waypoint);
        return waypoint.elevation >= elevation ? elevation : terrainFloor;
      }
      case STAIRS: {
        if ( !useStairs ) return terrainFloor;
        const midE = Math.round((this.elevation - this.floor) * 0.5);
        return waypoint.elevation <= midE ? this.elevation : this.floor;
      }
    }
    return terrainFloor;
  }

  /**
   * Determine the point at which a horizontal line would intersect the ramp.
   * NOTE: Does not test if the returned point is within the region.
   * @param {RegionMovementWaypoint} a      Start position and grid elevation
   * @param {RegionMovementWaypoint} b      End position and grid elevation
   * @returns {RegionMovementWaypoint|null} The intersection.
   */
  plateauSegmentIntersection(a, b) {
    if ( regionWaypointsXYEqual(a, b) ) {
      // a|b is a vertical line in the z direction.
      const e = Math.max(this.groundElevationAtPoint(a), this.groundElevationAtPoint(b));
      if ( e.between(a.elevation, b.elevation) ) return { ...a, elevation: e };
      return null;
    }

    // First intersect the plane, which may be at an angle for a ramp.
    a.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(a.elevation);
    b.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(b.elevation);
    const p = this.plateauPlane();
    a = Point3d._tmp.copyFrom(a);
    b = Point3d._tmp2.copyFrom(b);
    if ( !p.lineSegmentIntersects(a, b) ) return null;
    const ix = p.lineSegmentIntersection(a, b);

    // Then get the actual location for the step size.
    ix.elevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(ix.z);
    ix.elevation = this.plateauElevation(ix);
    return ix;
  }

  /**
   * Calculate the plane of the plateau or ramp.
   * @returns {Plane} If not a ramp, will return the horizontal plane
   */
  plateauPlane() {
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    const { elevation, floor } = this;
    if ( this.algorithm !== FLAGS.REGION.CHOICES.RAMP ) return new Plane(new Point3d(0, 0, gridUnitsToPixels(elevation)));

    // Construct a plane using three points: min/max and a third orthogonal point.
    const minMax = this.parent.getFlag(MODULE_ID, FLAGS.REGION.MIN_MAX);
    const min = new Point3d(minMax.min.x, minMax.min.y, gridUnitsToPixels(floor));
    const max = new Point3d(minMax.max.x, minMax.max.y, gridUnitsToPixels(elevation));

    // Find an orthogonal point.
    // Because ramps are not skewed to the canvas, can use the 2d normal.
    const dir = max.subtract(min);
    const cDir = new Point3d(dir.y, -dir.x); // https://gamedev.stackexchange.com/questions/70075/how-can-i-find-the-perpendicular-to-a-2d-vector
    const c = min.add(cDir);

    // Get a point at the same elevation as min in the given direction.
    return Plane.fromPoints(min, max, c);
  }


  /**
   * Determine the elevation at a given region point for a ramp or plateau behavior.
   * Does not confirm the waypoint is within the region.
   * @param {RegionMovementWaypoint} waypoint
   * @returns {number} The elevation of the ramp/plateau at this location
   */
  plateauElevation(waypoint) {
    if ( this.algorithm === FLAGS.REGION.CHOICES.PLATEAU ) return this.elevation;
    if ( this.algorithm !== FLAGS.REGION.CHOICES.RAMP ) return waypoint.elevation;
    const minMax = this.parent.getFlag(MODULE_ID, FLAGS.REGION.MIN_MAX);
    if ( !minMax ) return waypoint.elevation;
    const closestPt = foundry.utils.closestPointToSegment(waypoint, minMax.min, minMax.max);

    // Floor (min) --> pt --> elevation (max)
    // If no stepsize, elevation is simply proportional
    const { floor, elevation, rampStepHeight } = this;
    const t0 = Math.clamp(PIXI.Point.distanceBetween(minMax.min, closestPt) / PIXI.Point.distanceBetween(minMax.min, minMax.max), 0, 1);
    if ( t0.almostEqual(0) ) return floor;
    if ( t0.almostEqual(1) ) return elevation;
    const delta = elevation - floor;
    if ( !rampStepHeight ) return Math.round(floor + (t0 * delta));

    /* Example
    10 --> 25
    stepsize 5:
    10 --> 15 --> 20 --> 25
    equal division: (25 - 10) / 5 = 3. 3 splits, so 1/4, 2/4, 3/4

    stepsize 3:
    10 --> 13 --> 16 --> 19 --> 22 --> 25
    (25 - 10) / 3 = 5. 1/6,...
    */
    // Formula will break if t0 = 1. It will go to the next step. E.g., 28 instead of 25.
    return Math.round(floor + (Math.floor(t0 * delta / rampStepHeight) * rampStepHeight));
  }


  /**
   * Calculate the elevation for an array of segments for this region.
   * Assumes, without checking, that the segments represent this region.
   * @param {RegionMovementSegment[]} segments    Result of region.segmentizeMovement
   * @returns {RegionMovementSegment[]} The segments with elevation modified
   */
  estimateSegmentElevation(segments) {
    const backgroundElevation = canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
    let currElevation = segments[0].from.elevation;
    for ( const segment of segments ) {
      currElevation = this._estimateSegmentElevation(segment, currElevation, backgroundElevation);
    }
    return segments;
  }

  /**
   * Calculate the elevation for a single segment for this region.
   * Assumes, without checking, that the segment represents this region.
   * @param {RegionMovementSegment} segment    Single segment from region.segmentizeMovement
   * @returns {number} The current elevation after this segment. `segment` is modified in place
   */
  _estimateSegmentElevation(segment, currElevation, backgroundElevation) {
    backgroundElevation ??= canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
    currElevation ??= backgroundElevation;
    const region = this.parent?.parent?.object;
    switch ( segment.type ) {
      case Region.MOVEMENT_SEGMENT_TYPES.ENTER: {
        segment.from.elevation = currElevation;
        segment.to.elevation = currElevation;

        // Test if still in this region.
        if ( region?.testPoint(segment.to, segment.to.elevation) ) {
          segment.to.elevation = this.elevation;
          currElevation = this.elevation;
        }
        break;
      }

      case Region.MOVEMENT_SEGMENT_TYPES.EXIT: {
        segment.from.elevation = currElevation;
        segment.to.elevation = currElevation;

        // Test if still in this region.
        if ( this.reset
          && currElevation <= this.elevation
          && region?.testPoint(segment.from, segment.from.elevation) ) {
          segment.to.elevation = backgroundElevation;
          currElevation = backgroundElevation;
        }
        break;
      }

      case Region.MOVEMENT_SEGMENT_TYPES.MOVE: {
        segment.from.elevation = currElevation;
        segment.to.elevation = currElevation;
        break;
      }
    }
    return currElevation;
  }

  /**
   * Create a path that accounts for region elevation for a given straight line segment.
   * Only accounts for setElevation regions at the moment; no other types (i.e. Levels)
   * @param {RegionMovementWaypoint} start          Start of the path
   * @param {RegionMovementWaypoint} end            End of the path
   * @param {Point[]} [samples]                     The points relative to the waypoint that are tested.
   *                                                Whenever one of them is inside the region, the moved object
   *                                                is considered to be inside the region.
   * @param {boolean} [teleport=false]              Is it teleportation?
   * @returns {RegionPathWaypoint[]} Sorted points by distance from start.
   */
  static constructRegionsElevationPath(start, end, samples, teleport = false) {
    samples ??= [{x: 0, y: 0}];
    let path = constructRegionsPath(start, end, samples, teleport);
    if ( !path.length ) return [];

    // Add starting waypoint if not already present.
    if ( path[0].dist2 ) {
      start.dist2 = 0;
      start.regions = { enter: new Set(), exit: new Set(), move: new Set() };
      start.start = start;
      start.idx = 0;
      path.unshift(start);
    }

    // Cycle over each segment, applying the event for each.
    // If at some point the elevation changes, update segments accordingly.
    const finalPath = [];
    const MAX_ITER = 1000; // Avoid infinite loops due to errors or looped regions.
    let iter = 0;
    while ( path.length && iter < MAX_ITER ) {
      iter += 1;
      const currPosition = path.shift();
      finalPath.push(currPosition);
      if ( path.length && currPosition.elevation !== path[0].elevation ) {
        end.elevation = path[0].elevation;
        const newPath0 = constructRegionsPath(currPosition, path[0], samples, teleport);
        const newPathDest = constructRegionsPath(path[0], end, samples, teleport);

        // Remove repeated values
        newPath0.shift(); // currPosition
        if ( newPath0.length && newPathDest.length && regionWaypointsEqual(newPath0, newPathDest) ) newPath0.pop();

        // Replace the remaining path.
        path = [...newPath0, ...newPathDest];
      }
    }
    if ( !finalPath.length ) return [];

    // Add ending waypoint if not present
    if ( !regionWaypointsEqual(finalPath.at(-1), end) ) {
      end.dist2 = Math.round(PIXI.Point.distanceSquaredBetween(start, end));
      end.regions = { enter: new Set(), exit: new Set(), move: new Set() };
      end.start = start;
      end.idx = finalPath.length;
      finalPath.push(end);
    }

    return finalPath;

  }

  /**
   * Estimate the elevation of a line through 0+ setElevation regions.
   * @param {Point} start             Starting location
   * @param {Point} end               Ending location
   * @param {object} [opts]           Options that affect the path measurement
   * @param {number} [opts.startElevation]   Elevation in grid units
   * @returns {RegionMovementSegment}
   */
  static estimateElevationForSegment(start, end, { startElevation } = {}) {
    const backgroundElevation = canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
    startElevation ??= backgroundElevation;
    const samples = [{x: 0, y: 0}];
    const teleport = false;
    const orig = { x: start.x, y: start.y, elevation: startElevation }
    const dest = { x: end.x, y: end.y, elevation: startElevation }

    // Segmentize all regions with setElevation behavior.
    const regionSegments = segmentizeElevationRegions([orig, dest], samples, teleport);
    if ( !regionSegments.length ) return [orig, dest];

    // Run through each segment in turn, processing the behavior(s)
    // Treat segments as a priority queue
    let path = processSegments(regionSegments, orig);

    // Check subsegment of the path for elevation change.
    // Elevation change may indicate other regions become part of the region segments.
    const finalPath = [orig];
    const MAX_ITER = 1000; // Avoid infinite loops due to errors or looped regions.
    let iter = 0;
    while ( path.length && iter < MAX_ITER ) {
      iter += 1;
      const currPosition = path.shift();
      finalPath.push(currPosition)
      if ( path.length && currPosition.elevation !== path[0].elevation ) {
        dest.elevation = path[0].elevation
        const newSegments = segmentizeElevationRegions([currPosition, path[0], dest], samples, teleport)
        path = processSegments(newSegments, currPosition.elevation);
        path.shift(); // Remove the currPosition from the path.
        // path = processSegments
      }
    }
    return finalPath;
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
  const elevation = topE ?? canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  const floor = canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  document.updateSource({ ["system.elevation"]: elevation, ["system.floor"]: floor });
}

PATCHES.REGIONS.HOOKS = { preCreateRegionBehavior };

/**
 * Segmentize all regions with setElevation behavior.
 * @param {RegionMovementWaypoint[]} waypoints    Path points to segmentize
 * @param {Point[]} samples                       The points relative to the waypoints that are tested.
 *                                                Whenever one of them is inside the region, the moved object
 *                                                is considered to be inside the region.
 * @param {boolean} [teleport=false]              Is it teleportation?
 * @returns {RegionMovementSegment[]} Sorted segments at distance from origin.
 */
function segmentizeElevationRegions(waypoints, samples, teleport = false) {
  // Segmentize all regions with setElevation behavior.
  // No quadtree for regions
  const regionSegments = [];
  for ( const region of canvas.regions.placeables ) {
    const behaviors = region.document.behaviors.filter(b => !b.disabled && b.type === "terrainmapper.setElevation");
    if ( !behaviors.length ) continue;
    const segments = region.segmentizeMovement(waypoints, samples, { teleport });
    if ( !segments.length ) continue;
    segments.forEach(segment => segment.behaviors = behaviors);
    regionSegments.push(...segments);
  }

  // Sort by 3d distance from origin.
  const orig3d = Point3d._tmp.copyFrom(waypoints[0]);
  orig3d.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(orig3d.elevation);
  regionSegments.forEach(segment => {
    const dest3d = Point3d._tmp2.copyFrom(segment.from);
    dest3d.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(segment.from.elevation);
    segment._dist2 = Point3d.distanceSquaredBetween(orig3d, dest3d);
  });
  regionSegments.sort((a, b) => a._dist2 - b._dist2)
  return regionSegments;
}

/**
 * Estimate the elevation for an array of sorted segments.
 * @param {RegionMovementSegment[]} regionSegments
 * @param {RegionMovementWaypoint} orig             Starting point
 * @returns {RegionMovementWaypoint[]}
 */
function processSegments(regionSegments, orig) {
  const backgroundElevation = canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  const path = [];
  let currElevation = orig.elevation;
  for ( const segment of regionSegments ) {
    for ( const behavior of segment.behaviors ) {
      const pathSegment = { from: foundry.utils.duplicate(segment.from), to: foundry.utils.duplicate(segment.to), type: segment.type };
      pathSegment.from.elevation = currElevation;
      currElevation = behavior.system._estimateSegmentElevation(pathSegment, currElevation, backgroundElevation);
      path.push(pathSegment.from, pathSegment.to);
    }
  }

  // Sort by 3d distance from origin.
  const orig3d = Point3d._tmp.copyFrom(orig);
  orig3d.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(orig3d.elevation);
  path.forEach(pt => {
    const dest3d = Point3d._tmp2.copyFrom(pt);
    dest3d.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(pt.elevation);
    pt._dist2 =  Point3d.distanceSquaredBetween(orig3d, dest3d);
  });
  path.sort((a, b) => a._dist2 - b._dist2);
  return trimDuplicates(path);
}

/**
 * Trim duplicates in path.
 * @param {RegionMovementWaypoint[]}  arr
 * @returns {RegionMovementWaypoint[]}  New array
 */
function trimDuplicates(arr) {
  const numPts = arr.length;
  if ( !numPts ) return [];
  let prevPt = arr[0];
  const trimmedArr = [prevPt];
  for ( let i = 1; i < numPts; i += 1 ) {
    const currPt = arr[i];
    if ( prevPt.x === currPt.x && prevPt.y === currPt.y && prevPt.elevation === currPt.elevation ) continue;
    trimmedArr.push(currPt);
    prevPt = currPt;
  }
  return trimmedArr;
}

/**
 * Array that eliminates duplicate entries on push.
 */
class PathArray extends Array {
  push(...args) {
    const prev = this.at(-1);
    if ( prev && this.constructor.isDuplicate(args[0], prev) ) return;
    super.push(...args);
  }
  static isDuplicate(a, b) { return a.x.almostEqual(b.x) && a.y.almostEqual(b.y) && a.elevation.almostEqual(b.elevation); }

  /**
   * Build a path array from an array of region segments
   * @param {RegionMovementSegment[]} segments
   * @param {object} [opts]
   * @param {RegionMovementWaypoint} [opts.start]
   * @param {RegionMovementWaypoint} [opts.end]
   * @returns {RegionMovementWaypoint[]}
   */
  static fromSegments(segments, { start, end } = {}) {
    const { ENTER, MOVE, EXIT } = Region.MOVEMENT_SEGMENT_TYPES;
    const path = new this();
    if ( start ) path.push(start);
    for ( const segment of segments ) {
      switch ( segment.type ) {
        case ENTER: path.push(segment.to); break;
        case MOVE: path.push(segment.from, segment.to); break;
        case EXIT: path.push(segment.to); break;
      }
    }
    if ( end ) path.push(end);
    return path;
  }
}

/**
 * For a given elevation change, check for an intersection point with another region.
 * If another region either is already present or entered into, determine if the change
 * triggers a move to that region.
 * 1. Will we enter a new region, triggering elevation/stairs?
 * 2. Will we move in an existing region, triggering ramp or plateau movement?
 * @param {RegionMovementWaypoint} a              The starting move point
 * @param {RegionMovementWaypoint} b              The ending move point
 * @param {Region} currRegion                     Current region that we are tracking
 * @param {Map<Region, RegionMovementSegment[]}   Current segments of the region
 * @param {RegionMovementWaypoint} start          The first waypoint for the path
 * @returns {object|null}
 * - @prop {number} idx                       Index of the move segment in its respective regionSegments
 * - @prop {Region} region                    Region for which the segment belongs
 * - @prop {RegionMovementSegment} segment    Current segment for the path after the intersection
 * - @prop {RegionMovementWaypoint} ix        Intersection point
 */
function findRegionShift(a, b, currRegion, regionSegments, start) {
  const teleport = false;
  const samples = [{x: 0, y: 0}];
  const { ENTER, EXIT, MOVE } = Region.MOVEMENT_SEGMENT_TYPES;
  const currSlope = zSlope2(a, b);

  // Determine if we hit another region on the way down.
  // Keep that region if it is the maximum elevation or is stairs trigger
  let dist2 = PIXI.Point.distanceSquaredBetween(a, b);
  let region;
  let ix;
  for ( const testRegion of regionSegments.keys() ) {
    if ( testRegion === currRegion ) continue;
    const setElevationB = findSetElevation(testRegion);
    if ( !setElevationB ) continue;

    // Find the segments for the a|b move.
    const abSegments = testRegion.segmentizeMovement([a, b], samples, { teleport });
    if ( !abSegments.length) continue;

    let testSegment = abSegments[0];
    let testIx = null;
    switch ( testSegment.type ) {
      case EXIT: break;
      case ENTER: {
        // Confirm if we hit the plateau, if at all.
        if ( (setElevationB.system.algorithm === FLAGS.REGION.CHOICES.PLATEAU
          || setElevationB.system.algorithm === FLAGS.REGION.CHOICES.RAMP)
          && testSegment.to.elevation > setElevationB.system.plateauElevation(testSegment.to) ) break;

        // Otherwise switch on th entry.
        testIx = testSegment.to;
        break;
      }
      case MOVE: {
        if ( setElevationB.system.algorithm === FLAGS.REGION.CHOICES.STAIRS ) break;

        // Switch if moving down (slope -∞) or if the test slope exceeds the current slope.
        if ( !(currSlope === Number.NEGATIVE_INFINITY || zSlope2(testSegment.from, testSegment.to) > currSlope) ) break;

        // TODO: Simplify this. Do we need all the tests or is abSegments[1] always the right choice?
        // Determine if the segment was split at the intersection by segmentizeMovement.
        const nextTestSegment = abSegments[1]
        if ( nextTestSegment ) {
          testSegment.from.dist2 ??= PIXI.Point.distanceSquaredBetween(start, testSegment.from);
          testSegment.to.dist2 ??= PIXI.Point.distanceSquaredBetween(start, testSegment.to);
          a.dist2 ??= PIXI.Point.distanceSquaredBetween(start, a);
          b.dist2 ??= PIXI.Point.distanceSquaredBetween(start, b);
          if ( testSegment.to.dist2.between(a.dist2, b.dist2) ) { testIx = nextTestSegment.from; break; }
        }

        // Determine the elevation at which the move is encountered along the a|b segment.
        // First possibility: the move starts at the a point.
        if ( regionWaypointsEqual(testSegment.from, a) ) {
          testIx = testSegment.to;
          break;
        }

        // Second possibility: the move starts between a and b elevation.
        const testElevation = setElevationB.system.groundElevationAtPoint(testSegment.from);
        if ( testElevation.between(a.elevation, b.elevation) ) {
          testIx = testSegment.from;
          testIx.elevation = testElevation;
        }
        break;
      }
    }
    if ( testIx === null ) continue;
    if ( regionWaypointsEqual(a, testIx) ) continue; // Intersections at "a" will cause infinite loop.
    const testDist2 = PIXI.Point.distanceSquaredBetween(a, testIx);
    if ( testDist2 > dist2 ) continue;
    region = testRegion;
    ix = testIx;
    dist2 = testDist2;
  }
  if ( !region ) return null;
  return { region, ix };
}

/**
 * Calculate a slope-squared for a segment along the z-axis, for comparison of slopes.
 * @param {RegionMovementWaypoint} a
 * @param {RegionMovementWaypoint} b
 * @returns {number} The slope. Positive infinity if moving straight up; negative infinity if moving straight down.
 *  Positive if moving up, negative if moving down; 0 if straight.
 */
function zSlope2(a, b) {
  const elevDelta = b.elevation - a.elevation;
  if ( !elevDelta ) return 0;
  if ( regionWaypointsXYEqual(a, b) ) return elevDelta < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  const dist2 = PIXI.Point.distanceSquaredBetween(a, b);
  return Math.sign(elevDelta) * (Math.pow(elevDelta, 2) / dist2);
}

/**
 * Update region segments with a new set of waypoints.
 * Used to determine if changes in elevation of a path result in a new path or new regions.
 * @param {Region} currRegion
 * @param {Set<Region, RegionMovementSegment[]> } regionSegments
 * @param {RegionWaypoint[]} newWaypoints
 */
function updateRegionSegments(currRegion, regionSegments, newWaypoints, { samples, teleport } = {}) {
  canvas.regions.placeables.forEach(region => {
    if ( region === currRegion ) return;
    regionSegments.set(region, region.segmentizeMovement(newWaypoints, samples, { teleport }));
  });
}

/**
 * For a given array of region segments, locate the segment closest to a given point.
 * Assumes the segments represent a straight 2d line, with possible elevation changes.
 * @param {RegionMovementSegment[]} segments
 * @param {RegionMovementWaypoint} waypoint           Point along the segments path.
 * @param {RegionMovementWaypoint} [start]       Starting waypoint for the segment path. Used to determine distance.
 * @returns {number} Index of the closest segment.
 */
function closestSegmentIndexToPosition(segments, waypoint, start) {
  // E.g.
  // 0----20-----50-----80---100
  //               60
  waypoint.dist2 ??= PIXI.Point.distanceSquaredBetween(start, waypoint);
  let idx = -1;
  for ( let i = 0, n = segments.length; i < n; i += 1 ) {
    const segment = segments[i];

    // Skip segments until we get one where the to endpoint is greater than the waypoint
    segment.to.dist2 ??= PIXI.Point.distanceSquaredBetween(start, segment.to);
    if ( segment.to.dist2 < waypoint.dist2 ) continue;

    // If the from waypoint is greater, we have gone too far.
    segment.from.dist2 ??= PIXI.Point.distanceSquaredBetween(start, segment.from);
    if ( segment.from.dist2 > waypoint.dist2 ) break;

    // At this point, the segment encompasses the waypoint in the dist2 direction.
    // Waypoint could equal the from endpoint, the to endpoint, or be somewhere in-between.
    idx = i;

    // Is this a vertical move?
    // Could be more than one b/c moving vertically. Take the one that contains the waypoint elevation.
    // E.g., vertically moving up: 10---20---30. Waypoint is 12. Check for between from/to elevation
    if ( regionWaypointsXYEqual(segment.from, segment.to) ) {
      // Could be more than one b/c moving vertically. Take the one that contains the waypoint elevation.
      // E.g., vertically moving up: 10---20---30. Waypoint is 12. Check for between from/to elevation
      if ( waypoint.elevation.between(segment.from.elevation, segment.to.elevation, false)
        || waypoint.elevation === segment.from.elevation ) return i;
    } else if ( regionWaypointsEqual(segment.to, waypoint) ) continue;  // Likely the next statement from equals the waypoint.
  }
  return idx;
}

/**
 * Create path for a given straight line segment that may move through regions.
 * Constructs a 2d model of the regions that intersect the line.
 * x-axis: dist2, y-axis: elevation.
 * Then uses clipper to combine the polygons.
 * Finally, constructs the path using the polygons(s) plus changes for stairs.
 * Stairs determined by intersecting the polygons(s) with elevation lines for stairs.
 * @param {RegionMovementWaypoint} start          Start of the path
 * @param {RegionMovementWaypoint} end            End of the path
 * @returns {PathArray<RegionMovementWaypoint>}   Sorted points by distance from start.
 */
export function constructRegionPath2(start, end) {
  if ( regionWaypointsEqual(start, end) ) return [start, end];
  const setElevationRegions = regionsWithSetElevation(canvas.regions.placeables);
  if ( !setElevationRegions.length ) return [start, end];
  const terrainFloor = canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;

  // TODO: Simple case: Elevation-only change?

  // Identify stair regions that have at least one polygon that intersects the line.
  const stairRegions = intersectingStairRegions(start, end, setElevationRegions);

  // Locate all polygons within each region that are intersected.
  // Construct a polygon representing the cutaway.
  const combinedPolys = regions2dCutaway(start, end, setElevationRegions)
  if ( !combinedPolys.length ) return [start, end];

  // Convert start and end to 2d-cutaway coordinates.
  const start2d = new PIXI.Point(0, start.elevation);
  const end2d = new PIXI.Point(PIXI.Point.distanceBetween(start, end), end.elevation);

  // Add some properties to the polygons that will be repeatedly used.
  // Orient the polygons so that iterating the points or edges will move in the direction we want to go.
  // Each polygon has a min and max x position, which we can use to avoid testing the polygon for intersections.
  // Also construct the closed edges and points for each polygon, to avoid repeating this in intersection tests.
  const walkDir = end2d.x > start2d.x ? "ccw" : "cw"; // Reversed b/c y-axis is flipped for purposes of Foundry.
  combinedPolys.forEach(poly => {
    if ( poly.isClockwise ^ (walkDir === "cw") ) poly.reverseOrientation();
    poly._pts = [...poly.iteratePoints({close: false})];
    poly._edges = [...poly.iterateEdges({ close: true })];
    poly._minMax = Math.minMax(...poly._pts.map(pt => pt.x));
  });

  // Walk the path, locating the closest intersection to the combined polygons.
  const MAX_ITER = 1e04;
  const destPoly = combinedPolys.find(poly => poly.contains(end2d.x, end2d.y));
  const waypoints = [start2d]
  let atDestination = false;
  let currPosition = start2d;
  let currPoly = null;
  let iterA = 0;
  while ( !atDestination && iterA < MAX_ITER ) {
    iterA += 1;
    const ixs = [];
    combinedPolys.forEach(poly => {
      if ( poly === currPoly ) return;
      if ( poly._minMax.max <= currPosition.x ) return;
      if ( !poly.lineSegmentIntersects(currPosition, end2d, { edges: poly._edges }) ) return;

      // Retrieve the indices so that the edge can be linked to the intersection, for traversing the poly.
      const ixIndices = poly.segmentIntersections(currPosition, end2d, { edges: poly._edges, indices: true });
      ixIndices.forEach(i => {
        const edge = poly._edges[i];
        const ix = foundry.utils.lineLineIntersection(currPosition, end2d, edge.A, edge.B);
        ix.edge = edge;
        ix.poly = poly;
        ixs.push(ix);
      });
    });

    ixs.sort((a, b) => a.t0 - b.t0);
    if ( !ixs.length ) {
      waypoints.push(end2d);
      atDestination = true;
      break;
    }

    const ix = ixs[0];
    const poly = ix.poly;
    waypoints.push(ix);
    currPosition = ix;

    // If the endpoint is inside this polygon, we are done.
    // (Only if burrowing to the endpoint is permitted, which would define the destPoly.)
    if ( ix.poly === destPoly ) {
      waypoints.push(end2d);
      atDestination = true;
      break;
    }

    /* Walk around the polygon until one of the following occurs:
    1. Move would take us toward start in the x direction.
    2. Move would take us under the terrain floor.
    3. Flying is permitted and we would move down.
    4. Flying is permitted and the end point is above the polygon and we have a straight shot.
    5. Stair is encountered.
    */
    let nextPt = ix.edge.B;
    let iterB = 0;
    let currIndex = poly._pts.findIndex(pt => pt.almostEqual(nextPt));
    while ( nextPt && iterB < MAX_ITER ) {
      iterB += 1;
      if ( nextPt.x < currPosition.x ) break; // 1. Would move backward.
      const willHitFloor = nextPt.y < currPosition.y && nextPt.y <= terrainFloor // 2. Would move under terrain floor
      if (  willHitFloor && nextPt.y !== terrainFloor ) {
        nextPt = foundry.utils.lineLineIntersection(currPosition, nextPt,
          { x: start2d.x, y: terrainFloor }, { x: end2d.x, y: terrainFloor });
      }

      // TODO: Flying.

      currPosition = nextPt;
      waypoints.push(nextPt);
      if ( willHitFloor ) break;

      // Look ahead to the next point along the polygon edge.
      currIndex += 1;
      if ( currIndex >= poly._pts.length ) currIndex = 0;
      nextPt = poly._pts[currIndex];
    }
  }

  // Convert back to regular coordinates.
  const startPt = PIXI.Point.fromObject(start);
  const endPt = PIXI.Point.fromObject(end);
  return waypoints.map(waypoint => {
    const pt = startPt.towardsPoint(endPt, waypoint.x); // or towardsPointSquared
    return {
      x: pt.x,
      y: pt.y,
      elevation: waypoint.y
    }
  });
}

/**
 * Identify stair regions with at least one non-hole polygon that intersects a given line.
 * @param {RegionMovementWaypoint} start          Start of the path
 * @param {RegionMovementWaypoint} end            End of the path
 * @param {Region[]} regions
 * @returns {Region[]} Any stair regions that qualify.
 */
function intersectingStairRegions(start, end, regions) {
  const stairRegions = [];
  regions.forEach(region => {
    const behavior = findSetElevation(region);
    if ( behavior.system.algorithm !== FLAGS.REGION.CHOICES.STAIRS ) return;
    for ( const poly of region.polygons ) {
      if ( !poly.isPositive ) continue; // This polygon is a hole.
      if ( !poly.lineSegmentIntersects(start, end, { inside: true}) ) continue;
      stairRegions.push(region);
      return;
    }
  });
  return stairRegions;
}

/**
 * Construct a 2d cutaway of the regions along a given line.
 * X-axis is the distance from the start point.
 * Y-axis is elevation. Note y increases as moving up, which is opposite of Foundry.
 * Only handles plateaus and ramps; ignores stairs.
 * @param {RegionMovementWaypoint} start          Start of the path
 * @param {RegionMovementWaypoint} end            End of the path
 * @param {Region[]} regions                      Regions to test
 * @returns {PIXI.Polygon[]} An array of polygons representing the cutaway.
 */
function regions2dCutaway(start, end, regions) {
  const terrainFloor = canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  const paths = [];
  for ( const region of regions ) {
    const behavior = findSetElevation(region);
    if ( behavior.system.algorithm === FLAGS.REGION.CHOICES.STAIRS ) continue;
    const bottomE = region.document.elevation.bottom ?? terrainFloor - 10; // MIN_SAFE_INTEGER is much too high.
    const regionPolys = [];
    for ( const poly of region.polygons ) {
      if ( !poly.lineSegmentIntersects(start, end, { inside: true}) ) continue;

      // For plateau and ramp, construct the cutaway polygon.
      const ix = poly.segmentIntersections(start, end);

      // Determine the appropriate endpoints.
      let a;
      let b;
      switch ( ix.length ) {
        case 0: { a = start; b = end; break; }
        case 1: {
          [a, b] = poly.contains(start.x, start.y) ? [start, ix[0]] : [ix[0], end];
          break;
        }
        case 2: {
          [a, b] = ix[0].t0 < ix[1].t0 ? [ix[0], ix[1]] : [ix[1], ix[0]];
          break;
        }
      }


      // Build the quadrangle
      // For testing, use distance instead of distanceSqaured
      const TL = { x: PIXI.Point.distanceBetween(start, a), y: behavior.system.plateauElevation(a) };
      const TR = { x: PIXI.Point.distanceBetween(start, b), y: behavior.system.plateauElevation(b) };
      const BL = { x: TL.x, y: bottomE };
      const BR = { x: TR.x, y: bottomE };
      // _isPositive is y-down clockwise. For Foundry canvas, this is CCW.
      const cutPointPoly = poly.isPositive ? new PIXI.Polygon(TL, BL, BR, TR) : new PIXI.Polygon(TL, TR, BR, BL);
      regionPolys.push(cutPointPoly);
    }

    // If all holes or no polygons, we are done.
    if ( !regionPolys.length || regionPolys.every(poly => !poly.isPositive) ) continue;

    //
    // Draw.shape(regionPolys[0], { color: Draw.COLORS.blue })
    // Draw.shape(regionPolys[1], { color: Draw.COLORS.red })

    // Combine the polygons if more than one.
    const regionPath = ClipperPaths.fromPolygons(regionPolys);
    const combined = regionPath.combine().clean(); // After this, should not be any holes.
    paths.push(combined);
  }

  // Union the paths.
  const combinedPaths = ClipperPaths.combinePaths(paths);
  const combinedPolys = combinedPaths.clean().toPolygons();

  // If all holes or no polygons, we are done.
  if ( !combinedPolys.length || combinedPolys.every(poly => !poly.isPositive) ) return [];

  // At this point, there should not be any holes.
  // Holes go top-to-bottom, so any hole cuts the polygon in two from a cutaway perspective.
  if ( combinedPolys.some(poly => !poly.isPositive) ) console.error("Combined cutaway polygons still have holes.");
  // combinedPolys.forEach(poly => Draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5 }))
  return combinedPolys;
}


/**
 * Create path for a given straight line segment that may move through regions.
 * Waypoints are added if passing through the region changes the path (currently, changes in elevation only).
 * Only unique waypoints are kept.
 * @param {RegionMovementWaypoint} start          Start of the path
 * @param {RegionMovementWaypoint} end            End of the path
 * @param {Point[]} [samples]                     The points relative to the waypoint that are tested.
 *                                                Whenever one of them is inside the region, the moved object
 *                                                is considered to be inside the region.
 * @param {boolean} [teleport=false]              Is it teleportation?
 * @returns {PathArray<RegionMovementWaypoint>}   Sorted points by distance from start.
 */
export function constructRegionsPath(start, end, samples, teleport = false) {
  if ( !canvas.regions?.placeables || !canvas.regions.placeables.length ) return [start, end];
  samples ??= [{x: 0, y: 0}];
  const { ENTER, EXIT, MOVE } = Region.MOVEMENT_SEGMENT_TYPES;
  const finalWaypoints = new PathArray();
  finalWaypoints.push(start);
  const regionSegments = new Map();
  let currRegion;

  // Determine the paths for each region and locate the path first encountered.
  updateRegionSegments(undefined, regionSegments, [start, end], { samples, teleport });
  let minDist = Number.POSITIVE_INFINITY;
  for ( const [region, segments] of regionSegments.entries() ) {
    if ( !segments.length ) continue;
    const segment = segments[0];
    segment.from.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, segment.from));
    if ( segment.from.dist2 >= minDist ) continue;
    minDist = segment.from.dist2;
    currRegion = region;
  }
  if ( !currRegion ) return [start, end]; // Regions present but none had segments present.

  // Construct waypoints from the chosen region's segments.
  let currSegments = regionSegments.get(currRegion);
  if ( !currSegments.length ) return [start, end]
  const pathWaypoints = PathArray.fromSegments(currSegments, { start, end });

  // Update all the other region paths.
  updateRegionSegments(currRegion, regionSegments, pathWaypoints, { samples, teleport });
  if ( regionSegments.size < 2 ) return pathWaypoints;


  // Walk along the current path.
  // At each move segment, determine if there is an intersection with another region.
  // If the intersection takes the path higher, use that intersection and switch to the new region.
  // Update the other region paths based on the new path.
  const MAX_ITER = 1e03;
  let iter = 0;
  let tmpEnd = {...end};
  for ( let i = 0, n = currSegments.length; i < n; i += 1 ) {
    iter += 1;
    if ( iter > MAX_ITER ) {
      console.error(`constructRegionsPath|Hit max iterations for ${start.x},${start.y},${start.elevation} -> ${end.x},${end.y},${end.elevation} at i ${i}`, regionSegments, currSegments);
      break;
    }
    const currSegment = currSegments[i];
    switch ( currSegment.type ) {
      case ENTER: finalWaypoints.push(currSegment.to); continue;
      case EXIT: {
        finalWaypoints.push(currSegment.from);

        // If finished this region's path, check for other paths.
        // TODO: Can we simplify this? Combine with other tests to find region segments?
        if ( ( i + 1 ) === n ) {
          // Refresh the other regions.
          tmpEnd.elevation = currSegment.to.elevation;
          const newWaypoints = [...finalWaypoints, tmpEnd];
          updateRegionSegments(currRegion, regionSegments, newWaypoints, { samples, teleport });

          // Next closest region path that is at least currSegment.to.dist2 away
          currSegment.to.dist2 ??= PIXI.Point.distanceBetween(start, currSegment.to);
          const res = closestRegionSegmentToDistance(currRegion, regionSegments, currSegment.to.dist2, start);
          if ( res.region ) {
            currRegion = res.region;
            currSegments = regionSegments.get(currRegion);
            i = res.idx;
            n = currSegments.length;
          }
        }
        continue;
      }
    }

    // Test for intersections with this segment.
    // 1. New region entered.
    //    - plateau: moves to elevation
    //    - ramp: moves to elevation
    //    - stairs: moves up/down
    // 2. Existing region. Circumstance where existing region overrides current path?
    //    - start point is the trigger
    //    - Existing region is ramp or plateau and we are starting at its elevation

    // Use finalWaypoints.at(-1) in case we already processed an intersection along this segment.
    const intersection = findRegionShift(finalWaypoints.at(-1), currSegment.to, currRegion, regionSegments, start);

    // Take the closest intersection found (what entered first).
    if ( intersection && !regionWaypointsEqual(currSegment.to, intersection.ix) ) {
      // Push the intersection point as a waypoint.
      finalWaypoints.push(intersection.ix);

      // Switching regions, so invalidate the end elevation.
      tmpEnd.elevation = intersection.ix.elevation;

      // Update all regions to follow this combined path, including the intersection.
      const newWaypoints = [...finalWaypoints, tmpEnd];
      updateRegionSegments(undefined, regionSegments, newWaypoints, { samples, teleport });

      // Fast forward to the current index.
      const ixSegments = regionSegments.get(intersection.region);
      let idx = closestSegmentIndexToPosition(ixSegments, intersection.ix, start); // Where in the new segment path are we?
      const ixSegment = ixSegments[idx];
      if ( !ixSegment ) console.debug(`currSegment not defined for at ${intersection.ix.x},${intersection.ix.y},${intersection.ix.elevation}`, ixSegments);
      if ( ixSegment.type !== MOVE ) idx += 1;
      i = idx - 1; // Subtract one b/c of the for loop increment.
      currSegments = ixSegments;
      currRegion = intersection.region;
      n = currSegments.length;
      continue;
    }

    // Add the end of the move segment.
    finalWaypoints.push(currSegment.to);
  }

  // Trim intervening points.
  // As the path is a straight line in 2d, can trim any point between two points that share an elevation.
//   for ( let i = finalWaypoints.length - 2; i > 0; i -= 1 ) { // skip first and last point
//     const b = finalWaypoints[i];
//     const a = finalWaypoints[i - 1];
//     const c = finalWaypoints[i + 1];
//     if ( a.elevation === b.elevation && b.elevation === c.elevation ) finalWaypoints.splice(i, 1);
//   }
  return finalWaypoints;
}

/**
 * Select the region closest by distance but at least x distance away.
 * @param {Region} currRegion
 * @param {Map<Region, RegionMovementSegment[]>} regionSegments
 * @param {number} minDist2
 */
function closestRegionSegmentToDistance(currRegion, regionSegments, minDist2, start) {
  let foundMin = Number.POSITIVE_INFINITY;
  let foundRegion;
  let foundIdx = -1;
  for ( const [region, segments] of regionSegments.entries() ) {
    if ( region === currRegion ) continue;
    for ( let i = 0, n = segments.length; i < n; i += 1 ) {
      const segment = segments[i];
      segment.from.dist2 ??= PIXI.Point.distanceBetween(start, segment.from);
      if ( segment.from.dist2 < minDist2 ) continue;
      if ( segment.from.dist2 < foundMin ) {
        foundMin = segment.from.dist2;
        foundRegion = region;
        foundIdx = i;
      }
      break;
    }
  }
  return { region: foundRegion, idx: foundIdx };
}

export function drawRegionMovement(segments) {
 for ( const segment of segments ) drawRegionSegment(segment);
}

function drawRegionSegment(segment) {
  const Draw = CONFIG.GeometryLib.Draw
  const color = segment.type === Region.MOVEMENT_SEGMENT_TYPES.ENTER
    ?  Draw.COLORS.green
      : segment.type === Region.MOVEMENT_SEGMENT_TYPES.MOVE ? Draw.COLORS.orange
        : Draw.COLORS.red;
  const A = segment.from;
  const B = segment.to;
  Draw.point(A, { color });
  Draw.point(B, { color });
  Draw.segment({ A, B }, { color })
}

/**
 * Draw cutaway of the region segments.
 */
export function drawRegionMovementCutaway(segments) {
  const pathWaypoints = PathArray.fromSegments(segments);
  drawRegionPathCutaway(pathWaypoints)
}

/**
 * For debugging.
 * Draw line segments on the 2d canvas connecting the 2d parts of the path.
 * @param {PathArray<RegionMoveWaypoint>} path
 */
export function drawRegionPath(path, { color } = {}) {
  const Draw = CONFIG.GeometryLib.Draw
  color ??= Draw.COLORS.blue;
  for ( let i = 1; i < path.length; i += 1 ) {
    const A = path[i - 1];
    const B = path[i];
    Draw.point(A, { color });
    Draw.point(B, { color });
    Draw.segment({ A, B }, { color })
  }
}

/**
 * For debugging.
 * Draw line segments representing a cut-away of the path, where
 * 2d distance is along the x and elevation is y. Starts at path origin.
 * @param {PathArray<RegionMoveWaypoint>} path
 */
export function drawRegionPathCutaway(path) {
  const color = CONFIG.GeometryLib.Draw.COLORS.red;
  const start = path[0];
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const nSegments = path.length;
  const cutaway = Array(nSegments);
  for ( let i = 0; i < nSegments; i += 1 ) {
    const p = path[i];
    cutaway[i] = new PIXI.Point(PIXI.Point.distanceBetween(start, p), -gridUnitsToPixels(p.elevation));
  }

  // Rotate the cutaway to match the path angle then translate to start.
  const end = path.at(-1);
  let angle = Math.atan2(end.y - start.y, end.x - start.x);
  if ( angle > Math.PI_1_2 || angle < -Math.PI_1_2 ) {
    cutaway.forEach(p => p.y = -p.y);
  }

  const mRot = CONFIG.GeometryLib.Matrix.rotationZ(angle, false);
  const delta = {...path[0]};
  cutaway.forEach(p => {
    const tmp = mRot.multiplyPoint2d(p).add(delta);
    p.copyFrom(tmp);
  });

  drawRegionPath(cutaway, { color });
  return cutaway;
}
