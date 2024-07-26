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
function canvasReady() {
  canvas.tiles.placeables.forEach(tile => {
    const tm = tile[MODULE_ID];
    if ( !tm.isElevated || !tm.testHoles ) return;
    const holeCache = tm.holeCache; // eslint-disable-line no-unused-vars
  });
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
  if ( foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${FLAGS.TILE.TEST_HOLES}`)
    || foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${FLAGS.TILE.ALPHA}`) ) {

    const tm = tileD.object?.[MODULE_ID];
    if ( tm && tm.isElevated && tm.testHoles ) { const holeCache = tm.holeCache; } // eslint-disable-line no-unused-vars
  }
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
