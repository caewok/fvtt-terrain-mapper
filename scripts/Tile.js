/* globals
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, TEMPLATES, DEFAULT_FLAGS } from "./const.js";
import { TileElevationHandler } from "./TileElevationHandler.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.ELEVATION = {};


// ----- NOTE: Hooks ----- //

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

PATCHES.BASIC.HOOKS = { createTile };

// ----- NOTE: Getters ----- //

/**
 * New getter: Tile#terrainmapper
 * Class that handles elevation settings and calcs for a region.
 * @type {RegionElevationHandler}
 */
function terrainmapper() { return (this._terrainmapper ??= new TileElevationHandler(this)); }

PATCHES.ELEVATION.GETTERS = { terrainmapper };
