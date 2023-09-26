/* globals
flattenObject,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

import { MODULE_ID } from "./const.js";
import { TerrainSettings } from "./settings.js";
import { TravelTerrainRay } from "./TravelTerrainRay.js";

export const PATCHES = {};
PATCHES.BASIC = {};

const SETTINGS = TerrainSettings.KEYS;
const AUTO = SETTINGS.AUTO_TERRAIN;

/**
 * Hook preUpdateToken.
 * If the token moves, determine its terrain status.
 */
function preUpdateTokenHook(tokenD, changes, _options, _userId) {
  const autoT = TerrainSetting.get(AUTO.ALGORITHM);
  if ( autoT === AUTO.CHOICES.NO ) return;
  if ( autoT === AUTO.CHOICES.COMBAT && !game.combat.isActive ) return;

  const changeKeys = new Set(Object.keys(flattenObject(changes)));
  const token = tokenD.object;
  const destination = token.getCenter(changes.x ?? token.x, changes.y ?? token.y);
  const tm = token[MODULE_ID] ??= {};
  const origTTR = token[MODULE_ID].ttr;
  if ( changeKeys.has("elevation") && origTTR ) {
    // Something, like Levels Stairs, has changed the token elevation during an animation.
    // Redo the travel terrain ray from this point.
    origTTR.origin = destination;
    origTTR.origin.z = changes.elevation;
  }

  if ( !(changeKeys.has("x") || changeKeys.has("y")) ) return;

  const ttm = new TravelTerrainRay(token, { destination });
  token[MODULE_ID].ttm = ttm;
}

/**
 * Hook refreshToken.
 * Adjust terrain as the token moves; handle animation pauses.
 */
function refreshTokenHook(token, flags) {
  const autoT = TerrainSetting.get(AUTO.ALGORITHM);
  if ( autoT === AUTO.CHOICES.NO ) return;
  if ( autoT === AUTO.CHOICES.COMBAT && !game.combat.isActive ) return;
  if ( !(flags.refreshPosition || flags.refreshElevation) ) return;

  if ( token._original ) {
    // This token is a clone in a drag operation.
    return;
  }

  const ttr = token[MODULE_ID].ttr;
  if ( !ttr ) return;
  const center = token.getCenter(token.position.x, token.position.y);
  const terrain = ttr.terrainAtClosestPoint(center);
  if ( !terrain ) return;

  terrain.addToToken(token);
}

PATCHES.BASIC.HOOKS = {
  preUpdateToken: preUpdateTokenHook,
  refreshToken: refreshTokenHook
};
