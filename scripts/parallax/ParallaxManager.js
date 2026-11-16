/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ParallaxRegionMesh } from "./parallax_geometry.js";
import { MODULE_ID } from "../const.js";

export const PATCHES = {};
PATCHES.PARALLAX = {};

export class ParallaxManager {

  /** @type {Map<string, ParallaxRegionMesh} regionD.id -> mesh */
  meshes = new Map();

  /**
   * Create and refresh a region's parallax mesh.
   * Destroys the mesh, if any, if the region does not have a parallax behavior.
   * @type {RegionDocument} regionD
   */
  sync(regionD) {
    const atCurrentLevel = regionD.levels.size ? regionD.levels.has(canvas.level.id) : true;
    const b = regionD.behaviors.find(b => !b.disabled && b.type === `${MODULE_ID}.parallax`);
    if ( !(atCurrentLevel && b) ) {
      this._deleteMesh(regionD);
      return;
    }
    let pm = this.meshes.get(regionD.id);
    if ( !pm ) this.meshes.set(regionD.id, pm = new ParallaxRegionMesh(regionD));
    pm.setStrength(b.system.strength);
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
}

PATCHES.PARALLAX.HOOKS = { canvasPan, canvasReady };

// ----- NOTE: Helper functions ----- //

function isString(value) { return typeof value === "string" || value instanceof String; }
