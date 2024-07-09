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
import { log, isFirstGM, regionWaypointsXYEqual, regionWaypointsEqual } from "../util.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Plane } from "../geometry/3d/Plane.js";

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
    const ix = p.lineSegmentIntersection(Point3d._tmp.copyFrom(a), Point3d._tmp2.copyFrom(b));
    if ( !ix ) return null;

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

    // Use the cross product to get the orthogonal direction.
    const dir = max.subtract(min);
    const c = dir.cross(Point3d._tmp.set(0, 0, 1));

    // Get a point at the same elevation as min in the given direction.
    const other = min.add(c);
    return Plane.fromPoints(min, max, other);
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
 * Get all the terrains that should currently be applied to a token via elevation behaviors.
 * @param {Token } token
 * @returns {Set<Terrain>}
 */
// function getAllElevationTerrainsForToken(token) {
//   const Terrain = CONFIG[MODULE_ID].Terrain;
//   const terrains = new Set();
//   for ( const region of token.document.regions.values() ) {
//     for ( const behavior of region.behaviors.values() ) {
//       if ( behavior.type !== `${MODULE_ID}.setElevation` || behavior.disabled ) continue;
//       behavior.system.terrains.forEach(id => {
//         const terrain = Terrain._instances.get(id);
//         if ( terrain ) terrains.add(terrain);
//       });
//     }
//   }
//   return terrains;
// }

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
    const segments = region.segmentizeMovement(waypoints, samples, { teleport, freefall: true });
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
 * Build a region path waypoint from a segment in `region.segmentizeMovement`.
 * @param {RegionMovementSegment} segment             Segment to which this applies
 * @param {Region} region                             Region to which the segment belongs
 * @param {RegionMovementWaypoint} start              Starting waypoint
 * @returns {RegionPathWaypoint}
 */
// class RegionPathWaypoint {
//   /** @type {Set<Region>} */
//   enter = new Set();
//
//   /** @type {Set<Region>} */
//   exit = new Set();
//
//   /** @type {Set<Region>} */
//   move = new Set();
//
//   /** @type {number} */
//   x = 0;
//
//   /** @type {number} */
//   y = 0;
//
//   /** @type {number} */
//   elevation = 0;
//
//   /** @type {number} */
//   dist2 = 0;
//
//   /** @type {number} */
//   idx = 0;
//
//   constructor(waypoint, start) {
//     this.x = waypoint.x;
//     this.y = waypoint.y;
//     this.elevation = waypoint.elevation;
//     this.dist2 = PIXI.Point.distanceSquaredBetween(start, waypoint);
//   }
//
//   /**
//    * Is this region within this waypoint?
//    * @param {Region} region
//    * @returns {boolean}
//    */
//   hasRegion(region) { return this.enter.has(region) || this.exit.has(region) || this.move.has(region); }
//
//   static fromRegionSegment(segment, region, start) {
//     const waypointFrom = new this(segment.from, start);
//     const waypointTo = new this(segment.to, start);
//     waypointTo.idx = 1;
//
//     // Add regions that are present at each waypoint.
//     switch ( segment.type ) {
//       case Region.MOVEMENT_SEGMENT_TYPES.EXIT: waypointFrom.exit.add(region); break;
//       case Region.MOVEMENT_SEGMENT_TYPES.MOVE: waypointFrom.move.add(region); waypointTo.move.add(region); break;
//       case Region.MOVEMENT_SEGMENT_TYPES.ENTER: waypointTo.enter.add(region); break;
//     }
//     return [waypointFrom, waypointTo];
//   }
// }

// function copyWaypoint(waypoint) {
//   const { x, y, elevation } = waypoint;
//   return { x, y, elevation };
// }



/**
 * Convert region waypoint to a Point3d object
 * @param {RegionMovementWaypoint} waypoint     Object with {x, y, elevation}, where elevation is in grid units
 * @returns {Point3d}
 */
