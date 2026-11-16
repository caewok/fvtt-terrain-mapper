/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/** Token movement rules related to regions.
A token walking should move to ground and stay on the ground.
A flying token should not lose elevation.
A burrowing token should not gain elevation.
*/


/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

import { MODULE_ID, FLAGS } from "./const.js";
import { log } from "./util.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";
import { TokenElevationHandler, validateWaypointPath, waypointSignature } from "./TokenElevationHandler.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.ELEVATION = {};

/** Maximum number of waypoints a single built path may have before it is discarded. */
const MAX_PATH_WAYPOINTS = 1000;

/** Waypoint properties that core fills in from the previous waypoint (or the token source) when missing. */
const INHERITED_KEYS = ["x", "y", "elevation", "width", "height", "depth", "shape", "level", "action"];

const round1 = v => Math.round(v * 10) / 10;


// ----- NOTE: Wraps ----- //

/**
 * Determine the path for a given start and end. Must be center points.
 * @param {Token} token
 * @param {ElevatedPoint} aCenter
 * @param {ElevatedPoint} bCenter
 */
export function calculatePathForCenterPoints(token, aCenter, bCenter) {
  log(`calculatePathForCenterPoints|Calculating path for ${token.name}: ${aCenter.x},${aCenter.y}, @${aCenter.elevation} --> ${bCenter.x},${bCenter.y}, @${bCenter.elevation}.\tFlying: ${this[MODULE_ID].flying}\tBurrowing:${this[MODULE_ID].burrowing}\tWalking:${this[MODULE_ID].walking}`);
  return this[MODULE_ID].constructPath(aCenter, bCenter);
}

/** TokenGetTerrainMovementPathWaypoint
 * @property {number} [x]                       The top-left x-coordinate in pixels (integer).
 *                                              Default: the previous or source x-coordinate.
 * @property {number} [y]                       The top-left y-coordinate in pixels (integer).
 *                                              Default: the previous or source y-coordinate.
 * @property {number} [elevation]               The elevation in grid units.
 *                                              Default: the previous or source elevation.
 * @property {number} [width]                   The width in grid spaces (positive).
 *                                              Default: the previous or source width.
 * @property {number} [height]                  The height in grid spaces (positive).
 *                                              Default: the previous or source height.
 * @property {TokenShapeType} [shape]           The shape type (see {@link CONST.TOKEN_SHAPES}).
 *                                              Default: the previous or source shape.
 * @property {string} [action]                  The movement action from the previous to this waypoint.
 *                                              Default: the previous or prepared movement action.
 * @property {boolean} [snapped=false]          Was this waypoint snapped to the grid? Default: `false`.
 * @property {boolean} [explicit=false]         Was this waypoint explicitly placed by the user? Default: `false`.
 * @property {boolean} [checkpoint=false]       Is this waypoint a checkpoint? Default: `false`.
 * @property {boolean} [intermediate=false]     Is this waypoint intermediate? Default: `false`.
 */

/**
 * Wrap Token#createTerrainMovementPath
 * Add in waypoints for plateaus/ramps
 *
 * Core calls this repeatedly for a single drag:
 *   - Token#findMovementPath (the drag path search)
 *   - Token#updatePlannedMovement (every ruler refresh, on the already-built found path)
 *   - TokenDocument#preUpdateMovement (at the drop, for the passed and the pending waypoints)
 * Keyboard movement only hits the last of these.
 * The path is built once. Later calls are skipped if
 *   (a) the drop explicitly flags the path as prebuilt (see _getDragLeftDropUpdateOptions), or
 *   (b) the incoming waypoints are the output (or a prefix of the output) we last built for this token.
 * Any failure falls back to the unmodified waypoints rather than to a guessed path.
 *
 * ----
 * @param {TokenGetTerrainMovementPathWaypoint[]} waypoints    The waypoints of movement
 * @param {object} [options]                                   Additional options
 * @param {boolean} [options.preview=false]                    Is preview?
 * @returns {TokenTerrainMovementWaypoint[]}                   The movement path with terrain data
 */
