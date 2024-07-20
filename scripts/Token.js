/* globals
canvas,
CONFIG,
CONST,
game,
PIXI,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

import { MODULE_ID, FLAGS } from "./const.js";
import { log, tokenIsFlying, tokenIsBurrowing } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook preCreateToken
 * When creating the token, set its elevation to the scene background.
 * @param {Document} document                     The pending document which is requested for creation
 * @param {object} data                           The initial data object provided to the document creation request
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modify the creation request
 * @param {string} userId                         The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                        Explicitly return false to prevent creation of this Document
 */
function preCreateToken(tokenD, data, _options, _userId) {
  if ( !canvas.scene ) return;
  const elevation = Region[MODULE_ID].sceneFloor;
  if ( elevation && !data.elevation ) tokenD.updateSource({ elevation });
}

/**
 * Hook preUpdateToken
 * If disposition changes, change actor's unique effect status icon display.
 * @param {Document} document                       The Document instance being updated
 * @param {object} changed                          Differential data that will be used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modify the update request
 * @param {string} userId                           The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                          Explicitly return false to prevent update of this Document
 */
function updateToken(tokenD, changed, _options, userId) {
  if ( !game.users.get(userId).isGM ) return;
  if ( !Object.hasOwn(changed, "disposition") ) return;
  if ( !tokenD.object ) return;
  const terrainDocs = CONFIG[MODULE_ID].Terrain._allUniqueEffectDocumentsOnToken(tokenD.object)
  if ( !terrainDocs.length ) return;

  if ( changed.disposition === CONST.TOKEN_DISPOSITIONS.SECRET ) {
    terrainDocs.forEach(doc =>  doc.update({ statuses: []})); // Async
  } else terrainDocs.forEach(doc => {
    if ( !doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.DISPLAY_ICON) ) return;
    doc.update({ statuses: [doc.img]}); // Async
  });
}

/**
 * Hook refreshToken.
 * Adjust terrain as the token moves; handle animation pauses.
 */
function refreshToken(token, flags) {
  if ( token.isPreview ) {
    // Token is clone in a drag operation.
    if ( flags.refreshPosition || flags.refreshElevation || flags.refreshSize ) {
      let text = token._getTooltipText();

      // Test for regions with terrains.
      const terrains = new Set();
      for ( const region of identifyRegions(token) ) identifyRegionTerrains(region).forEach(t => terrains.add(t));
      if ( terrains.size ) {
        // Limit to visible terrains for the user.
        const userTerrains = game.user.isGM ? terrains : terrains.filter(t => t.userVisible);

        // Combine all the terrains.
        const names = [...userTerrains].map(t => t.name);
        text = `${names.join("\n")}\n${text}`;
      }
      token.tooltip.text = text;


      // Adjust the token preview's elevation based on regions.
      const origin = token._original.center;
      origin.elevation = token._original.elevationE;
      const destination = token.center;
      destination.elevation = origin.elevation;

      const flying = tokenIsFlying(token, origin, destination);
      const burrowing = tokenIsBurrowing(token, origin, destination);
      const path = Region[MODULE_ID].constructRegionsPath(origin, destination, { burrowing, flying }); // Returns minimum [start, end]. End might be changed.
      const elevationChanged = token.document.elevation !== path.at(-1).elevation;
      if ( elevationChanged ) {
        log(`refreshToken|Setting preview token ${token.name} elevation to ${path.at(-1).elevation} at ${destination.x},${destination.y}`);
        token.document.elevation = path.at(-1).elevation;
        //token.renderFlags.set({ refreshElevation: true, refreshVisibility: true });
      }

      // if ( path.length > 2 ) token.document.updateSource({ elevation: path.at(-1).elevation });
    }
    return;
  } else if ( token.animationContexts.size ) {
    log(`${token.name} is animating`);
    // TODO: Is there a way to calculate the path only once? The issue is with ramps mostly---how to store step elevation?
    //       Also, how to easily locate position along the path?
    // Maybe take a page from Elevated Vision TER approach: Use a class for the path that can determine elevation.
    // This could track current region and adjust as necessary.
    const path = token[MODULE_ID]?.path;
    if ( !path ) return;
    const currPosition = token.getCenterPoint(token.position);
    const currElevation = Math.round(path.elevationAt(currPosition));
    const elevationChanged = token.document.elevation !== currElevation;
    if ( elevationChanged ) {
       // token.document.elevation = path.at(-1).elevation;
       log(`refreshToken|Setting animating token ${token.name} elevation to ${currElevation} at ${currPosition.x},${currPosition.y}`);
       // token.document.updateSource({ elevation: currPath.at(-1).elevation });
       token.document.elevation = currElevation;
       token.renderFlags.set({refreshElevation: true, refreshVisibility: true, refreshTooltip: true });
    }
  }
}

