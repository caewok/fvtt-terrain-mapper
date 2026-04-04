/* globals
canvas,
CONFIG,
CONST,
game,
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
import { TokenElevationHandler } from "./TokenElevationHandler.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.RULER = {};
PATCHES.ELEVATION = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook updateToken
 * If disposition changes, change actor's unique effect status icon display.
 * @param {Document} document                       The Document instance being updated
 * @param {object} changed                          Differential data that will be used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modify the update request
 * @param {string} userId                           The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                          Explicitly return false to prevent update of this Document
 */
function updateToken(tokenD, changed, _options, userId) {
  const token = tokenD.object;
  if ( !token ) return;
  if ( !game.users.get(userId).isGM ) return;
  if ( !Object.hasOwn(changed, "disposition") ) return;
  const terrainDocs = CONFIG[MODULE_ID].Terrain._allUniqueEffectDocumentsOnToken(tokenD.object);
  if ( !terrainDocs.length ) return;

  if ( changed.disposition === CONST.TOKEN_DISPOSITIONS.SECRET ) {
    terrainDocs.forEach(doc => doc.update({ statuses: []})); // Async
  } else terrainDocs.forEach(doc => {
    if ( !doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.DISPLAY_ICON) ) return;
    doc.update({ statuses: [doc.img]}); // Async
  });
}



PATCHES.BASIC.HOOKS = {
  updateToken,
};

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
 * ----
 * @param {TokenGetTerrainMovementPathWaypoint[]} waypoints    The waypoints of movement
 * @param {object} [options]                                   Additional options
 * @param {boolean} [options.preview=false]                    Is preview?
 * @returns {TokenTerrainMovementWaypoint[]}                   The movement path with terrain data
 */
function createTerrainMovementPath(wrapped, waypoints, options) {
  if ( waypoints.length < 2 || !canvas.scene.getFlag(MODULE_ID, FLAGS.SCENE.CONSTRAIN_ELEVATION) ) return wrapped(waypoints, options);

  log(`createTerrainMovementPath|Initial Waypoints: ${waypoints.length} waypoints: ${ElevatedPoint.fromObject(waypoints[0])} --> ${ElevatedPoint.fromObject(waypoints.at(-1))}`);
  if ( CONFIG[MODULE_ID].debug ) console.table(waypoints);

  // Check if this is a basic elevation change. Allow, disallow, allow with elevation change.
  waypoints = waypoints.filter((pt, idx) => idx === 0 || (!pt.intermediate && (pt.explicit || pt.checkpoint)));
  const tm = this[MODULE_ID];

  // Testing
  // if ( waypoints.length > 2 ) console.log("Waypoints", waypoints);
  // if ( PIXI.Point.distanceBetween(waypoints[0], waypoints[1]) > 500 ) console.log("Waypoints distance > 500.");

  // log(`createTerrainMovementPath|After filter: ${waypoints.length} waypoints: ${ElevatedPoint.fromObject(waypoints[0])} --> ${ElevatedPoint.fromObject(waypoints.at(-1))}`);
  // if ( CONFIG[MODULE_ID].debug ) console.table(waypoints);

  // If the waypoints are in a straight line, can initialize the path handler here.
  // Otherwise, must do it in the loop.
  // Chances are, multiple waypoints indicate a turn in the path, so skip checking here.
  const newWaypoints = [waypoints[0]];
  let start = waypoints[0];
  for ( let i = 1, maxI = waypoints.length; i < maxI; i += 1 ) {
    const next = waypoints[i];
    const flying = CONFIG[MODULE_ID].terrainFlightActions.has(next.action);
    const burrowing = CONFIG[MODULE_ID].terrainBurrowActions.has(next.action);
    const walking = CONFIG[MODULE_ID].terrainWalkActions.has(next.action);

    // log(`createTerrainMovementPath|${ElevatedPoint.fromObject(start)} --> ${ElevatedPoint.fromObject(next)}`, { flying, burrowing, walking });
    const a = _centerWaypoint(start, this);
    const b = _centerWaypoint(next, this);
    tm.initialize(a, b);

    // If no regions or tiles, just allow the movement to continue as is.
    // Somewhat avoids issue where cannot change elevation when on the canvas, which can be unexpected.
    // Avoids having to explicitly set constrain movement to false in a scene.
    if ( !(tm.regions.length || (tm.tiles.length) )  ) {
      newWaypoints.push(next);
      start = next;
      continue;
    }

    const path = tm.constructPath(a, b, { flying, burrowing, walking });
    path.forEach(pt => _uncenterPathPointInPlace(pt, this));

    // Use the next waypoint parameters, changing only what is necessary.
    for ( let j = 1, maxJ = path.length - 1; j < maxJ; j += 1 ) {
      const pathPt = path[j];
      const waypoint = Object.assign({}, next, {
        checkpoint: false,
        intermediate: true,
        snapped: false,
        explicit: false,
        x: pathPt.x,
        y: pathPt.y,
        elevation: pathPt.elevation,
      });
      newWaypoints.push(waypoint);
    }

    // Update the next waypoint with the last path point.
    if ( path.length > 1 ) {
      const pathPt = path.at(-1);
      const waypoint = Object.assign({}, next, {
        x: pathPt.x,
        y: pathPt.y,
        elevation: pathPt.elevation,
      });
      newWaypoints.push(waypoint);
      start = waypoint;
    } else start = next;
  }

  // Testing
  if ( newWaypoints.length > 1000 ) {
    console.error(`createTerrainMovementPath|Too many waypoints! (${newWaypoints.length})`);
  }

  log(`createTerrainMovementPath|${newWaypoints.length} newWaypoints: ${ElevatedPoint.fromObject(newWaypoints[0])} --> ${ElevatedPoint.fromObject(newWaypoints.at(-1))}`);
  if ( CONFIG[MODULE_ID].debug ) console.table(newWaypoints);
  log(`\n\n`);

  return wrapped(newWaypoints, options);
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
//   _getAnimationData,
//   _onAnimationUpdate,
//   _getShiftedPosition,
  };