function createTerrainMovementPath(wrapped, waypoints, options = {}) {
  log(`createTerrainMovementPath|${this.document.name} from ${waypoints[0].x},${waypoints[0].y},${waypoints[0].elevation} to ${waypoints.at(-1).x},${waypoints.at(-1).y},${waypoints.at(-1).elevation}`,
    { prebuilt: options?.[MODULE_ID]?.prebuilt, numWaypoints: waypoints.length, dragged: this.isDragged, preview: this.isPreview } );

  if ( waypoints.length < 2
    || options?.[MODULE_ID]?.prebuilt
    || !canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.CONSTRAIN_ELEVATION) ) return wrapped(waypoints, options);

  if ( CONFIG[MODULE_ID].debug && PIXI.Point.distanceBetween(waypoints[0], waypoints.at(-1)) >= 1000 ) log("\tLong path");

  const tm = this[MODULE_ID];
  let built;
  try {
    // Fill defaults and snap x,y to integers exactly as core will, so what we plan is what core stores.
    const input = _normalizeWaypoints(this, waypoints);

    // Already our output (e.g., ruler refresh or commit of a dragged path)? Nothing to do.
    if ( tm.isBuiltOutput(waypointSignature(input)) ) {
      log(`createTerrainMovementPath|Skipping; ${input.length} waypoints already built.`);
      return wrapped(waypoints, options);
    }

    if ( CONFIG[MODULE_ID].debug ) console.table(input);
    built = _buildTerrainPath(this, input);

    // Nothing to build (e.g., zero-length move, or waypoints that all share one position): leave it to core.
    // The input is core's, not ours, so it is neither validated as our output nor remembered as such.
    if ( !built ) return wrapped(waypoints, options);

    // Global sanity check: segment-level checks were already done in _buildPathBetweenTwoWaypoints.
    const { valid, errors } = validateWaypointPath(built, { maxPoints: MAX_PATH_WAYPOINTS });
    if ( !valid ) throw new Error(`Invalid path: ${errors.join("; ")}`);
    tm.rememberOutput(waypointSignature(built));

  } catch( err ) {
    console.error(`${MODULE_ID}|createTerrainMovementPath failed; using the unmodified path.`, err);
    return wrapped(waypoints, options);
  }

  if ( CONFIG[MODULE_ID].debug ) console.table(built);
  return wrapped(built, options);
}

/**
 * Wrap Token#_getDragLeftDropUpdateOptions
 * The path of a dragged token was already built while dragging. Flag the commit so that
 * TokenDocument#preUpdateMovement does not build it again.
 * (Only the drop uses these options; the drag-time calls are unaffected.)
 */
function _getDragLeftDropUpdateOptions(wrapped, ...args) {
  const opts = wrapped(...args);
  opts.terrainOptions = { ...opts.terrainOptions, [MODULE_ID]: { prebuilt: true } };
  return opts;
}

/**
 * Copy the waypoints, filling in missing properties from the previous waypoint (or token source)
 * as core does, and rounding x,y to integers as core does.
 * @param {Token} token
 * @param {TokenGetTerrainMovementPathWaypoint[]} waypoints
 * @returns {TokenGetTerrainMovementPathWaypoint[]}
 */
function _normalizeWaypoints(token, waypoints) {
  const src = token.document._source;
  let prev = {
    x: src.x, y: src.y, elevation: src.elevation,
    width: src.width, height: src.height, depth: src.depth, shape: src.shape, level: src.level,
    action: token.document.movementAction };
  return waypoints.map(waypoint => {
    const out = { ...waypoint };
    for ( const key of INHERITED_KEYS ) out[key] ??= prev[key];
    out.x = Math.round(out.x);
    out.y = Math.round(out.y);
    prev = out;
    return out;
  });
}

/**
 * Build the terrain path for a set of normalized waypoints.
 * @param {Token} token
 * @param {TokenGetTerrainMovementPathWaypoint[]} input     Normalized waypoints
 * @returns {TokenGetTerrainMovementPathWaypoint[]|null}   Null if there is nothing to build.
 */
