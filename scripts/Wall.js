/* globals
canvas,
game
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { SCENE_GRAPH } from "./WallTracer.js";

// Methods related to Wall

export const PATCHES = {};
PATCHES.BASIC = {};

// NOTE: Wall Document Hooks

/**
 * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
 * Substitute the Document name in the hook event to target a specific type, for example "createToken".
 * This hook fires for all connected clients after the creation has been processed.
 *
 * @event createDocument
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createWall(wallD, _options, _userId) {
  if ( !wallD.object.isOpen ) {
    // Build the edges for this wall.
    SCENE_GRAPH.addWall(wallD.object);
    SCENE_GRAPH.updateCyclePolygons();
  }
  if ( !game.user.isGM ) return;
  canvas.terrain._addWall(wallD.object);
}

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWall(wallD, changes, _options, _userId) {
  // Only update the edges if the coordinates have changed or the door setting has changed.
  if ( Object.hasOwn(changes, "c") || Object.hasOwn(changes, "ds") ) {
    // Easiest approach is to trash the edges for the wall and re-create them.
    SCENE_GRAPH.removeWall(wallD.id);

    // Only add the wall back if it is not open
    if ( !wallD.object.isOpen) SCENE_GRAPH.addWall(wallD.object);
  }

  // Update the polygons regardless, in case a wall limitation or wall height has changed.
  SCENE_GRAPH.updateCyclePolygons();

  if ( !game.user.isGM ) return;
  canvas.terrain._updateWall(wallD.object);
}

/**
 * A hook event that fires for every Document type after conclusion of an deletion workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "deleteActor".
 * This hook fires for all connected clients after the deletion has been processed.
 *
 * @event deleteDocument
 * @category Document
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteWall(wallD, _options, _userId) {
  // The document.object is now null; use the id to remove the wall.
  SCENE_GRAPH.removeWall(document.id);
  SCENE_GRAPH.updateCyclePolygons();

  if ( !game.user.isGM ) return;
  canvas.terrain._removeWall(wallD.id);
}

PATCHES.BASIC.HOOKS = {
  createWall,
  updateWall,
  deleteWall
};

