/* globals
canvas,
CONFIG,
CONST,
foundry,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log, isFirstGM } from "../util.js";
import { Point3d } from "../geometry/3d/Point3d.js";

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
      if ( behavior.type !== `${MODULE_ID}.setElevation` || behavior.disabled ) continue;
      behavior.system.terrains.forEach(id => {
        const terrain = Terrain._instances.get(id);
        if ( terrain ) terrains.add(terrain);
      });
    }
  }
  return terrains;
}

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
    const segments = region.segmentizeMovement(waypoints, samples, { teleport});
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
 * Debugging
 */
function drawPath(path) {
  const Draw = CONFIG.GeometryLib.Draw;
  const draw = new Draw();
  for ( let i = 1; i < path.length; i += 1 ) {
    const A = path[i - 1];
    const B = path[i];
    draw.point(A, { color: Draw.COLORS.blue });
    draw.point(B, { color: Draw.COLORS.blue });
    draw.segment({A, B}, { color: Draw.COLORS.blue });
    draw.labelPoint(B, path[i].elevation)
  }
}