function _buildTerrainPath(token, input) {
  const n = input.length;

  // Simplify to start, end, and any checkpoints or explicit waypoints.
  const waypoints = input.filter((pt, idx) => idx === 0 || idx === (n - 1)
    || (!pt.intermediate && (pt.explicit || pt.checkpoint)));

  const out = [waypoints[0]];
  for ( let i = 1, maxI = waypoints.length; i < maxI; i += 1 ) {
    const start = out.at(-1);
    const next = waypoints[i];
    const action = next.action;
    const cfg = CONFIG[MODULE_ID];
    const movementOpts = {
      flying: cfg.terrainFlightActions.has(action),
      burrowing: cfg.terrainBurrowActions.has(action),
      walking: cfg.terrainWalkActions.has(action) };

    const segment = (start.level === next.level)
      ? _buildPathBetweenTwoWaypoints(start, next, token, movementOpts)
      : _buildLevelChange(next, token, movementOpts);
    _appendWithoutDuplicates(out, segment);
  }

  // A zero-length move: every waypoint is at the start position. Signal the caller to leave it to core.
  if ( out.length < 2 ) return null;
  return out;
}

/**
 * Moving to another level: don't touch the waypoints, but enforce gravity after the move.
 * @param {TokenGetTerrainMovementPathWaypoint} next
 * @param {Token} token
 * @param {object} movementOpts       Flags for flying, burrowing, walking
 * @returns {TokenGetTerrainMovementPathWaypoint[]}
 */
function _buildLevelChange(next, token, movementOpts) {
  const out = [next];
  const destCtr = _centerWaypoint(next, token);
  const newLocation = token[MODULE_ID].enforceGravity(destCtr, { levelId: next.level, ...movementOpts });
  if ( !newLocation.almostEqual(destCtr) ) {
    // Add the move from dest to new location.
    _uncenterPathPointInPlace(newLocation, token);
    out.push({ ...next,
      x: Math.round(newLocation.x),
      y: Math.round(newLocation.y),
      elevation: round1(newLocation.elevation),
    });
  }
  return out;
}

/**
 * Build the path between two waypoints on the same level.
 * Falls back to the end waypoint alone (no terrain adjustment) if the path is invalid.
 * @param {TokenGetTerrainMovementPathWaypoint} start
 * @param {TokenGetTerrainMovementPathWaypoint} end
 * @param {Token} token
 * @param {object} [movementOpts]       Flags for flying, burrowing, walking
 * @returns {TokenGetTerrainMovementPathWaypoint[]} The waypoints for the path, not including start.
 */
function _buildPathBetweenTwoWaypoints(start, end, token, movementOpts = {}) {
  const tm = token[MODULE_ID];
  const levelId = start.level || canvas.level.id;
  const a = _centerWaypoint(start, token);
  const b = _centerWaypoint(end, token);

  // ConstructPath initializes the handler for this segment if needed.
  let path;
  try {
    path = tm.constructPath(a, b, { ...movementOpts, levelId });
  } catch( err ) {
    console.error(`${MODULE_ID}|constructPath failed for ${a} --> ${b}`, err);
    return [{ ...end }];
  }
  path.forEach(pt => _uncenterPathPointInPlace(pt, token));

  // Use the end waypoint parameters, changing only what is necessary.
  // Snap to what core will store: integer x,y; elevation to 0.1.
  const out = [];
  const lastIdx = path.length - 1;
  for ( let j = 1; j <= lastIdx; j += 1 ) {
    const pathPt = path[j];
    const isLast = j === lastIdx;
    if ( isLast ) {
      // Keep the end flags and the exact end x,y; only the elevation may change.
      out.push({ ...end, elevation: round1(pathPt.elevation) });
    } else {
      out.push({ ...end,
        checkpoint: false,
        intermediate: false,
        snapped: false,
        explicit: false,
        x: Math.round(pathPt.x),
        y: Math.round(pathPt.y),
        elevation: round1(pathPt.elevation),
      });
    }
  }

  // After rounding to what core stores, points may land on the same x,y: collapse up/down/up runs at
  // one x,y to the first and last point, then merge duplicates.
  const clean = [start];
  _appendWithoutDuplicates(clean, _collapseVerticalRuns([start, ...out]).slice(1));
  const cleaned = clean.slice(1);

  // Degenerate path (start equals end): keep the end waypoint so its flags are not lost.
  if ( !cleaned.length ) cleaned.push({ ...end });

  const { valid, errors } = validateWaypointPath([start, ...cleaned], { start, end, maxPoints: MAX_PATH_WAYPOINTS });
  if ( !valid ) {
    log(`_buildPathBetweenTwoWaypoints|Invalid path ${a} --> ${b}: ${errors.join("; ")}`);
    return [{ ...end }];
  }
  return cleaned;
}

