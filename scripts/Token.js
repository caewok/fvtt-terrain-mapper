/* globals
canvas,
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
import { Settings } from "./settings.js";
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

    // Determine if there are any active terrains based on the center of this token.
    const center = token.getCenter(token.position.x, token.position.y);
    const pathTerrains = ttr.activeTerrainsAtClosestPoint(center);
    if ( !pathTerrains.size ) {
      Terrain.removeAllSceneTerrainsFromToken(token); // Async
      return;
    }

    // Determine if terrains must be added or removed from the token at this point.
    const tokenTerrains = new Set(Terrain.allSceneTerrainsOnToken(token));
    const terrainsToRemove = tokenTerrains.difference(pathTerrains);
    const terrainsToAdd = pathTerrains.difference(tokenTerrains);

    // Following remove/add is async.
    terrainsToRemove.forEach(t => t.removeFromToken(token));
    terrainsToAdd.forEach(t => t.addToToken(token));

    // If no terrains added or no dialog required when adding terrains, we are done.
    if ( !terrainsToAdd.size ) return;
    if ( Settings.get(AUTO.DIALOG) ) {
      token.stopAnimation();
      token.document.update({ x: token.position.x, y: token.position.y });
      game.togglePause(true); // Pause for this user only.
      const dialogContent = terrainEncounteredDialogContent(token, [...terrainsToAdd]);
      SOCKETS.socket.executeAsGM("terrainEncounteredDialog", token.document.uuid, dialogContent, ttr.destination, game.user.id);
    }
  }
}

/**
 * Terrain encountered dialog html content.
 * @param {Token} token
 * @param {Set<Terrain>} terrains
 * @returns {string} HTML string
 */
function terrainEncounteredDialogContent(token, terrains) {
  const names = [...terrains].map(t => t.name);
  const intro = game.i18n.format(`${MODULE_ID}.terrain-encountered-dialog.content`, { tokenName: token.name });
  return `${intro}: ${names.join(", ")}<br><hr>`;
}

/**
 * Function to present dialog to GM. Assumed it may be run via socket.
 * @param {string} tokenUUID    Token uuid string for token that is currently moving
 * @param {string} content      Dialog content, as html string
 * @param {Point} destination   Intended destination for the token
 * @param {string} [userId]       User that triggered this dialog.
 */
export function terrainEncounteredDialog(tokenUUID, content, destination, userId) {
  const token = fromUuidSync(tokenUUID)?.object;
  if ( !token ) return;
  game.togglePause(true);
  userId ??= game.user.id;
  const localize = key => game.i18n.localize(`${MODULE_ID}.terrain-encountered-dialog.${key}`);
  const data = {
    title: localize("title"),
    content,
    buttons: {
      one: {
        icon: "<i class='fas fa-person-hiking'></i>",
        label: localize("continue"),
        callback: async () => {
          console.debug("Continued animation.");
          const tl = token.getTopLeft(destination.x, destination.y);
          await token.document.update({x: tl.x, y: tl.y});
          // SOCKETS.socket.executeAsUser("updateTokenDocument", userId, tokenUUID, {x: tl.x, y: tl.y});
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
    default: "one",
    close: () => game.togglePause(false, true)
  };

  const d = new Dialog(data);
  d.render(true);
}

/**
 * Function to update token data as a specific user.
 * This allows the GM to continue token movement but as that user.
 * By doing so, this allows the pause-for-user to work as expected.
 */
export async function updateTokenDocument(tokenUUID, data) {
  const token = fromUuidSync(tokenUUID)?.object;
  if ( !token ) return;
  token.document.update(data);
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

/**
 * Calculate the top left corner location for a token given an assumed center point.
 * Used for automatic terrain determination.
 * @param {number} x    Assumed x center coordinate
 * @param {number} y    Assumed y center coordinate
 * @returns {PIXI.Point}
 */
function getTopLeft(x, y) {
  return new PIXI.Point(x - (this.w * 0.5), y - (this.h * 0.5));
}

PATCHES.BASIC.METHODS = {
  getAllTerrains,
  removeAllTerrains,
  hasTerrain,
  getTopLeft
};

// ----- NOTE: Wraps ----- //

/**
 * Display the terrain name as the token is dragged.
 */
function _getTooltipText(wrapper) {
  let text = wrapper();

  // If not a clone, return.
  if ( !this._original ) return text;

  // Get every active terrain below the center of the token.
  const terrains = canvas.terrain.activeTerrainsAt(this.center, this.elevationE);
  if ( !terrains.size ) return text;

  // Limit to visible terrains for the user.
  const userTerrains = game.user.isGM ? terrains : terrains.filter(t => t.userVisible);

  // Combine all the terrains.
  const names = [...userTerrains].map(t => t.name);

  return `${names.join("\n")}\n${text}`;
}

PATCHES.BASIC.WRAPS = {
  _getTooltipText
};
