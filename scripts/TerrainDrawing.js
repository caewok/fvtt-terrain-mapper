/* globals
Drawing
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Class to represent terrain drawings on the canvas.
 * Allow GM to manipulate the terrain shape.
 * Underlying document is an ActiveEffect.
 * Each drawing is a placeable object in the TerrainEditLayer,
 * which is contained in the TerrainLayer.
 */
export class TerrainDrawing extends Drawing {

  /** @type {TerrainGridSquare|TerrainGridPolygon|TerrainGridHexagon} */

//   constructor(terrainShape) {
//     const terrain = canvas.terrain.sceneMap.get(terrainShape.pixelValue);
//     super(terrain.activeEffect);
//     this.terrainShape = terrainShape;
//   }
//
//   /** @type {Terrain} */
//   get terrain() { return canvas.terrain.sceneMap.get(this.terrainShape.pixelValue); }
//
//   get layer() { return canvas.terrain; }
//
//   /**
//    * The bounding box for this drawing, based on the shape.
//    */
//   get bounds() { return this.terrainShape.getBounds(); }
//
//   get center() { return this.terrainShape.center; }
//
//   /**
//    * Draw the terrain on the canvas.
//    * Based on the Drawing class.
//    */
//   async _draw(options) {
//     // Load the background icon.
//     const texture = this.document.icon;
//     if ( this._original ) this.texture = this._original.texture?.clone();
//     else this.texture = texture ? await loadTexture(texture, {fallback: "icons/svg/hazard.svg"}) : null;
//
//     // Create the primary group drawing container
//     this.shape = canvas.terrain.addDrawing(this);
//
//     // Control Border
//     this.frame = this.addChild(this.#drawFrame());
//
//     // Drawing text
//     this.text = this.addChild(this.#drawText());
//
//     // Interactivity
//     this.cursor = this.document.isOwner ? "pointer" : null;
//
//   }
//
//   #drawFrame() {}
//
//   #drawText() {}

  _canControl(user, event) {
    if ( !user.isGM ) return false;

    if ( !canvas.terrain.active ) return false;

    // Check if the edit toggle is active or if this is a preview.
    if ( this.isPreview ) return true;
    const editToggle = canvas.terrain.controls.tool.find(t => t.name === "terrain-edit-toggle")
    return editToggle.active;
  }


}
