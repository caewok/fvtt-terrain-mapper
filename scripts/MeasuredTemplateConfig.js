/* globals
canvas,
renderTemplate
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
async function renderMeasuredTemplateConfig(app, html, data) {
  const nullTerrain = canvas.terrain.sceneMap.get(0);
  const terrains = { [nullTerrain.id]: nullTerrain.name };
  Terrain.getAll().forEach(t => terrains[t.id] = t.name);
  const selected = app.object.getFlag(MODULE_ID, FLAGS.ATTACHED_TERRAIN) || "";
  data[MODULE_ID] = { terrains, selected };

  const findString = "button[type='submit']";
  await injectConfiguration(app, html, data, TEMPLATES.MEASURED_TEMPLATE, findString, "before");

//   const myHTML = await renderTemplate(TEMPLATES.MEASURED_TEMPLATE, data);
//   html.find(".form-group").last().after(myHTML);
//   app.setPosition(app.position);
}

PATCHES.BASIC.HOOKS = { renderMeasuredTemplateConfig };

// ----- Note: Wraps ----- //

/**
 * Wrapper for MeasuredTemplateConfig.defaultOptions
 * Make the template config window resize height automatically, to accommodate
 * different parameters.
 * @param {Function} wrapper
 * @return {Object} See MeasuredTemplateConfig.defaultOptions.
 */
function defaultOptions(wrapper) {
  const options = wrapper();
  return foundry.utils.mergeObject(options, {
    height: "auto"
  });
}

PATCHES.BASIC.STATIC_WRAPS = { defaultOptions };
