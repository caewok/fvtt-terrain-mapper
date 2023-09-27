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
import { Terrain } from "./Terrain.js";

export const PATCHES = {};
PATCHES.BASIC = {};

const SETTINGS = TerrainSettings.KEYS;
const AUTO = SETTINGS.AUTO_TERRAIN;

// ----- NOTE: Hooks ----- //

/**
 * Hook preUpdateToken.
 * If the token moves, determine its terrain status.
 */
function preUpdateTokenHook(tokenD, changes, _options, _userId) {
  const autoT = TerrainSettings.get(AUTO.ALGORITHM);
  if ( autoT === AUTO.CHOICES.NO ) return;
  if ( autoT === AUTO.CHOICES.COMBAT && !game.combat.isActive ) return;

  const changeKeys = new Set(Object.keys(flattenObject(changes)));
  const token = tokenD.object;
  token[MODULE_ID] ??= {};
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

  const ttr = new TravelTerrainRay(token, { destination });
  token[MODULE_ID].ttr = ttr;
}

/**
 * Hook refreshToken.
 * Adjust terrain as the token moves; handle animation pauses.
 */
function refreshTokenHook(token, flags) {
  token[MODULE_ID] ??= {};
  const autoT = TerrainSettings.get(AUTO.ALGORITHM);
  if ( autoT === AUTO.CHOICES.NO ) return;
  if ( autoT === AUTO.CHOICES.COMBAT && !game.combat.isActive ) return;
  if ( !(flags.refreshPosition || flags.refreshElevation) ) return;

  if ( token._original ) {
    // This token is a clone in a drag operation.
    return;
  } else if ( token._animation ) {
    const ttr = token[MODULE_ID].ttr;
    if ( !ttr ) return;
    const center = token.getCenter(token.position.x, token.position.y);
    const terrain = ttr.terrainAtClosestPoint(center);
    if ( !terrain ) return;
    terrain.addToToken(token);

    // Remove any terrains that may have been added by the path traversal except the current.
    // This allows user-added terrains to stay if not implicated.
    const allPathTerrains = ttr.terrainsInPath();
    for ( const pathTerrain of allPathTerrains ) {
      if ( pathTerrain.id === terrain.id ) continue;
      pathTerrain.removeFromToken(token); // Async
    }
  }
}

PATCHES.BASIC.HOOKS = {
  preUpdateToken: preUpdateTokenHook,
  refreshToken: refreshTokenHook
};

// ----- NOTE: Methods ----- //

/**
 * Retrieve all terrains on the token.
 * @returns {Terrain[]}
 */
function getAllTerrains() { return Terrain.getAllOnToken(this); }

/**
 * Remove all terrains from the token.
 */
async function removeAllTerrains() { return Terrain.removeAllFromToken(this); }

PATCHES.BASIC.METHODS = {
  getAllTerrains,
  removeAllTerrains
}

// ----- NOTE: Wraps ----- //

/**
 * Display the terrain name as the token is dragged.
 */
function _getTooltipText(wrapper) {
  let text = wrapper();

  // If not a clone, return.
  if ( !this._original ) return text;

  const terrain = canvas.terrain.terrainAt(this.center);
  if ( terrain ) text =
`${terrain.name}
${text}`;
  return text;
}

PATCHES.BASIC.WRAPS = {
  _getTooltipText
}

