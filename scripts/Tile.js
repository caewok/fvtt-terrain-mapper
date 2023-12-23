/* globals
Terrain
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { Terrain } from "./Terrain.js";
import { TerrainTile } from "./TerrainLevel.js";
import { TilePixelCache } from "./PixelCache.js";

export const PATCHES = {};
PATCHES.BASIC = {};


// Attach a terrain to a tile and interface with it.
// For now, only a single terrain can be attached to a tile.

// ----- NOTE: Hooks ----- //

/**
 * Hook tile update and erase the terrain if the attachedTerrain flag was updated.
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTile(tileD, changed, _options, _userId) {
  if ( changed.overhead ) document.object._evPixelCache = undefined;
  const cache = document.object._evPixelCache;
  if ( cache ) {
    if ( Object.hasOwn(changed, "x")
      || Object.hasOwn(changed, "y")
      || Object.hasOwn(changed, "width")
      || Object.hasOwn(changed, "height") ) {
      cache._resize();
    }

    if ( Object.hasOwn(changed, "rotation")
      || Object.hasOwn(changed, "texture")
      || (change.texture
        && (Object.hasOwn(changed.texture, "scaleX")
        || Object.hasOwn(changed.texture, "scaleY"))) ) {

      cache.clearTransforms();
    }
  }

  const modFlag = changed.flags?.[MODULE_ID];
  if ( !modFlag || !Object.hasOwn(modFlag, [FLAGS.ATTACHED_TERRAIN]) ) return;
  tileD.object._terrain = undefined;
}

PATCHES.BASIC.HOOKS = { updateTile };

// ----- NOTE: Methods ----- //

async function attachTerrain(terrain) {
  this._terrain = undefined;
  await this.document.setFlag(MODULE_ID, FLAGS.ATTACHED_TERRAIN, terrain.id);
}

async function removeTerrain() {
  this._terrain = undefined;
  await this.document.setFlag(MODULE_ID, FLAGS.ATTACHED_TERRAIN, "");
}

PATCHES.BASIC.METHODS = { attachTerrain, removeTerrain };

// ----- NOTE: Getters ----- //
function attachedTerrain() {
  if ( !this._terrain ) {
    const effectId = this.document.getFlag(MODULE_ID, FLAGS.ATTACHED_TERRAIN);
    if ( !effectId ) return undefined;
    const terrain = Terrain.fromEffectId(effectId);
    this._terrain = new TerrainTile(terrain, this);
  }
  return this._terrain;
}

function hasAttachedTerrain() {
  return Boolean(this.document.getFlag(MODULE_ID, FLAGS.ATTACHED_TERRAIN));
}

/**
 * Getter for Tile.mesh._evPixelCache
 */
function evPixelCache() {
  return this._evPixelCache || (this._evPixelCache = TilePixelCache.fromOverheadTileAlpha(this));
}


PATCHES.BASIC.GETTERS = { attachedTerrain, hasAttachedTerrain, evPixelCache };