// function regionWaypointToPoint3d(waypoint, outPoint = new Point3d()) {
//   outPoint.copyFrom(waypoint);
//   outPoint.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(waypoint.elevation);
//   return outPoint;
// }


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
function findRegionShift(a, b, currRegion, regionSegments) {
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
    const abSegments = testRegion.segmentizeMovement([a, b], samples, { teleport, freefall: true });
    if ( !abSegments.length) continue;

    const testSegment = abSegments[0];
    let testIx = null;
    switch ( testSegment.type ) {
      case EXIT: break;
      case ENTER: {
        // Always switch on an entry.
        testIx = testSegment.to;
        break;
      }
      case MOVE: {
        if ( setElevationB.system.algorithm === FLAGS.REGION.CHOICES.STAIRS ) break;

        // Switch if moving down (slope -∞) or if the test slope exceeds the current slope.
        if ( !(currSlope === Number.NEGATIVE_INFINITY || zSlope2(testSegment.from, testSegment.to) > currSlope) ) break;

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
 * Locate all intersections with this segment and return the closest that moves the elevation higher.
 * @param {RegionMovementWaypoint} a
 * @param {RegionMovementWaypoint} b
 * @param {Map<Region, RegionMovementSegment[]} regionSegments
 * @returns {object}
 * - @param {Region} region
 * - @param {Intersection} ix
 * - @param {RegionMovementSegment} segment
 */
function findClosestSegmentIntersection(a, b, currRegion, regionSegments, start) {
  a.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, a));
  b.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, b));
  const intersections = [];
  for ( const [region, segments] of regionSegments.entries() ) {
    if ( region === currRegion ) continue;
    for ( const segment of segments ) {
      // This is sweep along low dist2 to high dist2 direction
      segment.from.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, segment.from));
      if ( segment.from.dist2 > b.dist2 ) break; // Fully past a|b in dist2 direction.

      // If the segment does not move us higher, skip.
      if ( segment.to.elevation <= b.elevation ) continue;

      // Ignore enter/exit segments b/c they are really points.
      if ( segment.type !== Region.MOVEMENT_SEGMENT_TYPES.MOVE ) continue;

      // Test if we have reached the a|b segment.
      segment.to.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, segment.to));
      if ( segment.to.dist2 < a.dist2 ) continue;

      // If the segment does not cross the start or end distance, skip.
      segment.from.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, segment.from));
      segment.to.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, segment.to));

      // Confirm intersection, using x: dist2 and y: elevation as the coordinate system.
      const ix = foundry.utils.lineSegmentIntersection(
        convertRegionWaypointTo2d(a, start),
        convertRegionWaypointTo2d(b, start),
        convertRegionWaypointTo2d(segment.from, start),
        convertRegionWaypointTo2d(segment.to, start));
      if ( !ix ) continue;
      intersections.push({ region, segment, ix });
    }
  }
  if ( !intersections.length ) return null;

  // Return the closest intersection.
  intersections.sort((a, b) => a.ix.t0 - b.ix.t0);
  return intersections[0];
}

/**
 * Convert a region waypoint to a 2d point based on distance from start.
 * @param {RegionWaypoint} waypoint
 * @param {RegionWaypoint} start
 * @returns {PIXI.Point}
 */
function convertRegionWaypointTo2d(waypoint, start) {
  waypoint.dist2 ??= Math.round(PIXI.Point.distanceSquaredBetween(start, waypoint));
  return new PIXI.Point(waypoint.dist2, waypoint.elevation);
}

/**
 * Convert the 2d segment point to a region waypoint.
 * @param {PIXI.point} pt
 * @param {RegionWaypoint} start
 * @returns { RegionWaypoint}
 */
function convert2dPointToRegionWaypoint(pt, start, end) {
  const startPt = PIXI.Point._tmp.copyFrom(start);
  const ixPt = startPt.towardsPointSquared(PIXI.Point._tmp2.copyFrom(end), pt.x);
  ixPt.elevation = pt.y;
  return ixPt;
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
    regionSegments.set(region, region.segmentizeMovement(newWaypoints, samples, { teleport, freefall: true }));
  });
}

