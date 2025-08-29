/* globals
canvas,
CanvasAnimation,
CONFIG,
CONST,
game,
PIXI,
Ruler,
ui
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

import { MODULE_ID, FLAGS, MODULES_ACTIVE } from "./const.js";
import { log } from "./util.js";
import { TokenElevationHandler } from "./TokenElevationHandler.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.RULER = {};
PATCHES.ELEVATION = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook preCreateToken
 * When creating the token, set its elevation to the scene background.
 * @param {Document} document                     The pending document which is requested for creation
 * @param {object} data                           The initial data object provided to the document creation request
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modify the creation request
 * @param {string} userId                         The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                        Explicitly return false to prevent creation of this Document
 */
function preCreateToken(tokenD, data, _options, _userId) {
  if ( !canvas.scene ) return;
//   const elevation = canvas.scene[MODULE_ID].sceneFloor;
//   if ( elevation && !data.elevation ) tokenD.updateSource({ elevation });
}

/**
 * Hook preUpdateToken
 * Adjust elevation if teleporting into a region.
 * @param {Document} document                       The Document instance being updated
 * @param {object} changed                          Differential data that will be used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modify the update request
 * @param {string} userId                           The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                          Explicitly return false to prevent update of this Document
*/
function preUpdateToken(tokenD, changed, options, _userId) {
  if ( !(Object.hasOwn(changed, "x") || Object.hasOwn(changed, "y")) ) return;

  // If teleporting to another elevated region, set the elevation of the destination accordingly.
//   if ( options.teleport ) {
//     const dest = tokenD.object.getCenterPoint({ x: changed.x ?? tokenD.x, y: changed.y ?? tokenD.y });
//     dest.elevation = changed.elevation ?? tokenD.elevation;
//     for ( const region of canvas.regions.placeables ) {
//       const tm = region.terrainmapper;
//       if ( !(tm.isElevated && region.testPoint(dest, dest.elevation)) ) continue;
//       changed.elevation = tm.elevationUponEntry(dest);
//     }
//   }
}

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

/**
 * Hook refreshToken.
 * Adjust terrain as the token moves; handle animation pauses.
 */
function refreshToken(token, flags) {
//   if ( token.isPreview ) {
//     // Token is clone in a drag operation.
//     if ( flags.refreshPosition || flags.refreshElevation || flags.refreshSize ) {
//       let text = token._getTooltipText();
//
//       // Test for regions with terrains.
//       const terrains = new Set();
//       for ( const region of identifyRegions(token) ) identifyRegionTerrains(region).forEach(t => terrains.add(t));
//       if ( terrains.size ) {
//         // Limit to visible terrains for the user.
//         const userTerrains = game.user.isGM ? terrains : terrains.filter(t => t.userVisible);
//
//         // Combine all the terrains.
//         const names = [...userTerrains].map(t => t.name);
//         text = `${names.join("\n")}\n${text}`;
//       }
//       token.tooltip.text = text;
//
//
//       // Adjust the token preview's elevation based on regions.
//       if ( MODULES_ACTIVE.ELEVATION_RULER
//         && canvas.controls.ruler.state === Ruler.STATES.MEASURING
//         && canvas.controls.ruler.token === token
//         && canvas.controls.ruler._isTokenRuler) return;
//
//       const origin = token._original.center;
//       origin.elevation = token._original.elevationE;
//       const destination = token.center;
//       destination.elevation = origin.elevation;
//       const flying = TokenElevationHandler.tokenIsFlying(token, origin, destination);
//       const burrowing = TokenElevationHandler.tokenIsBurrowing(token, origin, destination);
//       const path = TokenElevationHandler.constructPath(origin, destination, { burrowing, flying, token }); // Returns minimum [start, end]. End might be changed.
//       const destElevation = path.at(-1).elevation;
//       const elevationChanged = token.document.elevation !== destElevation;
//       if ( elevationChanged ) {
//         if ( isFinite(destElevation) ) {
//           log(`refreshToken|Setting preview token ${token.name} elevation to ${path.at(-1).elevation} at ${destination.x},${destination.y}`);
//           token.document.elevation = destElevation;
//         } else {
//           console.error(`${MODULE_ID}|refreshToken destination elevation is not finite. Moving from ${origin.x},${origin.y}, @${origin.elevation} --> ${destination.x},${destination.y}, @${destination.elevation}.\tFlying: ${flying}\tBurrowing:${burrowing}`);
//         }
//       }
//     }
//   }
}


PATCHES.BASIC.HOOKS = {
  preCreateToken,
  refreshToken,
  updateToken,
  preUpdateToken
};

// ----- NOTE: Wraps ----- //

/**
 * Wrap Token.prototype._getAnimationData
 * Add elevation to the data types to be animated.
 * See https://ptb.discord.com/channels/170995199584108546/811676497965613117/1276706805153529917
 * @returns {TokenAnimationData}         The target animation data object
 */
// function _getAnimationData(wrapped) {
//   const data = wrapped();
//   data.elevation = this.document.elevation;
//   return data;
// }

