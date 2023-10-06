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

import { MODULE_ID, SOCKETS } from "./const.js";
import { Settings } from "./Settings.js";
import { TravelTerrainRay } from "./TravelTerrainRay.js";
import { Terrain } from "./Terrain.js";

export const PATCHES = {};
PATCHES.BASIC = {};

const SETTINGS = Settings.KEYS;
const AUTO = SETTINGS.AUTO_TERRAIN;

// ----- NOTE: Hooks ----- //

/**
 * Hook preUpdateToken.
 * If the token moves, determine its terrain status.
 */
function preUpdateTokenHook(tokenD, changes, _options, _userId) {
  const autoT = Settings.get(AUTO.ALGORITHM);
  if ( autoT === AUTO.CHOICES.NO ) return;
  if ( autoT === AUTO.CHOICES.COMBAT && !game.combat?.isActive ) return;

  const changeKeys = new Set(Object.keys(flattenObject(changes)));
  const token = tokenD.object;
  const destination = token.getCenter(changes.x ?? token.x, changes.y ?? token.y);
  const tm = token[MODULE_ID] ??= {};
  const origTTR = tm.ttr;
  if ( changeKeys.has("elevation") && origTTR ) {
    // Something, like Levels Stairs, has changed the token elevation during an animation.
    // Redo the travel terrain ray from this point.
    origTTR.origin = destination;
    origTTR.origin.z = changes.elevation;
  }

  if ( !(changeKeys.has("x") || changeKeys.has("y")) ) return;

  const ttr = new TravelTerrainRay(token, { destination });
  tm.ttr = ttr;
}

/**
 * Hook refreshToken.
 * Adjust terrain as the token moves; handle animation pauses.
 */
function refreshTokenHook(token, flags) {
  token[MODULE_ID] ??= {};
  const autoT = Settings.get(AUTO.ALGORITHM);
  if ( autoT === AUTO.CHOICES.NO ) return;
  if ( autoT === AUTO.CHOICES.COMBAT && !game.combat?.isActive ) return;
  if ( !(flags.refreshPosition || flags.refreshElevation) ) return;

  if ( token._original ) {
    // This token is a clone in a drag operation.

  } else if ( token._animation ) {
    const ttr = token[MODULE_ID].ttr;
    if ( !ttr ) return;
    const center = token.getCenter(token.position.x, token.position.y);
    const terrain = ttr.terrainAtClosestPoint(center);
    if ( !terrain ) {
      Terrain.removeAllSceneTerrainsFromToken(token);
      return;
    }

    if ( token.hasTerrain(terrain) ) return;
    terrain.addToToken(token, { removeSceneTerrains: true });
    if ( Settings.get(AUTO.DIALOG) ) {
      token.stopAnimation();
      token.document.update({ x: token.position.x, y: token.position.y });
      const dialogData = terrainEncounteredDialogData(token, terrain, ttr.destination);
      SOCKETS.socket.executeAsGM("dialog", dialogData);
    }
  }
}


/**
 * Function to present dialog to GM.
 */
function terrainEncounteredDialogData(token, terrain, destination) {
  const localize = key => game.i18n.localize(`${MODULE_ID}.terrain-encountered-dialog.${key}`);
  return {
    title: localize("title"),
    content: game.i18n.format(`${MODULE_ID}.terrain-encountered-dialog.content`,
      { terrainName: terrain.name, tokenName: token.name }),
    buttons: {
      one: {
        icon: "<i class='fas fa-person-hiking'></i>",
        label: localize("continue"),
        callback: async () => {
          console.debug("Continued animation.");
          const tl = token.getTopLeft(destination.x, destination.y);
          await token.document.update({x: tl.x, y: tl.y});
        }
      },

      two: {
        icon: "<i class='fas fa-person-falling-burst'></i>",
        label: localize("cancel"),
        callback: async () => {
          console.debug("Canceled.");
        }
      }
    },
    default: "one"
  };
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

/**
 * Test if token has a given terrain.
 * @param {Terrain}
 * @returns {boolean}
 */
function hasTerrain(terrain) { return terrain.tokenHasTerrain(this); }


PATCHES.BASIC.METHODS = {
  getAllTerrains,
  removeAllTerrains,
  hasTerrain
};

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

