/* globals
canvas,
CONFIG,
game,
InteractionLayer,
mergeObject,
PIXI,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Terrain } from "./Terrain.js";
import { TerrainSettings } from "./settings.js";
import { FILOQueue } from "./FILOQueue.js";
import { PixelCache } from "./PixelCache.js";
import { Draw } from "./geometry/Draw.js";
import { TerrainGridSquare } from "./TerrainGridSquare.js";
import { TerrainGridHexagon } from "./TerrainGridHexagon.js";


export class TerrainLayer extends InteractionLayer {

  /** @type {number} */
  static MAX_TERRAIN_ID = Math.pow(2, 5) - 1;

  /**
   * Container to hold objects to display wall information on the canvas
   */
  _wallDataContainer = new PIXI.Container();

  /**
   * Sprite that contains the terrain values from the saved terrain image file.
   * This is added to the _graphicsContainer, along with any graphics representing
   * adjustments by the GM to the scene elevation.
   * @type {PIXI.Sprite}
   */
  _backgroundTerrain = PIXI.Sprite.from(PIXI.Texture.EMPTY);

  /**
   * Container to hold the current graphics objects representing terrain.
   * These graphics objects are created when the GM modifies the scene terrain using
   * the layer tools.
   * @type {PIXI.Container}
   */
  _graphicsContainer = new PIXI.Container();

  /**
   * Queue of all terrain shapes drawn on canvas, stored in order.
   * @type {FILOQueue}
   */
  _shapeQueue = new FILOQueue(1e04); // Maximum size of the stored values.

  /**
   * The terrain layer data is rendered into this texture, which is then used for
   * calculating terrain at given points.
   * @type {PIXI.RenderTexture}
   */
  _terrainTexture;

  /**
   * PIXI.Mesh used to display the elevation colors when the layer is active.
   * @type {TerrainLayerShader}
   */
  _terrainColorsMesh;

  /**
   * Stores graphics created when dragging using the fill-by-grid control.
   * @param {Map<PIXI.Graphics>}
   */
  #temporaryGraphics = new Map();

  /**
   * Flag for when the elevation data has changed for the scene, requiring a save.
   * Currently happens when the user changes the data or uploads a new data file.
   * @type {boolean}
   */
  _requiresSave = false; // Avoid private field here b/c it causes problems for arrow functions

  constructor() {
    super();
    this.controls = ui.controls.controls.find(obj => obj.name === "terrain");
    this.undoQueue = new FILOQueue();
  }

  /** @overide */
  static get layerOptions() {
    return mergeObject(super.layerOptions, {
      name: "Terrain"
    });
  }

  /**
   * Add the layer so it is accessible in the console.
   */
  static register() { CONFIG.Canvas.layers.terrain = { group: "primary", layerClass: TerrainLayer }; }

  // ----- NOTE: Access terrain data ----- //

  get sceneMap() { return Terrain.sceneMap; }

  /**
   * Set up the terrain layer for the first time once the scene is loaded.
   */
  initialize() {
    const currId = TerrainSettings.getByName("CURRENT_TERRAIN");
    if ( currId ) this.currentTerrain = this.sceneMap.terrainIds.get(currId);
    if ( !this.currentTerrain ) this.currentTerrain = this.sceneMap.values().next().value;
  }

  /**
   * Get the terrain data for a given pixel value.
   * @param {number} pixelValue
   * @returns {Terrain}
   */
  terrainForPixel(pixelValue) { return this.sceneMap.get(pixelValue); }

  /**
   * Get the terrain data for a given terrain id
   * @param {string} terrainId
   * @returns {Terrain}
   */
  terrainForId(terrainId) { return this.sceneMap.terrainIds.get(terrainId); }

  /**
   * Get the color that represents the terrain and layer.
   * @param {Terrain}
   * @return {PIXI.Color}
   */
  _terrainPixelColor(terrain) { return new PIXI.Color(this._terrainToPixelChannels(terrain)); }

  /**
   * Convert a terrain value to a pixel value between 0 and 255 per channel
   * @param {Terrain} terrain    Terrain to convert
   * @param {number} layer       Layer number
   * @returns {object}
   *   - {number} r   Red channel, integer between 0 and 255
   *   - {number} g   Green channel, integer between 0 and 255
   *   - {number} b   Blue channel, currently unused
   */
  _terrainToPixelChannels(terrain, _layer = 0) {
    // TODO: Handle layers.
    return { r: terrain.pixelValue ?? 0, g: 0, b: 0 };
  }


  /**
   * Force the terrain id to be between 0 and the maximum value.
   * @param {number} id
   * @returns {number}
   */
  clampTerrainId(id) {
    id ??= 0;
    return Math.clamped(Math.round(id), 0, this.constructor.MAX_TERRAIN_ID);
  }

  /**
   * Given red 8-bit channels of a color, return an integer value representing terrain.
   * @param {number} r    Red channel value, between 0 and 255.
   * @returns {number} Number between 0 and 31
   */
  _decodeTerrainChannels(r, _g, _b, _a) { return this.clampTerrainId(r); }


  /**
   * Download terrain data from the scene.
   */
  downloadData() {
    console.debug("I should be downloading terrain data for the scene...");
  }


  /**
   * Import terrain data from an image file into the scene.
   */
  importFromImageFile() {
    console.debug("I should be importing terrain data for the scene...");
  }

  /* ----- NOTE: Pixel data ----- */

  /** @type {PixelFrame} */
  #pixelCache;

  get pixelCache() {
    return this.#pixelCache ?? (this.#pixelCache = this.#refreshPixelCache());
  }

  /**
   * Refresh the pixel array cache from the elevation texture.
   */
  #refreshPixelCache() {
    const { sceneX: x, sceneY: y } = canvas.dimensions;
    return PixelCache.fromTexture(
      this._terrainTexture,
      { x, y, arrayClass: Uint8Array, combineFn: this._decodeTerrainChannels });
  }

  /**
   * Is this pixel id actually present in the scene?
   * @param {number} pixelValue
   * @returns {boolean}
   */
  isPixelValueInScene(pixelValue) {
    if ( !pixelValue || pixelValue < 0 || pixelValue > 31 ) return false;
    return this._shapeQueue.elements.some(e => e.shape.pixelValue === pixelValue);
  }


  /* ----- NOTE: Rendering ----- */

  /**
   * (Re)render the graphics stored in the container.
   */
  renderTerrain() {
    const dims = canvas.dimensions;
    const transform = new PIXI.Matrix(1, 0, 0, 1, -dims.sceneX, -dims.sceneY);
    canvas.app.renderer.render(this._graphicsContainer, { renderTexture: this._terrainTexture, transform });

    // Destroy the cache
    this._clearPixelCache();
  }

  /**
   * Clear the pixel cache
   */
  _clearPixelCache() { this.#pixelCache = undefined; }

  /**
   * Destroy elevation data when changing scenes or clearing data.
   */
  #destroy() {
    this._shapeQueue.elements.length = 0;

    this._clearTerrainPixelCache();
    this._backgroundTerrain.destroy();
    this._backgroundTerrain = PIXI.Sprite.from(PIXI.Texture.EMPTY);
    this._terrainColorsMesh?.destroy();

    this._graphicsContainer.destroy({children: true});
    this._graphicsContainer = new PIXI.Container();

    this._terrainTexture?.destroy();
  }

  /* ----- Update grid terrain ----- */

  /**
   * Apply a give shape with a given terrain value.
   * Draw the graphics. Store the underlying shape data.
   * @param {TerrainGridSquare
            |TerrainGridHexagon
            |TerrainPolygon} shape      A PIXI shape to draw using PIXI.Graphics.
   * @param {Terrain} terrain           Terrain to represent
   * @param {object} [opts]
   * @param {boolean} [opts.temporary=false]    Is this a temporary object? (Typically a dragged clone.)
   * @returns {PIXI.Graphics}
   */
  addTerrainShapeToCanvas(shape, terrain, { temporary = false }) {
    shape.pixelValue = terrain.pixelValue;
    if ( temporary && this.#temporaryGraphics.has(shape.origin.key) ) {
      // Replace with this item.
      // It is anticipated that copying over a shape, perhaps with a different terrain value,
      // will result in the newer version getting saved.
      const oldValues = this.#temporaryGraphics.get(shape.origin.key);
      this._graphicsContainer.removeChild(oldValues.graphics);
    }

    // Draw the graphics element for the shape to display to the GM.
    const graphics = this._drawTerrainShape(shape, terrain);

    if ( temporary ) this.#temporaryGraphics.set(shape.origin.key, { shape, graphics });
    else this._shapeQueue.enqueue({ shape, graphics }); // Link to PIXI.Graphics object for undo.

    // Trigger save if necessary.
    this._requiresSave = !temporary;
    return graphics;
  }

  /**
   * Represent the shape as a PIXI.Graphics object in the layer container.
   * Color is the pixel color representing this terrain for this scene.
   * @param {TerrainGridSquare
            |TerrainGridHexagon
            |TerrainPolygon} shape      A PIXI shape to draw using PIXI.Graphics.
   * @param {Terrain} terrain           Terrain to represent
   * @returns {PIXI.Graphics}
   */
  _drawTerrainShape(shape, terrain) {
    // TODO: Handle drawing of icon, displaying selected terrain color.
    const graphics = this._graphicsContainer.addChild(new PIXI.Graphics());
    const color = this._terrainPixelColor(terrain);

    // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
    // and that causes a lighter-color border to appear outside the shape.
    const draw = new Draw(graphics);
    draw.shape(shape, { width: 0, fill: color});
    //this.renderTerrain();
    return graphics;
  }

  /* ----- Controls ----- */

  /**
   * Set the elevation for the grid space that contains the point.
   * If this is a hex grid, it will fill in the hex grid space.
   * @param {Point} p             Point within the grid square/hex.
   * @param {number} elevation    Elevation to use to fill the grid space
   * @param {object}  [options]   Options that affect setting this elevation
   * @param {boolean} [options.temporary]   If true, don't immediately require a save.
   *   This setting does not prevent a save if the user further modifies the canvas.
   * @param {boolean} [options.useHex]      If true, use a hex grid; if false use square.
   *   Defaults to canvas.grid.isHex.
   *
   * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
   */
  setTerrainForGridSpace(p, terrain, { temporary = false, useHex = canvas.grid.isHex } = {}) {
    const shape = useHex ? this._hexGridShape(p) : this._squareGridShape(p);
    return this.addTerrainShapeToCanvas(shape, terrain, { temporary });
  }

  /**
   * Undo the prior graphics addition.
   */
  undo() {
    const res = this._shapeQueue.dequeue();
    if ( !res || !res.graphics ) return;
    this._graphicsContainer.removeChild(res.graphics);
    res.graphics.destroy();
    this._requiresSave = true;
    this.renderTerrain();
  }

  /**
   * Remove all terrain data from the scene.
   */
  async clearData() {
    this._shapeQueue.elements.length = 0;

    this._clearTerrainPixelCache();
    this._backgroundTerrain.destroy();
    this._backgroundTerrain = PIXI.Sprite.from(PIXI.Texture.EMPTY);

    this._graphicsContainer.destroy({children: true});
    this._graphicsContainer = new PIXI.Container();

    this._requiresSave = false;
    this.renderTerrain();
  }

  /* ----- Grid Shapes ----- */

  _squareGridShape(p) { return TerrainGridSquare.fromLocation(p.x, p.y); }

  _hexGridShape(p) { return TerrainGridHexagon.fromLocation(p.x, p.y); }

  /* ----- Event Listeners and Handlers ----- /*

  /**
   * If the user clicks a canvas location, change its elevation using the selected tool.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(event) {
    const o = event.interactionData.origin;
    const activeTool = game.activeTool;
    const currT = this.toolbar.currentTerrain;

    console.debug(`clickLeft at ${o.x},${o.y} with tool ${activeTool} and terrain ${currT.name}`, event);

    switch ( activeTool ) {
      case "fill-by-grid":
        this.setTerrainForGridSpace(o, currT);
        break;
      case "fill-by-los":
        console.debug("fill-by-los not yet implemented.");
        this.fillLOS(o, currT);
        break;
      case "fill-by-pixel":
        console.debug("fill-by-pixel not yet implemented.");
        break;
      case "fill-space":
        console.debug("fill-space not yet implemented.");
        this.fill(o, currT);
        break;
    }

    // Standard left-click handling
    super._onClickLeft(event);
  }

  /**
   * If the user initiates a drag-left:
   * - fill-by-grid: keep a temporary set of left corner grid locations and draw the grid
   */
  _onDragLeftStart(event) {
    const activeTool = game.activeTool;
    if ( activeTool !== "fill-by-grid" ) return;

    const o = event.interactionData.origin;
    const currT = this.toolbar.currentTerrain;
    console.debug(`dragLeftStart at ${o.x}, ${o.y} with tool ${activeTool} and terrain ${currT.name}`, event);

    this.#temporaryGraphics.clear(); // Should be accomplished elsewhere already
    this.setTerrainForGridSpace(o, currT, { temporary: true });
  }

  /**
   * User continues a drag left.
   * - fill-by-grid: If new grid space, add.
   */
  _onDragLeftMove(event) {
    const activeTool = game.activeTool;
    if ( activeTool !== "fill-by-grid" ) return;

    const o = event.interactionData.origin;
    const d = event.interactionData.destination;
    const currT = this.toolbar.currentTerrain;
    console.debug(`dragLeftMove from ${o.x},${o.y} to ${d.x}, ${d.y} with tool ${activeTool} and terrain ${currT.name}`, event);

    // Color the grid square at the current destination.
    this.setTerrainForGridSpace(d, currT, { temporary: true });
  }

  /**
   * User commits the drag
   */
  _onDragLeftDrop(event) {
    const activeTool = game.activeTool;
    if ( activeTool !== "fill-by-grid" ) return;

    const o = event.interactionData.origin;
    const d = event.interactionData.destination;
    const currT = this.toolbar.currentTerrain;
    console.debug(`dragLeftDrop at ${o.x}, ${o.y} to ${d.x},${d.y} with tool ${activeTool} and terrain ${currT?.name}`, event);

    // Add each temporary shape to the queue, reset the temporary map and save.
    this.#temporaryGraphics.forEach(obj => this._shapeQueue.enqueue(obj));
    this.#temporaryGraphics.clear(); // Don't destroy children b/c added already to main graphics
    this._requiresSave = true;
  }

  /**
   * User cancels the drag.
   * Currently does not appear triggered by anything, but conceivably could be triggered
   * by hitting escape while in a drag.
   */
  _onDragLeftCancel(event) {
    const activeTool = game.activeTool;
    if ( activeTool !== "fill-by-grid" ) return;

    const currT = this.toolbar.currentTerrain;
    console.debug(`dragLeftCancel with tool ${activeTool} and terrain ${currT?.name}`, event);

    this.#temporaryGraphics.forEach(obj => {
      this._graphicsContainer.removeChild(obj.graphics);
      obj.graphics.destroy();
    });
    this.#temporaryGraphics.clear();
  }

  /**
   * User scrolls the mouse wheel. Currently does nothing in response.
   */
  _onMouseWheel(event) {
    const o = event.interactionData.origin;
    const activeTool = game.activeTool;
    const currT = this.toolbar.currentTerrain;
    console.debug(`mouseWheel at ${o.x}, ${o.y} with tool ${activeTool} and terrain ${currT?.name}`, event);

    // Cycle to the next scene terrain

  }

  /**
   * User hits delete key. Currently not triggered (at least on this M1 Mac).
   */
  async _onDeleteKey(event) {
    const o = event.interactionData.origin;
    const activeTool = game.activeTool;
    const currT = this.toolbar.currentTerrain;
    console.debug(`deleteKey at ${o.x}, ${o.y} with tool ${activeTool} and terrain ${currT?.name}`, event);
  }
}
