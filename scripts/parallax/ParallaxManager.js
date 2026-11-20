/* globals
canvas,
foundry,
fromUuidSync,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ParallaxRegionMesh, ParallaxTileMesh } from "./parallax_geometry.js";
import { MODULE_ID, FLAGS } from "../const.js";
import { fastFlag } from "../util.js";

export const PATCHES = {};
PATCHES.PARALLAX = {};

export class ParallaxManager {

  /** @type {Map<string, ParallaxRegionMesh} regionD.id -> mesh */
  meshes = new Map();

  /**
   * Create and refresh a region's parallax mesh.
   * Destroys the mesh, if any, if the region does not have a parallax behavior.
   * @type {RegionDocument|TileDocument} placeableD
   */
  sync(placeableD) {
    if ( placeableD instanceof foundry.documents.RegionDocument ) this._syncRegion(placeableD);
    else if ( placeableD instanceof foundry.documents.TileDocument ) this._syncTile(placeableD);
  }

  /**
   * Create and refresh a region's parallax mesh.
   * Destroys the mesh, if any, if the region does not have a parallax behavior.
   * @type {RegionDocument} regionD
   */
  _syncRegion(regionD) {
    const atCurrentLevel = regionD.levels.size ? regionD.levels.has(canvas.level.id) : true;
    const b = regionD.behaviors.find(b => !b.disabled && b.type === `${MODULE_ID}.parallax`);
    if ( !(atCurrentLevel && b) ) {
      this._deleteMesh(regionD);
      return;
    }
    let pm = this.meshes.get(regionD.id);
    if ( !pm ) {
      const tileUUID = b.system.tileUUID;
      const tileD = fromUuidSync(tileUUID);
      if ( !tileD ) this.meshes.set(regionD.id, pm = new ParallaxRegionMesh(regionD));
      else this.meshes.set(regionD.id, pm = new ParallaxRegionMesh(regionD, {
        tileD, hideOriginal:
        b.system.hideOriginal
      }));
    }
    pm.setStrength(b.system.strength);
    pm.refresh(canvas.primary);
  }

  /**
   * Create and refresh a tile's parallax mesh.
   * Destroys the mesh, if any, if the tile does not have a parallax behavior.
   * @type {TileDocument} tileD
   */
  _syncTile(tileD) {
    const atCurrentLevel = tileD.levels.size ? tileD.levels.has(canvas.level.id) : true;
    const hasParallax = fastFlag(tileD, FLAGS.TILE.PARALLAX);
    if ( !(atCurrentLevel && hasParallax) ) {
      this._deleteMesh(tileD);
      return;
    }
    let pm = this.meshes.get(tileD.id);
    if ( !pm ) this.meshes.set(tileD.id, pm = new ParallaxTileMesh(tileD));
    pm.setStrength(hasParallax);
    pm.refresh(canvas.primary);
  }

  /**
   * Delete a region's parallax mesh.
   * @type {RegionDocument|string} idOrRegionD        Region document or its id
   */
  _deleteMesh(idOrRegionD) {
    const id = isString(idOrRegionD) ? idOrRegionD : idOrRegionD.id;
    this.meshes.get(id)?.destroy();
    this.meshes.delete(id);
  }

}

// Only need a singleton for a given session.
export const parallaxManager = new ParallaxManager();

/**
 * A hook event that fires when the Canvas is panned.
 *
 * Update the camera position for the meshes.
 *
 * @event
 * @category Canvas
 * @param {Canvas} canvas                  The Canvas instance
 * @param {CanvasViewPosition} position    The constrained camera position
 */
function canvasPan(_canvas, { x, y } = {}) {
  parallaxManager.meshes.forEach(pm => pm.setCenter(x, y));
}

/**
 * A hook event that fires when the Canvas is ready.
 *
 * Sync all region parallax meshes.
 *
 * @event
 * @category Canvas
 * @param {Canvas} canvas The Canvas which is now ready for use
 */
function canvasReady(_canvas) {
  for ( const region of canvas.regions.placeables ) parallaxManager.sync(region.document);
  for ( const tile of canvas.tiles.placeables ) parallaxManager.sync(tile.document);
}

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * When tile updates, sync the mesh for the tile.
 *
 * @event
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTile(tileD, _changed, _options, _userId) {
  parallaxManager.sync(tileD);
}

/**
 * A hook event that fires for every Document type after conclusion of an deletion workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "deleteActor".
 * This hook fires for all connected clients after the deletion has been processed.
 *
 * When tile is deleted, remove the mesh.
 *
 * @event
 * @category Document
 * @param {Document} document                       The existing Document which was deleted
 * @param {Partial<DatabaseDeleteOperation>} options Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteTile(tileD, _options, _userId) {
  parallaxManager._deleteMesh(tileD);
}

PATCHES.PARALLAX.HOOKS = { canvasPan, canvasReady, updateTile, deleteTile };

// ----- NOTE: Helper functions ----- //

function isString(value) { return typeof value === "string" || value instanceof String; }
