/* globals
canvas,
Terrain
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Methods related to ActiveEffect

import { MODULE_ID } from "./const.js";
import { Terrain } from "./Terrain.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook active effect creation. If the terrain color is updated, update the TerrainLayerShader.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateActiveEffect(ae, changed, _options, _userId) {
  if ( !changed.flags?.[MODULE_ID]?.color ) return;
  const terrain = new Terrain(ae);
  canvas.terrain._terrainColorsMesh.shader.updateTerrainColor(terrain);
}

PATCHES.BASIC.HOOKS = { updateActiveEffect };
