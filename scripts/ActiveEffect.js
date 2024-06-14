/* globals
canvas,
Terrain
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Methods related to ActiveEffect

import { MODULE_ID, FLAGS } from "./const.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook preCreateActiveEffect.
 * If the active effect is a terrain and it already exists on the token, don't create.
 * @param {Document} document                     The pending document which is requested for creation
 * @param {object} data                           The initial data object provided to the document creation request
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modify the creation request
 * @param {string} userId                         The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                        Explicitly return false to prevent creation of this Document
 */
function preCreateActiveEffect(document, data, options, userId) {
  if ( !document.getFlag(MODULE_ID, FLAGS.IS_TERRAIN)
    || document.getFlag(MODULE_ID, FLAGS.DUPLICATES_ALLOWED) ) return;
  const actor = document.parent;
  if ( !actor || !(actor instanceof Actor) ) return;
  const token = actor.token?.object;
  if ( !token ) return;

  // If this terrain already exists, don't add it to the actor.
  const terrainId = document.origin.split(".")[1];
  if ( !terrainId ) return;
  const terrain = CONFIG[MODULE_ID].Terrain._instances.get(terrainId);
  if ( !terrain ) return;
  if ( terrain.tokenHasTerrain(terrain) ) return false;
}

PATCHES.BASIC.HOOKS = { preCreateActiveEffect };