/**
 * A run of three or more consecutive waypoints at the same x,y is a vertical move with intermediate stops,
 * e.g., floor -> top -> floor from terrain narrower than a pixel. Keep only the first and last.
 * Flags (checkpoint, explicit) of the dropped waypoints are merged into the last.
 * @param {TokenGetTerrainMovementPathWaypoint[]} points
 * @returns {TokenGetTerrainMovementPathWaypoint[]}
 */
function _collapseVerticalRuns(points) {
  const out = [];
  for ( let i = 0; i < points.length; ) {
    let j = i;
    while ( (j + 1) < points.length && points[j + 1].x === points[i].x && points[j + 1].y === points[i].y ) j += 1;
    if ( (j - i) >= 2 ) {
      const last = points[j];
      for ( let k = i + 1; k < j; k += 1 ) {
        last.checkpoint ||= points[k].checkpoint;
        last.explicit ||= points[k].explicit;
      }
      out.push(points[i], last);
    } else for ( let k = i; k <= j; k += 1 ) out.push(points[k]);
    i = j + 1;
  }
  return out;
}

/**
 * Append waypoints, merging any that land on the same position (after core's rounding) as the previous one.
 * A merged waypoint keeps the union of the checkpoint/explicit flags so a user's waypoint is never lost.
 * @param {TokenGetTerrainMovementPathWaypoint[]} out     Modified in place
 * @param {TokenGetTerrainMovementPathWaypoint[]} segment
 */
function _appendWithoutDuplicates(out, segment) {
  for ( const pt of segment ) {
    const prev = out.at(-1);
    const same = prev.x === pt.x && prev.y === pt.y && prev.level === pt.level
      && Math.abs(prev.elevation - pt.elevation) < 0.05;
    if ( !same ) { out.push(pt); continue; }
    if ( out.length === 1 ) continue; // Duplicate of the origin; drop it.
    prev.checkpoint ||= pt.checkpoint;
    prev.explicit ||= pt.explicit;
    prev.snapped ||= pt.snapped;
  }
}

/**
 * Move the waypoint to the token center, keeping the other waypoint properties.
 * @param {TokenGetTerrainMovementPathWaypoint}
 * @param {Token}
 * @returns {TokenGetTerrainMovementPathWaypoint}
 */
function _centerWaypoint(waypoint, token) {
  const ctr = token.getCenterPoint(waypoint);
  return ElevatedPoint.fromLocationWithElevation(ctr, waypoint.elevation);
}

/**
 * Move a centered waypoint to the token TL, keeping the other waypoint properties.
 * @param {TokenGetTerrainMovementPathWaypoint}
 * @param {Token}
 * @returns {TokenGetTerrainMovementPathWaypoint}
 */
function _uncenterPathPointInPlace(pathPt, token) {
  const tl = token.getTopLeft(pathPt.x, pathPt.y);
  pathPt.x = tl.x;
  pathPt.y = tl.y;
  return pathPt;
}


PATCHES.BASIC.WRAPS = {
  createTerrainMovementPath,
  _getDragLeftDropUpdateOptions,
};


// ----- NOTE: Mixed Wraps ----- //

/**
 * Test for collisions along a path.
 * @param {ElevatedPoint[]} path
 * @param {Token} token
 * @returns {boolean}
 */
export function hasCollisionAlongPath(path, token) {
  let a = path[0];
  for ( let i = 1, n = path.length; i < n; i += 1 ) {
    const b = path[i];
    if ( token.checkCollision(b, { origin: a}) ) return true;
    a = b;
  }
  return false;
}


// ----- NOTE: Methods ----- //

/**
 * Calculate the top left corner location for a token given an assumed center point.
 * Used for automatic terrain determination.
 * @param {number} x    Assumed x center coordinate
 * @param {number} y    Assumed y center coordinate
 * @returns {PIXI.Point}
 */
function getTopLeft(x, y) {
  return new PIXI.Point(x - (this.w * 0.5), y - (this.h * 0.5));
}

PATCHES.BASIC.METHODS = {
  getTopLeft
};

// ------ NOTE: Getters ------ //

/**
 * New getter: Token#terrainmapper
 * Class that handles elevation settings and calcs for a region.
 * @type {TokenElevationHandler}
 */
function terrainmapper() { return (this._terrainmapper ??= new TokenElevationHandler(this)); }

PATCHES.ELEVATION.GETTERS = { terrainmapper };