/**
 * Hook preUpdateToken
 * If the token moves, calculate its new elevation across setElevation regions.
 * @param {Document} document                       The Document instance being updated
 * @param {object} changed                          Differential data that will be used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modify the update request
 * @param {string} userId                           The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                          Explicitly return false to prevent update of this Document
 */
export function preUpdateToken(tokenD, changed, options, _userId) {
  log(`preUpdateToken ${tokenD.name}`);
  const token = tokenD.object;
  if ( !token ) return;
  token[MODULE_ID] ??= {};
  token[MODULE_ID].path = undefined;

  if ( options.RidingMovement ) return; // See EV issue #83—compatibility with Rideables.
  if ( Object.hasOwn(changed, "elevation") ) return; // Do not override existing elevation changes.
  if ( !(Object.hasOwn(changed, "x") || Object.hasOwn(changed, "y")) ) return;

  const destination = token.getCenterPoint({ x: changed.x ?? token.x, y: changed.y ?? token.y });
  const origin = token.center;
  origin.elevation = token.elevationE
  destination.elevation = changed.elevation ?? origin.elevation;
  const flying = tokenIsFlying(token, origin, destination);
  const burrowing = tokenIsBurrowing(token, origin, destination);
  token[MODULE_ID].path = Region[MODULE_ID].constructRegionsPath(origin, destination, { burrowing, flying });

  // Set the destination elevation.
  log(`preUpdateToken|Setting destination elevation to ${token[MODULE_ID].path.at(-1).elevation}`);

  changed.elevation = token[MODULE_ID].path.at(-1).elevation;
}

PATCHES.BASIC.HOOKS = {
  preCreateToken,
  refreshToken,
  preUpdateToken,
  updateToken
};

// ----- NOTE: Wraps ----- //


// ----- NOTE: Methods ----- //

/**
 * Retrieve all terrains on the token.
 * @returns {Terrain[]}
 */
function getAllTerrains() { return CONFIG[MODULE_ID].Terrain.allOnToken(this); }

/**
 * Remove all terrains from the token.
 */
async function removeAllTerrains() { return CONFIG[MODULE_ID].Terrain.removeAllFromToken(this); }

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

// ----- NOTE: Helper functions ----- //

/**
 * For a given preview token, determine what regions it would be in.
 * See TokenDocument##identifyRegions
 * @param {Token} token
 * @returns {Set<Region>}
 */
function identifyRegions(token) {
  const regions = new Set();
  const center = token.getCenterPoint();
  const elevation = token.elevation;
  for ( const region of canvas.regions.placeables ) {
    if ( region.testPoint(center, elevation) ) regions.add(region);
  }
  return regions;
}

/**
 * For a given preview token, determine what terrains it would have if it entered the region.
 * @param {Region} region
 * @returns {Set<Terrain>}
 */
const ENTRY_EVENTS = new Set([
  CONST.REGION_EVENTS.TOKEN_ENTER,
  CONST.REGION_EVENTS.TOKEN_MOVE,
  CONST.REGION_EVENTS.TOKEN_MOVE_IN,
  CONST.REGION_EVENTS.TOKEN_PRE_MOVE,
]);

const ENTRY_EVENTS_COMBAT = new Set([
  CONST.REGION_EVENTS.TOKEN_ROUND_END,
  CONST.REGION_EVENTS.TOKEN_ROUND_START,
  CONST.REGION_EVENTS.TOKEN_TURN_END,
  CONST.REGION_EVENTS.TOKEN_TURN_START
]);

function identifyRegionTerrains(region, isGM = game.user.isGM) {
  const events = game.combat?.started ? ENTRY_EVENTS.union(ENTRY_EVENTS_COMBAT) : ENTRY_EVENTS;
  const terrainIds = new Set();
  for ( const behavior of region.document.behaviors.values() ) {
    if ( behavior.disabled ) continue;
    if ( !(behavior.type === `${MODULE_ID}.addTerrain` || behavior.type === `${MODULE_ID}.setTerrain`) ) continue;
    if ( behavior.type === `${MODULE_ID}.addTerrain` && !behavior.system.events.intersects(events) ) continue;
    if ( !isGM && behavior.system.secret ) continue;
    behavior.system.terrains.forEach(t => terrainIds.add(t));
  }
  return new Set([...terrainIds].map(id => CONFIG[MODULE_ID].Terrain._instances.get(id)).filter(t => Boolean(t)));
}
