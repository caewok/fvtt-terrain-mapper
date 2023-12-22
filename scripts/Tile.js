/* globals
Terrain
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { TerrainTile } from "./TerrainLevel.js";

export const PATCHES = {};
PATCHES.BASIC = {};


// Attach a terrain to a tile and interface with it.
// For now, only a single terrain can be attached to a tile.

// ----- NOTE: Hooks ----- //

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
