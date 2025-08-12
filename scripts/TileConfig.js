/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TEMPLATES } from "./const.js";
import { injectConfigurationSync } from "./util.js";


// Add settings to tile config to treat it like a "floor".
// - Enable "floor" for overhead tiles
// - Trim border based on alpha pixels
// - Minimum hole size, where 0 is no holes.

// Patches for the RegionConfig class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //


/**
 * Inject html to add controls to the tile configuration.
 * Adds to the Overhead tab.
 */
function renderTileConfig(app, html, data) {
  const findString = "div[data-tab='overhead']:last";
//   const nullTerrain = canvas.terrain.sceneMap.get(0);
//   const terrains = { [nullTerrain.id]: nullTerrain.name };
//   Terrain.getAll().forEach(t => terrains[t.id] = t.name);
//   const selected = app.object.getFlag(MODULE_ID, FLAGS.ATTACHED_TERRAIN) || "";
//   data[MODULE_ID] = { terrains, selected };

  injectConfigurationSync(app, html, data, TEMPLATES.TILE, findString, "append");
}

PATCHES.BASIC.HOOKS = { renderTileConfig };