/**
 * Wrap Token.prototype._onAnimationUpdate
 * On an elevation change, refresh elevation, visibility, vision
 * Called each animation frame.
 * @param {Partial<TokenAnimationData>} changed    The animation data that changed
 * @param {TokenAnimationContext} context          The animation context
 */
// function _onAnimationUpdate(wrapped, changed, context) {
//   // TODO: Cache elevation and compare to target elevation to skip visibility refresh.
//
//   wrapped(changed, context);
//   if ( !("elevation" in changed) ) return;
//
//   // Determine the total elevation delta and target elevation in order to set an appropriate elevation shift.
//   const anim = CanvasAnimation.animations[this.animationName];
//   if ( !anim ) return;
//
//   // Prefer integers unless elevation delta is very small. Prefer stepping by canvas grid if sufficiently large delta.
//   const animPercent = CONFIG[MODULE_ID].elevationAnimationPercent || 1;
//   const elevDelta = Math.abs(anim.attributes.find(a => a.attribute === "elevation")?.delta ?? 1);
//   const elevStep = elevDelta < 1
//     ? Math.floor(elevDelta * animPercent * 10) / 10 // Round to nearest 0.1.
//     : Math.floor(elevDelta * animPercent);
//
//   const targetElev = context.to.elevation || 0;
//   // debug.log(`_onAnimationUpdate|Document elevation ${this.document.elevation} | targetElevation ${targetElev} | elevDelta ${elevDelta} | elevStep ${elevStep}`);
//
//   if ( !this.document.elevation.almostEqual(targetElev) ) {
//     this.document.elevation = this.document.elevation.toNearest(elevStep);
//     // debug.log(`_onAnimationUpdate|\tSet document elevation to ${this.document.elevation}`);
//     this.renderFlags.set({ refreshElevation: true });
//   } else {
//     // Visibility refresh for the token at the new elevation.
//     this.renderFlags.set({ refreshElevation: true, refreshVisibility: true });
//     this.initializeSources();
//   }
//
//
// }

/**
 * Wrap Token.prototype._getShiftedPosition
 * Add elevation change.
 * @param {-1|0|1} dx         The number of grid units to shift along the X-axis
 * @param {-1|0|1} dy         The number of grid units to shift along the Y-axis
 * @returns {Point}           The shifted target coordinates
 */
// function _getShiftedPosition(wrapped, dx, dy) {
//   const shifted = wrapped(dx, dy);
//   if ( this.document._source.x === shifted.x && this.document._source.y === shifted.y ) return shifted;
//
//   // Determine the full path but only use the last point.
//   const aTL = ElevatedPoint.fromObject(this.document._source);
//   const bTL = ElevatedPoint.fromObject(shifted);
//   bTL.elevation = aTL.elevation;
//   const path = calculatePathForTopLeftPoints(this, aTL, bTL);
//   const lastPoint = path.at(-1);
//   if ( !lastPoint ) return shifted;
//   return { x: lastPoint.x, y: lastPoint.y, elevation: lastPoint.elevation };
// }

/**
 * Determine the path for top left start and end.
 * @param {Token} token
 * @param {ElevatedPoint} aTL
 * @param {ElevatedPoint} bTL
 */
function calculatePathForTopLeftPoints(token, aTL, bTL) {
  const aCentered = aTL.centerPointToToken(token);
  const bCentered = bTL.centerPointToToken(token);
  const path = calculatePathForCenterPoints(token, aCentered, bCentered);
  return shiftPathToTopLeft(path, aTL, aCentered);
}

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

/**
 * Shift the path from center points to top left points. Used when updating token position.
 * @param {ElevatedPoint[]} path
 * @param {ElevatedPoint} topLeftPosition
 * @param {ElevatedPoint} centeredPosition
 * @returns {ElevatedPoint[]} The path, modified in place.
 */
