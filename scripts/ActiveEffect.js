/* globals
canvas,
Terrain
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Methods related to ActiveEffect

import { MODULE_ID, FLAGS } from "./const.js";
import { isFirstGM } from "./util.js";

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
  const uniqueEffectId = document.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID);
  if ( !uniqueEffectId
    || document.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.TYPE) !== "Terrain"
    || document.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.DUPLICATES_ALLOWED) ) return;
  const actor = document.parent;
  if ( !actor || !(actor instanceof Actor) ) return;
  const token = actor.token?.object;
  if ( !token ) return;

  // If this terrain already exists, don't add it to the actor.
  const terrain = CONFIG[MODULE_ID].Terrain._instances.get(uniqueEffectId);
  if ( !terrain ) return;
  if ( terrain.tokenHasTerrain(token) ) return false;
}

/**
 * Hook createActiveEffect
 * Upon AE creation, toggle on all the AE statuses.
 * @param {Document} document                       The new Document instance which has been created
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createActiveEffect(document, options, userId) {
  const actor = document.parent;
  if ( !CONFIG[MODULE_ID].addStandAloneAEs || !document.statuses || !isFirstGM || !(actor instanceof Actor) ) return;
  if ( isStandAloneEffect(document) ) return;

  const defaultStatusIds = new Set(CONFIG.statusEffects.map(s => s.id));
  for ( const statusId of document.statuses ) {
    if ( !defaultStatusIds.has(statusId) ) continue;
    actor.toggleStatusEffect(statusId, { active: true }); // Async
  }
}

function isStandAloneEffect(effect) {
  if ( effect.statuses.size !== 1 ) return false;

  // ids can change depending on system; name can be localized. Icon seems to work.
  return Object.values(CONFIG.statusEffects).some(e =>
    effect.statuses.has(e.id) && e.img === effect._source.img);
}

/**
 * Hook deleteActiveEffect
 * Upon AE deletion, toggle off statuses unless other effects have those statuses.
 * @param {Document} document                       The new Document instance which has been created
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function deleteActiveEffect(document, options, userId) {
  const actor = document.parent;
  if ( !CONFIG[MODULE_ID].addStandAloneAEs || !document.statuses || !isFirstGM || !(actor instanceof Actor) ) return;
  if ( isStandAloneEffect(document) ) return;

  const otherEffectStatuses = new Set();
  for ( const effect of actor.allApplicableEffects() ) {
    if ( isStandAloneEffect(effect) ) continue;
    effect.statuses.forEach(s => otherEffectStatuses.add(s));
  }

  const defaultStatusIds = new Set(CONFIG.statusEffects.map(s => s.id));
  for ( const statusId of document.statuses ) {
    if ( otherEffectStatuses.has(statusId) ) continue;
     if ( !defaultStatusIds.has(statusId) ) continue;
    actor.toggleStatusEffect(statusId, { active: false }); // Async
  }
}


PATCHES.BASIC.HOOKS = { preCreateActiveEffect, createActiveEffect, deleteActiveEffect };
