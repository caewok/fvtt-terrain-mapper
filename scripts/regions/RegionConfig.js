/* globals
CONST,
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, TEMPLATES, FA_ICONS } from "../const.js";

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

// ----- NOTE: Wraps ----- //

/**
 * Wrap RegionConfig.prototype._prepareContext
 * Add additional module tab to the config.
 */
async function _prepareContext(wrapper, options) {
  const context = await wrapper(options);
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

  // See https://ptb.discord.com/channels/170995199584108546/722559135371231352/1262802116628451359
  // Needed to set region-{{tab.id}} in the html for region-config
  context.tab = context.tabs[partId];

  // Add default flags.
  if ( typeof context.region.getFlag(MODULE_ID, FLAGS.REGION.TELEPORT) === "undefined" ) {
    await context.region.setFlag(MODULE_ID, FLAGS.REGION.TELEPORT, true);
  }
  if ( typeof context.region.getFlag(MODULE_ID, FLAGS.REGION.WALL_RESTRICTIONS) === "undefined" ) {
    await context.region.setFlag(MODULE_ID, FLAGS.REGION.WALL_RESTRICTIONS, []);
  }


  // Add in shapes and restriction types.
  const wallRestrictionChoices = { cover: "cover" };
  CONST.WALL_RESTRICTION_TYPES.forEach(type => wallRestrictionChoices[type] = type);

  context[MODULE_ID] = {
    algorithmChoices: FLAGS.REGION.LABELS,
    wallRestrictionChoices,
  }
  return context;
}

PATCHES.REGIONS.WRAPS = { _prepareContext, _preparePartContext };
