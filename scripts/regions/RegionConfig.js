/* globals
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, DEFAULT_FLAGS, TEMPLATES, FA_ICONS } from "../const.js";

// Patches for the RegionConfig class
export const PATCHES = {};
PATCHES.REGIONS = {};

// Hook init to update the PARTS of the Region config.
Hooks.once("init", function() {
  const { footer, ...other } = foundry.applications.sheets.RegionConfig.PARTS;
  foundry.applications.sheets.RegionConfig.PARTS = {
    ...other, // Includes tabs
    [MODULE_ID]: { template: TEMPLATES.REGION },
    footer
  }
});

/**
 * Hook the region config render.
 * @param {ApplicationV2} application          The Application instance being rendered
 * @param {HTMLElement} element                The inner HTML of the document that will be displayed and may be modified
 * @param {ApplicationRenderContext} context   The application rendering context data
 * @param {ApplicationRenderOptions} options   The application rendering options
 */
function renderRegionConfig(app, element, _context, _options) {
  app.position.width = Math.max(app.position.width || 0, 600); // Make tabs long enough for the title.
  activateListeners(app, element);
}

/**
 * Monitor algorithm change for the region terrain type.
 */
function activateListeners(app, html) {
  const shapeSelector = html.querySelector("#terrainmapperalgorithm");
  shapeSelector.addEventListener("change", terrainAlgorithmChanged.bind(app));
  initializeSubmenu(app, html);
}

/**
 * When first displaying the Terrain Mapper tab, show the blocks corresponding to the selected terrain type.
 */
function initializeSubmenu(app, html) {
  const alg = app._preview?.flags?.[MODULE_ID]?.[FLAGS.REGION.TERRAIN.TYPE] || DEFAULT_FLAGS[FLAGS.REGION.TERRAIN.TYPE];
  if ( !alg ) return;

  const elems = html.getElementsByClassName(`form-group ${MODULE_ID}`);
  for ( const elem of elems ) {
    if ( elem.dataset[alg] ) elem.style.display = "block";
  }
}

/**
 * When the terrain algorithm changes, update which config options are visible.
 */
function terrainAlgorithmChanged(event) {
  const alg = event.target.value;
  const elems = document.getElementsByClassName(`form-group ${MODULE_ID}`);
  for ( const elem of elems ) elem.style.display = elem.dataset[alg] ? "block" : "none";
}

PATCHES.REGIONS.HOOKS = { renderRegionConfig };

// ----- NOTE: Wraps ----- //

/**
 * Wrap RegionConfig.prototype._prepareContext
 * Add additional module tab to the config.
 */
async function _prepareContext(wrapper, options) {
  const context = await wrapper(options);
  if ( !context.tabs ) return;
  context.tabs[MODULE_ID] =  {
    id: MODULE_ID,
    group: "sheet",
    icon: FA_ICONS.MODULE,
    label: `${MODULE_ID}.name` };

  // From #getTabs
  for ( const v of Object.values(context.tabs) ) {
    v.active = this.tabGroups[v.group] === v.id;
    v.cssClass = v.active ? "active" : "";
  }

  return context;
}

/**
 * Wrap RegionConfig.prototype._preparePartContext
 * Add in terrainmapper specific data to the region tab.
 * @param {string} partId                         The part being rendered
 * @param {ApplicationRenderContext} context      Shared context provided by _prepareContext
 * @param {HandlebarsRenderOptions} options       Options which configure application rendering behavior
 * @returns {Promise<ApplicationRenderContext>}   Context data for a specific part
 */
async function _preparePartContext(wrapper, partId, context, options) {
  context = await wrapper(partId, context, options);
  if ( partId !== MODULE_ID ) return context;

  // Set default flags
  const flags = context.document.flags[MODULE_ID] ??= {};
  for ( const [key, value] of Object.entries(DEFAULT_FLAGS.REGION) ) flags[key] ??= value;


  // See https://ptb.discord.com/channels/170995199584108546/722559135371231352/1262802116628451359
  // Needed to set region-{{tab.id}} in the html for region-config
  context.tab = context.tabs[partId];
  context[MODULE_ID] = {
    algorithmChoices: FLAGS.REGION.TERRAIN.LABELS,
    hillChoices: FLAGS.REGION.HILL.LABELS,
  }
  return context;
}

PATCHES.REGIONS.WRAPS = { _prepareContext, _preparePartContext };