function shiftPathToTopLeft(path, topLeftPosition, centeredPosition) {
  const delta = topLeftPosition.to2d().subtract(centeredPosition);
  path.forEach(pt => pt.add(delta, pt));
  return path;
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
  if ( waypoints.length < 2 ) return wrapped(waypoints, options);

  log(`createTerrainMovementPath|${waypoints.length} waypoints: ${ElevatedPoint.fromObject(waypoints[0])} --> ${ElevatedPoint.fromObject(waypoints.at(-1))}`);
  if ( CONFIG[MODULE_ID].debug ) console.table(waypoints);

  waypoints = waypoints.filter((pt, idx) => idx === 0 || (!pt.intermediate && (pt.explicit || pt.checkpoint)));
  log(`createTerrainMovementPath|After filter: ${waypoints.length} waypoints: ${ElevatedPoint.fromObject(waypoints[0])} --> ${ElevatedPoint.fromObject(waypoints.at(-1))}`);
  if ( CONFIG[MODULE_ID].debug ) console.table(waypoints);

  const initialElevChange = waypoints.at(-1).elevation - waypoints.at(0).elevation;
  if ( initialElevChange > 50 ) console.log("createTerrainMovementPath", { initialElevChange });

  // Testing
  const dist = PIXI.Point.distanceBetween(waypoints[0], waypoints[1]);
  if ( CONFIG.GeometryLib.utils.pixelsToGridUnits(dist) > 50 ) console.log("createTerrainMovementPath", { waypoints, options });

  const newWaypoints = [waypoints[0]];
  let start = waypoints[0];
  for ( let i = 1, maxI = waypoints.length; i < maxI; i += 1 ) {
    const next = waypoints[i];
    const flying = CONFIG[MODULE_ID].terrainFlightActions.has(next.action);
    const burrowing = CONFIG[MODULE_ID].terrainBurrowActions.has(next.action);
    const walking = CONFIG[MODULE_ID].terrainWalkActions.has(next.action);

    if ( start.x == null || isNaN(start.x)
      || start.y == null || isNaN(start.y)
      || next.x == null || isNaN(next.x)
      || next.y == null || isNaN(next.y) ) {
      console.error(`createTerrainMovementPath failed.`, { start, next });
    }

    // log(`createTerrainMovementPath|${ElevatedPoint.fromObject(start)} --> ${ElevatedPoint.fromObject(next)}`, { flying, burrowing, walking });
    const path = this[MODULE_ID].constructPath(_centerWaypoint(start, this), _centerWaypoint(next, this), { flying, burrowing, walking });

    if ( path.some(pt => pt.x == null || isNaN(pt.x) || pt.y == null || isNaN(pt.y)) ) {
      console.error(`createTerrainMovementPath failed.`, { path });
    }

    path.forEach(pt => _uncenterPathPointInPlace(pt, this));

    let elevChange = path.at(-1).elevation - path.at(0).elevation;
    if ( elevChange > 50 ) console.log("createTerrainMovementPath", { elevChange });

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

        // Testing
        elevChange = newWaypoints.at(-1).elevation - newWaypoints.at(0).elevation;
        if ( elevChange > 50 ) console.log("createTerrainMovementPath", { elevChange });
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

      // Testing
      elevChange = newWaypoints.at(-1).elevation - newWaypoints.at(0).elevation;
      if ( elevChange > 50 ) console.log("createTerrainMovementPath", { elevChange });

  }

  // Testing
  const elevChange = newWaypoints.at(-1).elevation - newWaypoints.at(0).elevation;
  if ( elevChange > 50 ) console.log("createTerrainMovementPath", { elevChange });

  if ( newWaypoints.length > 100 ) {
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

/**
 * For a given preview token, determine what regions it would be in.
 * See TokenDocument##identifyRegions
 * @param {Token} token
 * @returns {Set<Region>}
 */
function identifyRegions(token) {
  const regions = new Set();
  const testPt = ElevatedPoint.fromLocationWithElevation(token.getCenterPoint(), token.elevation);
  for ( const region of canvas.regions.placeables ) {
    if ( region.testPoint(testPt) ) regions.add(region);
  }
  testPt.release();
  return regions;
}

/**
 * For a given preview token, determine what terrains it would have if it entered the region.
 * @param {Region} region
 * @returns {Set<Terrain>}
 */
const ENTRY_EVENTS = new Set([
  CONST.REGION_EVENTS.TOKEN_ENTER,
  CONST.REGION_EVENTS.TOKEN_MOVE_IN,
]);

const ENTRY_EVENTS_COMBAT = new Set([
  CONST.REGION_EVENTS.TOKEN_ROUND_END,
  CONST.REGION_EVENTS.TOKEN_ROUND_START,
  CONST.REGION_EVENTS.TOKEN_TURN_END,
  CONST.REGION_EVENTS.TOKEN_TURN_START
]);

function identifyRegionTerrains(region, isGM = game.user.isGM) {
  const events = game.combat?.started ? ENTRY_EVENTS.union(ENTRY_EVENTS_COMBAT) : ENTRY_EVENTS;
  const terrainIds = new Set();
  for ( const behavior of region.document.behaviors.values() ) {
    if ( behavior.disabled ) continue;
    if ( !(behavior.type === `${MODULE_ID}.addTerrain` || behavior.type === `${MODULE_ID}.setTerrain`) ) continue;
    if ( behavior.type === `${MODULE_ID}.addTerrain` && !behavior.system.events.intersects(events) ) continue;
    if ( !isGM && behavior.system.secret ) continue;
    behavior.system.terrains.forEach(t => terrainIds.add(t));
  }
  return new Set([...terrainIds].map(id => CONFIG[MODULE_ID].Terrain._instances.get(id)).filter(t => Boolean(t)));
}

// ----- NOTE: Getters ----- //

/**
 * New getter: Token#terrainmapper
 * Class that handles elevation settings and calcs for a region.
 * @type {TokenElevationHandler}
 */
function terrainmapper() { return (this._terrainmapper ??= new TokenElevationHandler(this)); }

PATCHES.ELEVATION.GETTERS = { terrainmapper };
