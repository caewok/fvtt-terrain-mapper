/* globals
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, TEMPLATES, DEFAULT_FLAGS } from "./const.js";

export const PATCHES = {};
PATCHES.BASIC = {};


// ----- NOTE: Hooks ----- //

/**
 * Hook createTile
 * Set default flags.
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createTile(document, _options, _userId) {
  for ( const [key, defaultValue] of Object.entries(DEFAULT_FLAGS.TILE) ) foundry.utils.setProperty(document, `flags.${MODULE_ID}.${key}`, defaultValue);
}

PATCHES.BASIC.HOOKS = { createTile };
