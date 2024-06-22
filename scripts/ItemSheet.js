/* globals
CONFIG,
FormDataExtended,
foundry,
renderTemplate
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, TEMPLATES } from "./const.js";
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";
import { renderTemplateSync } from "./util.js";

export const PATCHES = {};
PATCHES.COVER_ITEM = {};

// ----- NOTE: Hooks ----- //

/**
 * Rerender the cover control app if it is open when the active effect configuration is closed.
 */
function closeItemSheet(_app, _html) {
  TerrainEffectsApp.rerender();
}

/**
 * On active effect render, add a dropdown to select the
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
function renderItemSheet(app, html, data) {
  if ( app.object.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.TYPE) !== "Terrain" ) return;

  // Insert the new configuration fields into the item config.
  const insertFn = INSERT_FNS[game.system.id];
  if ( insertFn ) insertFn(html, data);

  // html.find('.tab[data-tab="details"').children().last().after(myHTML);
  app.setPosition(app.position);
}

PATCHES.COVER_ITEM.HOOKS = { closeItemSheet, renderItemSheet };


// ----- Helper functions ----- //

const INSERT_FNS = {
  "pf2e": insertPF2e,
  "sfrpg": insertSFRPG
};

/**
 * Insert the html for a PF2e effect item.
 */
function insertPF2e(html, data) {
  const myHTML = renderTemplateSync(TEMPLATES.ITEM_PF2e, data);
  const div = document.createElement("div");
  div.innerHTML = myHTML;

  // Place at the bottom of the details tab.
  const detailsTab = html.find(`.tab[data-tab="details"]`)[0];
  if ( !detailsTab ) return;
  detailsTab.appendChild(div);
}

/**
 * Insert the html for a SFRPG effect item.
 */
function insertSFRPG(html, data) {

}
