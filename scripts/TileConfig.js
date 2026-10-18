/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";
import { renderTemplateSync } from "./util.js";


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
  data.tokenvisibility = {
    tileAlphaShapeOptions: {
      full: `${MODULE_ID}.tile-config.options.full`,
      boundingBox: `${MODULE_ID}.tile-config.options.boundingBox`,
      boundingPolygon: `${MODULE_ID}.tile-config.options.boundingPolygon`,
      polygons: `${MODULE_ID}.tile-config.options.polygons`,
      calculated: `${MODULE_ID}.tile-config.options.calculated`,
      ignore: `${MODULE_ID}.tile-config.options.ignore`,
    },
    selectedTileAlphaShape: data.document.getFlag(MODULE_ID, FLAGS.TILE_ALPHA_SHAPE) || "calculated",
  };

  const myHTML = renderTemplateSync(TEMPLATES.TILE, data);
  if ( !myHTML ) return;

  const newFormGroup = document.createElement("div");
  newFormGroup.classList.add("form-group");
  newFormGroup.innerHTML = myHTML;

  const divSet = html.querySelector("div[data-tab='overhead']");
  divSet.appendChild(newFormGroup);
  app.setPosition(app.position);
}

PATCHES.BASIC.HOOKS = { renderTileConfig };


