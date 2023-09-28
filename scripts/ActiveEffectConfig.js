/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, LABELS } from "./const.js";
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Rerender the terrain control app if it is open when the active effect configuration is closed.
 */
function closeActiveEffectConfig(_app, _html) {
  TerrainEffectsApp.rerender();
}

/**
 * On active effect render, add the additional terrain settings.
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
async function renderActiveEffectConfig(app, html, data) {
  if ( !app.object.getFlag(MODULE_ID, "anchor") ) return;

  const renderData = {};
  renderData[MODULE_ID] = {
    anchorOptions: LABELS.ANCHOR_OPTIONS
  };
  foundry.utils.mergeObject(data, renderData, { inplace: true });

  // Insert the new configuration fields into the active effect config.
  const tabName = game.i18n.localize(`${MODULE_ID}.name`);

  const template = `modules/${MODULE_ID}/templates/active-effect-config.html`;
  const myHTML = await renderTemplate(template, data);
  html.find('nav').find('a[data-tab="details"]').first().before(`<a class="item" data-tab="${MODULE_ID}"><i class="fas fa-mountain-sun"></i>${tabName}</a>`);
  html.find('section[data-tab="details"]').first().before(myHTML);
  app.setPosition(app.position);
}

PATCHES.BASIC.HOOKS = { closeActiveEffectConfig, renderActiveEffectConfig };
