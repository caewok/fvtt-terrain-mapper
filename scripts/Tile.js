/* globals
Terrain
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { Terrain } from "./Terrain.js";
import { TerrainTile } from "./TerrainLevel.js";

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

PATCHES.BASIC.GETTERS = { attachedTerrain, hasAttachedTerrain };
