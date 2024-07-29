/* globals
canvas,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, DEFAULT_FLAGS } from "./const.js";
import { TileElevationHandler } from "./TileElevationHandler.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.ELEVATION = {};


// ----- NOTE: Hooks ----- //

/**
 * Hook canvas ready to construct the hole caches for any tiles.
 */
async function canvasReady() {
  for ( const tile of canvas.tiles.placeables ) {
    const tm = tile[MODULE_ID];
    if ( !tm.isElevated || !tm.testHoles ) continue;
    await tm.buildHoleCache();
  }
}

/**
 * Hook createTile
 * Set default flags.
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createTile(document, _options, _userId) {
  for ( const [key, defaultValue] of Object.entries(DEFAULT_FLAGS.TILE) ) foundry.utils.setProperty(document, `flags.${MODULE_ID}.${key}`, defaultValue);
}

/**
 * Hook tile update to update the hole cache if the alpha flag or test holes flag changes.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTile(tileD, changed, _options, _userId) {
  const tm = tileD.object?.[MODULE_ID];
  if ( !(tm && tm.isElevated && tm.testHoles )) return;

  // Test for changes in tile size, tile scale, or specific hole-related flags.
  const changeKeys = new Set(Object.keys(foundry.utils.flattenObject(changed)));
  const resized = ["x", "y", "width", "height"].some(key => changeKeys.has(key));
  const transformed = ["rotation", "texture", "scaleX", "scaleY"].some(key => changeKeys.has(key));
  const flagChanged = [
    `flags.${MODULE_ID}.${FLAGS.TILE.IS_FLOOR}`,
    `flags.${MODULE_ID}.${FLAGS.TILE.TEST_HOLES}`,
    `flags.${MODULE_ID}.${FLAGS.TILE.ALPHA_THRESHOLD}`
  ].some(key => changeKeys.has(key));
  if ( !(resized || transformed || flagChanged) ) return;

  // Rebuild the hole cache if the alpha threshold changed
  if ( foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${FLAGS.TILE.ALPHA_THRESHOLD}`) ) tm.clearHoleCache();

  // This constructs the hole cache if not yet present; otherwise pulls the hole cache.
  tm.buildHoleCache().then(_result => {
    const holeCache = tm.holeCache;
    if ( resized ) holeCache._resize();
    if ( transformed ) holeCache.clearTransforms();
  });
}


PATCHES.BASIC.HOOKS = { canvasReady, createTile, updateTile };


// ----- NOTE: Getters ----- //

/**
 * New getter: Tile#terrainmapper
 * Class that handles elevation settings and calcs for a region.
 * @type {RegionElevationHandler}
 */
function terrainmapper() { return (this._terrainmapper ??= new TileElevationHandler(this)); }

PATCHES.ELEVATION.GETTERS = { terrainmapper };