/**
 * For a given array of region segments, locate the segment closest to a given point.
 * Assumes the segments represent a straight 2d line, with possible elevation changes.
 * @param {RegionMovementSegment[]} segments
 * @param {RegionWaypoint} waypoint           Point along the segments path.
 * @param {RegionWaypoint} [start]       Starting waypoint for the segment path. Used to determine distance.
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
    segment.to.dist2d ??= PIXI.Point.distanceSquaredBetween(start, segment.to);
    if ( segment.to.dist2d < waypoint.dist2 ) continue;

    // If the from waypoint is greater, we have gone too far.
    segment.from.dist2d ??= PIXI.Point.distanceSquaredBetween(start, segment.from);
    if ( segment.from.dist2d > waypoint.dist2 ) break;

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
 * Does this region have a valid, enabled setElevation behavior?
 * @param {Region} region
 * @returns {boolean}
 */
function hasSetElevation(region) {
  return region.document.behaviors.some(b => !b.disabled && b.type === `${MODULE_ID}.setElevation`)
}

/**
 * Retrieve this region's setElevation behavior, if any.
 * @param {Region} region
 * @returns {RegionBehavior}
 */
function findSetElevation(region) {
  return region.document.behaviors.find(b => !b.disabled && b.type === `${MODULE_ID}.setElevation`)
}

/**
 * Retrieve all regions with a valid setElevation behavior
 * @param {Region[]} [regions]    Regions to use, if not all regions on the canvas
 * @returns {Region[]}
 */