// ----- NOTE: Mixed Wraps ----- //

/**
 * Mixed wrap Token.prototype._prepareDragLeftDropUpdates
 * If the path has multiple steps for the token, commit each step and confirm the token destination.
 * Bypasses intermediate calls to Token.prototype.#commitDragLeftDropUpdates
 * @param {PIXI.FederatedEvent} event The triggering canvas interaction event
 * @returns {object[]|null}           An array of database updates to perform for documents in this collection
 */
// function _prepareDragLeftDropUpdates(wrapped, event) {
//   // If the shift key is held, ignore the path.
//   if ( event.shiftKey || !event.interactionData.clones.length ) return wrapped(event);
//   const paths = new Map();
//   for ( const clone of event.interactionData.clones ) {
//     const {_original: original} = clone;
//     const dest = ElevatedPoint.fromObject(clone.getSnappedPosition());
//     const bCentered = dest.centerPointToToken(clone); // I.e., target
//     if ( !canvas.dimensions.rect.contains(bCentered.x, bCentered.y) ) continue;
//
//     // Determine the full path for the clone.
//     // Keep the path as center points so collisions can be easily tested.
//     const aCentered = ElevatedPoint.fromObject(original.center);
//     aCentered.elevation = original.elevationE;
//     bCentered.elevation = aCentered.elevation;
//     const path = calculatePathForCenterPoints(this, aCentered, bCentered);
//
//     // Test for collisions; if any collision along the path, don't move.
//     if ( !game.user.isGM && hasCollisionAlongPath(path, this) ) {
//       ui.notifications.error("RULER.MovementCollision", {localize: true, console: false});
//       return null;
//     }
//
//     shiftPathToTopLeft(path, dest, bCentered);
//     paths.set(original.id, path);
//   }
//   commitDragLeftDropUpdatesAlongPaths.call(this, paths);
//   return null;
// }

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

