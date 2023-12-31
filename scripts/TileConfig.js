/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";
import { Terrain } from "./Terrain.js";
import { injectConfiguration } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

// Add dropdown to select a terrain to attach to this tile.


// ----- NOTE: Hooks ----- //

/**
 * Inject html to add controls to the tile configuration to allow user to set elevation.
 */
async function renderTileConfig(app, html, data) {
  const findString = "div[data-tab='basic']:last";
  const nullTerrain = canvas.terrain.sceneMap.get(0);
  const terrains = { [nullTerrain.id]: nullTerrain.name };
  Terrain.getAll().forEach(t => terrains[t.id] = t.name);
  const selected = app.object.getFlag(MODULE_ID, FLAGS.ATTACHED_TERRAIN) || "";
  data[MODULE_ID] = { terrains, selected };
  await injectConfiguration(app, html, data, TEMPLATES.TILE, findString, "append");
}

PATCHES.BASIC.HOOKS = { renderTileConfig };