function regionsWithSetElevation(regions) {
  regions ??= canvas.regions?.placeables;
  if ( !regions ) return [];
  return regions.filter(region => hasSetElevation(region));
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

  // Are we starting in a region?
  end = {...end};
  const startingRegion = currRegion;
  if ( startingRegion.testPoint(start)
    || start.elevation === findSetElevation(startingRegion).system.plateauElevation(start) ) end.elevation = Number.MIN_SAFE_INTEGER;

  // Construct waypoints from the chosen region's segments.
  let currSegments = regionSegments.get(currRegion);
  if ( !currSegments.length ) return [start, end]
  const pathWaypoints = PathArray.fromSegments(currSegments, { start, end });

  // Update all the other region paths.
  updateRegionSegments(currRegion, regionSegments, pathWaypoints, { samples, teleport });
  if ( regionSegments.size < 2 ) return pathWaypoints;


  /*
    Elevation change up: will we enter another region and will it cause an elevation increase or a stairs down?
    Elevation change down: will we enter another region and will it cause an elevation increase or a stairs down?
      - Get the top elevation of each region; will be placed there
  */


  // Walk along the current path.
  // At each move segment, determine if there is an intersection with another region.
  // If the intersection takes the path higher, use that intersection and switch to the new region.
  // Update the other region paths based on the new path.
  const MAX_ITER = 1e04;
  let iter = 0;
  for ( let i = 0, n = currSegments.length; i < n; i += 1 ) {
    iter += 1;
    if ( iter > MAX_ITER ) {
      console.error(`constructRegionsPath|Hit max iterations for ${start.x},${start.y},${start.elevation} -> ${end.x},${end.y},${end.elevation} at i ${i}`, regionSegments, currSegments);
      break;
    }
    const currSegment = currSegments[i];
    switch ( currSegment.type ) {
      case ENTER: finalWaypoints.push(currSegment.to); continue;
      case EXIT: finalWaypoints.push(currSegment.from); continue;
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
    const intersection = findRegionShift(finalWaypoints.at(-1), currSegment.to, currRegion, regionSegments);

    // Take the closest intersection found (what entered first).
    if ( intersection ) {
      // Push the intersection point as a waypoint.
      finalWaypoints.push(intersection.ix);

      // Switching regions, so invalidate the end elevation.
      end.elevation = Number.MIN_SAFE_INTEGER;

      // Update all regions to follow this combined path, including the intersection.
      const newWaypoints = [...finalWaypoints, end];
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

  // If the last waypoint has negative infinity elevation, remove.
  if ( finalWaypoints.at(-1).elevation === Number.MIN_SAFE_INTEGER ) {
    console.warn("constructRegionsPath|final waypoint not finite.", finalWaypoints, start, end);
    finalWaypoints.at(-1).elevation = canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  }

  // Trim intervening points.
  // As the path is a straight line in 2d, can trim any point between two points that share an elevation.
  for ( let i = finalWaypoints.length - 2; i > 0; i -= 1 ) { // skip first and last point
    const b = finalWaypoints[i];
    const a = finalWaypoints[i - 1];
    const c = finalWaypoints[i + 1];
    if ( a.elevation === b.elevation && b.elevation === c.elevation ) finalWaypoints.splice(i, 1);
  }
  return finalWaypoints;
}




/**
 * Prepare region segments and associated iterator.
 * @param {RegionMovementWaypoint[]} waypoints     The path.
 * @returns {Iterator<RegionMovementSegment>}
 *  - @param {number}  Use next(dist2) to skip to the segment.to point that is after distance
 *    Distance measured from the initial waypoint.
 */
// function* regionSegmentIterator(region, waypoints) {
//   const samples = [{x: 0, y: 0}];
//   const teleport = false;
//   const origin = waypoints[0];
//   let last;
//   for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
//     const start = waypoints[i - 1];
//     const end = waypoints[i];
//     const regionSegments = region.segmentizeMovement([start, end], samples, { teleport});
//
//     // Avoid adding a duplicate segment.
//     const b = regionSegments[0];
//     let j = 0;
//     if ( last && b
//       && last.type === b.type
//       && last.to.x === b.from.x
//       && last.to.y === b.from.y
//       && last.to.elevation === b.from.elevation
//     ) j = 1;
//
//     for (let m = regionSegments.length; j < m; j += 1 ) {
//       last = regionSegments[j];
//       last.from.dist2 ??= PIXI.Point.distanceSquaredBetween(last.from, origin);
//       last.to.dist2 ??= PIXI.Point.distanceSquaredBetween(last.to, origin);
//       yield last;
//     }
//   }
// }

/**
 * Advance the segments to a given distance
 * @param {RegionMovementSegment[]} nextSegments
 */
// function advanceSegments(nextSegments, currDist2, iterators) {
//   for ( let i = 0, n = nextSegments.length; i < n; i += 1 ) {
//     nextSegments[i] = advanceSegment(nextSegments[i], currDist2, iterators[i]);
//   }
// }

/**
 * Skip to the next segment that is further from the start than current distance.
 * Don't call the iterator until past the current segment distance.
 * @param {RegionMovementSegment} currSegment
 * @param {number} currDist2
 * @param {Iterator<RegionMovementSegment>}
 * @returns {RegionMovementSegment}
 */
// function advanceSegment(currSegment, currDist2, iterator) {
//   while ( currSegment ) {
//     if ( currSegment.to.dist2 >= currDist2 ) return currSegment;
//     currSegment = iterator.next().value;
//   }
//   return undefined;
// }

/**
 * Find the closest segment to the start and return its index.
 * @param {RegionMovementSegment[]} segments
 * @param {number} minDist2                     The current position on the line, to test move segments.
 * @returns {number}
 */
// function closestSegmentIndex(segments) {
//   const { ENTER, MOVE, EXIT } = Region.MOVEMENT_SEGMENT_TYPES;
//   let closestIdx = -1;
//   let maxDist2 = Number.POSITIVE_INFINITY;
//   let elevation;
//   for ( let i = 0, n = segments.length; i < n; i += 1 ) {
//     const segment = segments[i];
//     if ( !segment ) continue; // Possible for segments in the array to be undefined.
//     if ( segment.from.dist2 > maxDist2 ) break;
//     if ( segment.from.dist2 === maxDist2 && segment.to.elevation <= elevation ) break;
//     closestIdx = i;
//     elevation = segment.to.elevation;
//     maxDist2 = segment.from.dist2;
//   }
//   return closestIdx;
// }

/**
 *

/**
 * Locate elevation intersections with other segments.
 * Set x to the distance squared and y to the elevation.
 * @param {RegionMovementSegment[]} nextSegments
 * @returns {object[]} Sorted intersection object.
 *   - @prop {RegionMovementSegment} otherSegment
 *   - @prop {Intersection} ix
 */
// function locateElevationIntersections(nextSegments, currIdx) {
//   const { ENTER, MOVE, EXIT } = Region.MOVEMENT_SEGMENT_TYPES;
//   const intersections = [];
//   const currSegment = nextSegments[currIdx];
//   const { lineSegmentIntersection, orient2dFast } = foundry.utils;
//   const a = { x: currSegment.from.dist2, y: currSegment.from.elevation };
//   const b = { x: currSegment.to.dist2, y: currSegment.to.elevation };
//   if ( currSegment.type !== MOVE ) return [];
//   for ( let i = 0, n = nextSegments.length; i < n; i += 1 ) {
//     if ( i === currIdx ) continue;
//     const otherSegment = nextSegments[i];
//     if ( !otherSegment ) continue;
//
//     const c = { x: otherSegment.from.dist2, y: otherSegment.from.elevation };
//     const d = { x: otherSegment.to.dist2, y: otherSegment.to.elevation };
//     const ix = lineSegmentIntersection(a, b, c, d);
//     if ( ix ) { intersections.push({ otherSegment, ix, idx: i }); continue; }
//
//     // If vertical, get the shared elevation point, if any.
//     if ( !(currSegment.from.x === otherSegment.from.x
//         && currSegment.from.y === otherSegment.from.y
//         && currSegment.to.x === otherSegment.to.x
//         && currSegment.to.y === otherSegment.to.y) ) continue;
//
//     // Use the from point for moves, exits; to point for enter
//     const otherPoint = otherSegment.type === ENTER ? otherSegment.to : otherSegment.from;
//     if ( otherPoint.elevation.between(currSegment.from.elevation, currSegment.to.elevation) ) {
//       const t0 = (otherPoint.elevation - currSegment.from.elevation) / (currSegment.to.elevation - currSegment.from.elevation)
//       intersections.push({ otherSegment, ix: { x: otherPoint.dist2, y: otherPoint.elevation, t0 }, idx: i })
//     }
//   }
//   intersections.sort((a, b) => a.ix.t0 - b.ix.t0)
//   return intersections;
// }

/**
 * Test for additional region paths due to an elevation change.
 * Once found, region path is fixed.
 * Adds iterators if new region paths found.
 * @param {RegionMovementWaypoint[]} waypoints              The new path
 * @param {Iterator<RegionMovementSegment>[]} iterators     The current iterators for the regions
 */
// function findAdditionalRegionPaths(waypoints, iterators) {
//   for ( let i = 0, n = iterators.length; i < n; i += 1 ) {
//     if ( iterators[i] ) continue;
//     const region = canvas.regions.placeables[i];
//     iterators[i] = regionSegmentIterator(region, waypoints);
//   }
// }


//
// function drawRegionMovement(segments) {
//  for ( const segment of segments ) drawRegionSegment(segment);
// }

// function drawRegionSegment(segment) {
//   const Draw = CONFIG.GeometryLib.Draw
//   const color = segment.type === Region.MOVEMENT_SEGMENT_TYPES.ENTER
//     ?  Draw.COLORS.green
//       : segment.type === Region.MOVEMENT_SEGMENT_TYPES.MOVE ? Draw.COLORS.orange
//         : Draw.COLORS.red;
//   const A = segment.from;
//   const B = segment.to;
//   Draw.point(A, { color });
//   Draw.point(B, { color });
//   Draw.segment({ A, B }, { color })
// }

/**
 * For debugging.
 * Draw line segments on the 2d canvas connecting the 2d parts of the path.
 * @param {PathArray<RegionMoveWaypoint>} path
 */
function drawRegionPath(path, { color } = {}) {
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
function drawRegionPathCutaway(path) {
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