/**
 * Replicates Token.prototype.#commitDragLeftDropUpdates
 * But commits the updates in order and confirms the destination was reached.
 * On not reaching the destination, stops further updates
 * @param {Map<string, ElevatedPoint[]>} paths     Path for each token id; map will be modified.
 */
// async function commitDragLeftDropUpdatesAlongPaths(paths) {
//   const updateIds = new Set();
//   let pathIdx = 1; // Path[0] is the origin.
//   this.layer.clearPreviewContainer();
//   const MAX_ITER = 10000;
//   let iter = 0;
//   while ( paths.size && iter < MAX_ITER ) {
//     iter += 1;
//     const updates = [];
//     updateIds.clear();
//     // For each token, take the next destination along its path.
//     for ( const [_id, path] of paths.entries() ) {
//       const dest = path[pathIdx];
//       if ( !dest ) {
//         paths.delete(_id);
//         continue;
//       }
//       updates.push({ _id, x: dest.x, y: dest.y, elevation: dest.elevation });
//       updateIds.add(_id);
//     }
//     if ( !updates.length ) break;
//     for ( const u of updates ) {
//       const d = this.document.collection.get(u._id);
//       if ( d ) d.locked = d._source.locked; // Unlock original documents
//     }
//
//     // If the TokenDocument is not returned, no update occurred.
//     const tokenDs = await canvas.scene.updateEmbeddedDocuments(this.document.documentName, updates);
//     const resIds = new Set(tokenDs.map(d => d.id));
//     const notInRes = updateIds.difference(resIds);
//     notInRes.forEach(id => paths.delete(id));
//
//     const promises = [];
//     for ( const tokenD of tokenDs ) {
//       // Retrieve the animation for this token.
//       const token = tokenD.object;
//       const anim = token.animationContexts.get(token.animationName);
//       if ( anim?.promise ) promises.push(anim.promise);
//
//       // If the TokenDocument does not match the destination, stop updating.
//       const dest = paths.get(tokenD.id)[pathIdx];
//       const { x, y, elevation } = tokenD._source;
//       if ( !(x.almostEqual(dest.x, 1) && y.almostEqual(dest.y, 1) && elevation.almostEqual(dest.elevation, 0.5)) ) {
//         log(`commitDragLeftDropUpdatesAlongPaths|Destination for ${tokenD.name} does not match.`);
//         paths.delete(tokenD.id);
//       }
//
//       // Wait for animations to finish. Otherwise, the token document update will change the animation path.
//       await Promise.allSettled(promises);
//     }
//     pathIdx += 1;
//   }
//   if ( iter >= MAX_ITER ) console.error("commitDragLeftDropUpdatesAlongPaths|Max iterations reached!", paths);
// }


PATCHES.RULER.MIXES = {
  // _prepareDragLeftDropUpdates
};

// ----- NOTE: Methods ----- //

/**
 * Retrieve all terrains on the token.
 * @returns {Terrain[]}
 */
function getAllTerrains() { return CONFIG[MODULE_ID].Terrain.allOnToken(this); }

/**
 * Remove all terrains from the token.
 */
async function removeAllTerrains() { return CONFIG[MODULE_ID].Terrain.removeAllFromToken(this); }

/**
 * Test if token has a given terrain.
 * @param {Terrain}
 * @returns {boolean}
 */
function hasTerrain(terrain) { return terrain.tokenHasTerrain(this); }

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
  getAllTerrains,
  removeAllTerrains,
  hasTerrain,
  getTopLeft
};

// ----- NOTE: Helper functions ----- //



// ----- NOTE: Getters ----- //

/**
 * New getter: Token#terrainmapper
 * Class that handles elevation settings and calcs for a region.
 * @type {TokenElevationHandler}
 */
function terrainmapper() { return (this._terrainmapper ??= new TokenElevationHandler(this)); }

PATCHES.ELEVATION.GETTERS = { terrainmapper };
