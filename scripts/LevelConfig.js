/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TEMPLATES } from "./const.js";
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
function renderLevelConfig(app, html, data) {
  // Add handler on close to store the group actors setting.
//   const oldHandler = app.options.form.handler;
//   app.options.form.handler = async (event, form, submitData) => {
//     await saveSettings(event, form, submitData);
//     await oldHandler(event, form, submitData);
//   }

  const myHTML = renderTemplateSync(TEMPLATES.TILE, data);
  if ( !myHTML ) return;
  const newFormGroup = document.createElement("div");
  newFormGroup.classList.add("form-group");
  newFormGroup.innerHTML = myHTML;

  const divSet = html.querySelector("section[data-application-part='body']");
  divSet.appendChild(newFormGroup);
  app.setPosition(app.position);
}

PATCHES.BASIC.HOOKS = { renderLevelConfig };


