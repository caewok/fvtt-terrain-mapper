/* globals
canvas,
CONFIG,
FullCanvasObjectMixin,
game,
InteractionLayer,
mergeObject,
PIXI,
PreciseText,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { Terrain } from "./Terrain.js";
import { Settings } from "./Settings.js";
import { FILOQueue } from "./FILOQueue.js";
import { PixelCache } from "./PixelCache.js";
import { Draw } from "./geometry/Draw.js";
import { TerrainGridSquare } from "./TerrainGridSquare.js";
import { TerrainGridHexagon } from "./TerrainGridHexagon.js";
import { TerrainPolygon } from "./TerrainPolygon.js";
import { TerrainTextureManager } from "./TerrainTextureManager.js";
import { TerrainLayerShader } from "./glsl/TerrainLayerShader.js";
import { TerrainQuadMesh } from "./glsl/TerrainQuadMesh.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { TerrainShapeHoled } from "./TerrainShapeHoled.js";
import { FillByGridHelper } from "./FillByGridHelper.js";
import { FillPolygonHelper } from "./FillPolygonHelper.js";
import { TravelTerrainRay } from "./TravelTerrainRay.js";
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";
import { TerrainMap } from "./TerrainMap.js";
import { TerrainColor } from "./TerrainColor.js";
import { TerrainLevel } from "./TerrainLevel.js";

// TODO: What should replace this now that FullCanvasContainer is deprecated in v11?
class FullCanvasContainer extends FullCanvasObjectMixin(PIXI.Container) {

}

export class TerrainLayer extends InteractionLayer {

  TerrainColor = TerrainColor;

  /** @type {TerrainMap} */
  sceneMap = new TerrainMap();

  /** @type {boolean} */
  #initialized = false;

  /** @type {TravelTerrainRay} */
  TravelTerrainRay = TravelTerrainRay;

  /** @type {PIXI.Container} */
  preview = new PIXI.Container();

  /** @type {PixelFrame} */
  #terrainPixelCache;

  /** @type {FillByGridHelper} */
  #controlsHelper;

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
   * Container to hold terrain names, when toggled on.
   * @type {PIXI.Graphics}
   */
  _terrainLabelsContainer = new PIXI.Graphics();

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
   * @type {Map<PIXI.Graphics>}
   */
  #temporaryGraphics = new Map();

  /**
   * Store the string indicating the terrain at a given mouse point.
   * @type {string}
   */
  terrainLabel;

  /**
   * Flag for when the elevation data has changed for the scene, requiring a save.
   * Currently happens when the user changes the data or uploads a new data file.
   * @type {boolean}
   */
  _requiresSave = false; // Avoid private field here b/c it causes problems for arrow functions

  /** @type {TerrainTextureManager} */
  _textureManager = new TerrainTextureManager();

  constructor() {
    super();
    this.controls = ui.controls.controls.find(obj => obj.name === "terrain");
    this._activateHoverListener();
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

  // ----- NOTE: Mouse hover management ----- //

  /**
   * Activate a listener to display elevation values when the mouse hovers over an area
   * of the canvas in the elevation layer.
   * See Ruler.prototype._onMouseMove
   */
  _onMouseMove(event) {
    if ( !canvas.ready
      || !canvas.terrain.active
      || !this.terrainLabel ) return;

    // Get the canvas position of the mouse pointer.
    const pos = event.getLocalPosition(canvas.app.stage);
    if ( !canvas.dimensions.sceneRect.contains(pos.x, pos.y) ) {
      this.terrainLabel.visible = false;
      return;
    }

    // Update the numeric label with the elevation at this position.
    this.updateTerrainLabel(pos);
    this.terrainLabel.visible = true;
  }

  _activateHoverListener() {
    console.debug("activatingHoverListener");
    const textStyle = PreciseText.getTextStyle({
      fontSize: 24,
      fill: "#333333",
      strokeThickness: 2,
      align: "right",
      dropShadow: false
    });

    this.terrainLabel = new PreciseText(undefined, textStyle);
    this.terrainLabel.anchor = {x: 0, y: 1};
    canvas.stage.addChild(this.terrainLabel);
  }

  /**
   * Update the elevation label to the elevation value at the provided location,
   * and move the label to that location.
   * @param {number} x
   * @param {number} y
   */
  updateTerrainLabel({x, y}) {
    const terrain = this.#terrainAt({x, y});
    this.terrainLabel.text = terrain?.name || "";
    this.terrainLabel.position = {x, y};
    // Debug: console.debug(`Terrain ${terrain?.name} at ${x},${y}`);
  }

  // ----- NOTE: Access terrain data ----- //

  /**
   * Get the terrain(s) at a given position.
   * @param {Point} {x, y}
   * @returns {TerrainLevel[]}
   */
  terrainsAt(pt) {
    if ( !this.#initialized ) return undefined;

    // Return only terrains that are non-zero.
    const terrainLayers = this._terrainLayersAt(pt);
    return terrainLayers.filter(t => t.pixelValue);
  }

  _terrainLayersAt({x, y}) {
    if ( !this.#initialized ) return undefined;
    const pixelValue = this.pixelCache.pixelAtCanvas(x, y);
    if ( pixelValue === 0 ) return [];

    // Find the terrain at each layer and return the terrains.
    const layers = this._layersFromPixel(pixelValue);
    const terrainLayers = new Array(8);
    for ( let i = 0; i < 8; i += 1 ) {
      const terrainPixel = layers[i];
      const terrain = this.terrainForPixel(terrainPixel);
      terrainLayers[i] = new TerrainLevel(terrain, i);
    }
    return terrainLayers;
  }

  /**
   * Get the terrain given the current level.
   * @param {Point} {x, y}
   * @returns {Terrain|undefined} Terrain, or undefined if no terrain at this level.
   */
  #terrainAt(pt) {
    const layers = this._terrainLayersAt(pt);
    const currLayer = this.toolbar.currentLayer;
    const terrain = layers[currLayer];
    return terrain?.pixelValue ? terrain : undefined; // Don't return the null terrain.
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
   * @param {Terrain}   terrain
   * @param {number}    layer
   * @return {TerrainColor}
   */
  _terrainPixelColor(terrain, layer) {
    layer ??= this.toolbar.currentLayer;
    return TerrainColor.fromTerrainValue(terrain.pixelValue, layer);
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
   * Given red 8-bit channels of a color, return an integer value representing terrain and layer.
   * Used by the pixel cache.
   * @param {number} r    Red channel value, between 0 and 255
   * @param {number} g    Green channel value, between 0 and 255
   * @param {number} b    Blue channel value, between 0 and 255
   * @returns {number} Integer between 0 and 2^32.
   */
  _decodeTerrainChannels(r, g, b) { return TerrainColor.fromRGBIntegers(r, g, b); }

  /**
   * From a pixel integer, get the layers array.
   * @param {number} pixel    Pixel value (likely from the pixel cache), between 0 and 2^32
   * @returns {Uint8Array[8]} layers
   */
  _layersFromPixel(pixel) { return (new TerrainColor(pixel)).toTerrainLayers(); }

  // ----- NOTE: Initialize, activate, deactivate, destroy ----- //

  /**
   * Set up the terrain layer for the first time once the scene is loaded.
   */
  async initialize() {
    const currId = Settings.getByName("CURRENT_TERRAIN");
    if ( currId ) this.currentTerrain = this.sceneMap.terrainIds.get(currId);
    if ( !this.currentTerrain ) this.currentTerrain = this.sceneMap.values().next().value;

    // Initialize container to hold the elevation data and GM modifications.
    const w = new FullCanvasContainer();
    this.container = this.addChild(w);

    // Background terrain sprite
    // Should start at the upper left scene corner
    // Holds the default background elevation settings
    const { sceneX, sceneY } = canvas.dimensions;
    this._backgroundTerrain.position = { x: sceneX, y: sceneY };
    this._graphicsContainer.addChild(this._backgroundTerrain);

    // Add the render texture for displaying elevation information to the GM
    // Set the clear color of the render texture to black. The texture needs to be opaque.
    this._terrainTexture = PIXI.RenderTexture.create(this._textureManager.textureConfiguration);
    this._terrainTexture.baseTexture.clearColor = [0, 0, 0, 1];

    // TODO: load the shape queue from stored data.

    await this.loadSceneMap();

    // Add the elevation color mesh
    const shader = TerrainLayerShader.create();
    this._terrainColorsMesh = new TerrainQuadMesh(canvas.dimensions.sceneRect, shader);
    this.renderTerrain();
    this.#initialized = true;
  }

  /** @override */
  _activate() {
    console.debug("Activating Terrain Layer.");

    // Draw walls
    for ( const wall of canvas.walls.placeables ) {
      this._drawWallSegment(wall);
      this._drawWallRange(wall);
    }

    this.drawTerrain();
    this.container.visible = true;
    canvas.stage.addChild(this.terrainLabel);
    canvas.stage.addChild(this._wallDataContainer);

    // Enable the preview container, for polygon drawing, etc.
    this.addChild(this.preview);

    this._updateControlsHelper();
    this.clearPreviewContainer();
  }

  /**
   * Clear the contents of the preview container, restoring visibility of original (non-preview) objects.
   */
  clearPreviewContainer() {
    if ( !this.preview ) return;
    this.preview.removeChildren().forEach(c => {
      c._onDragEnd();
      c.destroy({children: true});
    });
  }

  /** @override */
  async _deactivate() {
    console.debug("De-activating Terrain Layer.");
    if ( !this.container ) return;
    canvas.stage.removeChild(this._wallDataContainer);

    this.eraseTerrain();

    // TO-DO: keep the wall graphics and labels and just update as necessary.
    // Destroy only in tearDown
    const wallData = this._wallDataContainer.removeChildren();
    wallData.forEach(d => d.destroy(true));

    canvas.stage.removeChild(this.terrainLabel);
    Draw.clearDrawings();
    this.container.visible = false;

    if ( this._requiresSave ) await this.save();
  }

  /** @override */
  async _draw(options) { // eslint-disable-line no-unused-vars
  // Not needed?
  // if ( canvas.elevation.active ) this.drawElevation();
  }

  /** @inheritdoc */
  async _tearDown(options) {
    console.debug("_tearDown Terrain Layer");
    if ( this._requiresSave ) await this.save();

    // Probably need to figure out how to destroy and/or remove these objects
    //     this._graphicsContainer.destroy({children: true});
    //     this._graphicsContainer = null;
    this.#destroy();
    this.container = null;
    return super._tearDown(options);
  }

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

    this._terrainLabelsContainer.destroy({children: true});
    this._terrainLabelsContainer = new PIXI.Graphics();

    this._terrainTexture?.destroy();
  }

  /**
   * Clear the pixel cache
   */
  _clearTerrainPixelCache() {
    this.#terrainPixelCache = undefined;
  }

  /**
   * Save data related to this scene.
   */
  async save() {
    await this.saveSceneMap();
  }

  // ----- NOTE: SceneMap ----- //

  /**
   * Load the scene terrain map.
   * @returns {TerrainMap}
   */
  async loadSceneMap() {
    const sceneMap = this.sceneMap;
    sceneMap.clear();

    // Determine what terrain pixel values are in the scene.
    const pixelValuesInScene = new Set(this.pixelCache.pixels);
    this._shapeQueue.elements.forEach(e => pixelValuesInScene.add(e.pixelValue));

    // Set the 0 pixel value just in case the entire scene is set to another pixel value.
    const nullTerrain = new Terrain();
    sceneMap.set(0, nullTerrain, true); // Null terrain.
    nullTerrain.addToScene();

    // Set the terrain ids for each value based on stored data for the scene.
    // Only set ids if the pixel value is present in the scene terrain.
    const mapData = canvas.scene.getFlag(MODULE_ID, FLAGS.TERRAIN_MAP) ?? [];
    mapData.forEach(([key, effectId]) => {
      if ( !pixelValuesInScene.has(key) ) return;
      const terrain = Terrain.fromEffectId(effectId, false);
      sceneMap.set(key, terrain, true);
    });

    // Add any missing values as new terrain.
    // TODO: Should this be null terrain?
    for ( const pixelValue in pixelValuesInScene ) {
      if ( sceneMap.has(pixelValue) ) continue;
      const newTerrain = new Terrain();
      await newTerrain.initialize();
      newTerrain.name = game.i18n.localize(`${MODULE_ID}.phrases.new-terrain`);
      this.sceneMap.set(pixelValue, newTerrain);
      newTerrain.addToScene();
    }
  }

  async saveSceneMap() {
    // Don't save unless it has more than the null terrain.
    const sceneMap = this.sceneMap;
    if ( sceneMap.size < 2 ) return;

    // Store the scene map in the scene document.
    const mapData = [...sceneMap.entries()].map(([key, terrain]) => [key, terrain.id]);
    await canvas.scene.setFlag(MODULE_ID, FLAGS.TERRAIN_MAP, mapData);
  }

  /**
   * Determine if a terrain is in the scene map.
   * @param {Terrain} terrain
   * @returns {boolean}
   */
  _inSceneMap(terrain) { return this.sceneMap.hasTerrainId(terrain.id); }

  /**
   * Add terrain value to the scene map and update the controls.
   * @param {Terrain} terrain
   * @returns {number} The integer pixel value assigned to this terrain for the scene.
   */
  _addTerrainToScene(terrain) {
    if ( this._inSceneMap(terrain) ) return this.sceneMap.keyForValue(terrain);

    // Add the terrain to the scene map and mark for save (avoids making this method async).
    const pixelValue = this.sceneMap.add(terrain);
    this._requiresSave = true;

    // Refresh the UI related to the terrain.
    this._terrainColorsMesh.shader.updateTerrainColors();
    if ( ui.controls.activeControl === "terrain" ) ui.controls.render();
    TerrainEffectsApp.rerender();

    // Return the pixel value that was assigned.
    return pixelValue;
  }

  /**
   * Remove terrain value from the scene map and update the controls.
   * @param {Terrain} terrain
   * @returns {Terrain} New terrain that replaced the old in the scene.
   */
  async _removeTerrainFromScene(terrain) {
    if ( !this._inSceneMap(terrain) || !terrain.pixelValue ) return;

    // Replace this terrain with a new one in the scene map.
    const newTerrain = new Terrain();
    await newTerrain.initialize();
    newTerrain.name = game.i18n.localize(`${MODULE_ID}.phrases.new-terrain`);
    this.sceneMap.set(terrain.pixelValue, newTerrain);
    newTerrain.addToScene();
    this._requiresSave = true;

    // Refresh the UI for the terrain.
    this._terrainColorsMesh.shader.updateTerrainColors();
    if ( this.toolbar.currentTerrain === this ) this.toolbar._currentTerrain = undefined;
    if ( ui.controls.activeControl === "terrain" ) ui.controls.render();
    TerrainEffectsApp.rerender();

    return newTerrain;
  }

  /**
   * Remove terrain from the scene map entirely, without replacement.
   * @param {Terrain} terrain
   */
  #removeTerrainFromSceneMap(terrain) {
    if ( !this._inSceneMap(terrain) || !terrain.pixelValue ) return;

    // Remove this terrain from the scene map and mark for save (avoids making this method async).
    this.sceneMap.delete(terrain.pixelValue);
    this._requiresSave = true;
    terrain._unassignPixel();

    // Refresh the UI for the terrain.
    this._terrainColorsMesh.shader.updateTerrainColors();
    if ( this.toolbar.currentTerrain === this ) this.toolbar._currentTerrain = undefined;
    if ( ui.controls.activeControl === "terrain" ) ui.controls.render();
    TerrainEffectsApp.rerender();
  }

  /**
   * Replace terrain in scene by another at the specific pixel value..
   * @param {Terrain} newTerrain      New terrain to use
   * @param {number} pixelValue       Pixel value associated with the terrain to replace
   */
  _replaceTerrainInScene(newTerrain, pixelValue) {
    const oldTerrain = this.sceneMap.get(pixelValue);
    if ( oldTerrain === newTerrain || oldTerrain.id === newTerrain.id ) return;
    this.sceneMap.set(pixelValue, newTerrain, true);
    oldTerrain._unassignPixel(pixelValue);
    newTerrain.addToScene();
  }

  // ----- NOTE: Data import/export ----- //

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
    const combineFn = this._decodeTerrainChannels.bind(this);
    return PixelCache.fromTexture(
      this._terrainTexture,
      { x, y, arrayClass: Uint32Array, combineFn });
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
   * Draw all the graphics in the queue for purposes of debugging.
   */
  _debugDrawColors() {
    const draw = new Draw();
    draw.clearDrawings();
    for ( const e of this._shapeQueue.elements ) {
      const shape = e.shape;
      const terrain = this.sceneMap.get(shape.pixelValue);
      draw.shape(shape, { fill: terrain.color, width: 0 });
    }
  }

  _debugDrawText() {
    const draw = new Draw();
    draw.clearLabels();
    for ( const e of this._shapeQueue.elements ) {
      const shape = e.shape;
      const terrain = this.sceneMap.get(shape.pixelValue);
      const txt = draw.labelPoint(shape.origin, terrain.name, { fontSize: 24 });
      txt.anchor.set(0.5); // Center text
    }
  }

  _debugClear() {
    const draw = new Draw();
    draw.clearDrawings();
    draw.clearLabels();
  }

  /**
   * Display the terrain names / turn off the display.
   * @param {boolean} force
   */
  toggleTerrainNames(force) {
    const polygonText = this._terrainLabelsContainer.polygonText;
    if ( !polygonText ) return;

    // If already set and we want to force to a specific setting, do not toggle.
    const namesEnabled = canvas.controls.children.includes(polygonText);
    if ( force === true && namesEnabled ) return;
    if ( force === false && !namesEnabled ) return;

    // Toggle on/off
    if ( namesEnabled ) canvas.controls.removeChild(polygonText);
    else canvas.controls.addChild(polygonText);
  }

  /**
   * Draw the terrain name into the container that stores names.
   */
  _drawTerrainName(shape) {
    const draw = new Draw(this._terrainLabelsContainer);
    const terrain = this.sceneMap.get(shape.pixelValue);
    const txt = draw.labelPoint(shape.origin, terrain.name, { fontSize: 24 });
    txt.anchor.set(0.5); // Center text
  }

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
   * Draw the elevation container.
   */
  drawTerrain() {
    this.container.addChild(this._terrainColorsMesh);

    // Turn on names if the toggle is active.
    const nameToggle = this.controls.tools.find(t => t.name === "terrain-view-toggle");
    if ( nameToggle.active ) this.toggleTerrainNames(true);
  }

  /**
   * Remove the elevation color shading.
   */
  eraseTerrain() {
    this.container.removeChild(this._terrainColorsMesh);
    this.toggleTerrainNames(false);
  }

  /**
   * Draw wall segments
   */
  _drawWallSegment(wall) {
    const g = new PIXI.Graphics();
    const draw = new Draw(g);
    const color = wall.isOpen ? Draw.COLORS.blue : Draw.COLORS.red;
    const alpha = wall.isOpen ? 0.5 : 1;

    draw.segment(wall, { color, alpha });
    draw.point(wall.A, { color: Draw.COLORS.red });
    draw.point(wall.B, { color: Draw.COLORS.red });
    this._wallDataContainer.addChild(g);
  }

  /**
   * From https://github.com/theripper93/wall-height/blob/12c204b44e6acfa1e835464174ac1d80e77cec4a/scripts/patches.js#L318
   * Draw the wall lower and upper heights on the canvas.
   */
  _drawWallRange(wall) {
    // Fill in for WallHeight.getWallBounds
    const bounds = {
      top: wall.document.flags?.["wall-height"]?.top ?? Number.POSITIVE_INFINITY,
      bottom: wall.document.flags?.["wall-height"]?.bottom ?? Number.NEGATIVE_INFINITY
    };
    if ( bounds.top === Infinity && bounds.bottom === -Infinity ) return;

    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize /= 1.5;
    style.fill = wall._getWallColor();
    if ( bounds.top === Infinity ) bounds.top = "Inf";
    if ( bounds.bottom === -Infinity ) bounds.bottom = "-Inf";
    const range = `${bounds.top} / ${bounds.bottom}`;

    // This would mess with the existing text used in walls layer, which may not be what we want.
    // const oldText = wall.children.find(c => c.name === "wall-height-text");
    // const text = oldText ?? new PreciseText(range, style);
    const text = new PreciseText(range, style);
    text.text = range;
    text.name = "wall-height-text";
    let angle = (Math.atan2( wall.coords[3] - wall.coords[1], wall.coords[2] - wall.coords[0] ) * ( 180 / Math.PI ));
    angle = ((angle + 90 ) % 180) - 90;
    text.position.set(wall.center.x, wall.center.y);
    text.anchor.set(0.5, 0.5);
    text.angle = angle;

    this._wallDataContainer.addChild(text);
  }

  /**
   * Clear the pixel cache
   */
  _clearPixelCache() { this.#pixelCache = undefined; }

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
  addTerrainShapeToCanvas(shape, terrain, { temporary = false } = {}) {
    if ( !this.sceneMap.hasTerrainId(terrain.id) ) terrain.addToScene();
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

    // Either temporarily draw or permanently draw the graphics for the shape.
    if ( temporary ) this.#temporaryGraphics.set(shape.origin.key, { shape, graphics });
    else {
      this._shapeQueue.enqueue({ shape, graphics }); // Link to PIXI.Graphics object for undo.
      this._drawTerrainName(shape);
    }

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
    const draw = new Draw(graphics);
    // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
    // and that causes a lighter-color border to appear outside the shape.
    draw.shape(shape, { width: 0, fill: color});
    this.renderTerrain();
    return graphics;
  }

  // ----- NOTE: Controls ----- //

  /**
   * Construct a LOS polygon from this point and fill with the provided terrain.
   * @param {Point} origin        Point where viewer is assumed to be.
   * @param {Terrain} terrain     c
   * @param {object} [options]    Options that affect the fill.
   * @param {string} [options.type]   Type of line-of-sight to use, which can affect
   *   which walls are included. Defaults to "light".
   * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
   */
  fillLOS(origin, terrain, { type = "light"} = {}) {
    const los = CONFIG.Canvas.polygonBackends[type].create(origin, { type });
    const shape = TerrainPolygon.fromPolygon(los);
    shape.origin.copyFrom(origin);
    return this.addTerrainShapeToCanvas(shape, terrain);
  }

  /**
   * Fill spaces enclosed by walls from a given origin point.
   * @param {Point} origin      Start point for the fill.
   * @param {Terrain} terrain   Terrain to use for the fill.
   * @returns {PIXI.Graphics}   The child graphics added to the _graphicsContainer
   */
  fill(origin, terrain) {
    /* Algorithm
      Prelim: Gather set of all walls, including boundary walls.
      1. Shoot a line to the west and identify colliding walls.
      2. Pick closest and remember it.

      Determine open/closed
      3. Follow the wall clockwise and turn clockwise at each intersection or endpoint.
      4. If back to original wall, found the boundary.
      5. If ends without hitting original wall, this wall set is open.
         Remove walls from set; redo from (1).

      Once boundary polygon is found:
      1. Get all (potentially) enclosed walls. Use bounding rect.
      2. Omit any walls whose endpoint(s) lie outside the actual boundary polygon.
      3. For each wall, determine if open or closed using open/closed algorithm.
      4. If open, omit walls from set. If closed, these are holes. If the linked walls travels
         outside the boundary polygon than it can be ignored
    */

    /* testing
    origin = _token.center
    el = canvas.elevation
    api = game.modules.get("elevatedvision").api
    WallTracer = api.WallTracer

    */

    console.debug(`Attempting fill at { x: ${origin.x}, y: ${origin.y} } with terrain ${terrain.name}`);
    const polys = SCENE_GRAPH.encompassingPolygonWithHoles(origin);
    if ( !polys.length ) {
      // Shouldn't happen, but...
      ui.notifications.warn(`Sorry; cannot locate a closed boundary for the requested fill at { x: ${origin.x}, y: ${origin.y} }!`);
      return;
    }
    const shape = new TerrainShapeHoled(polys, { pixelValue: terrain.pixelValue });

    // In case we have zero holes; we can simplify the result.
    // (Should not require cleaning, as it would just have been built with clipper.)
    const shapes = shape.simplify();
    for ( const shape of shapes ) {
      this.addTerrainShapeToCanvas(shape, terrain);
    }
  }

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

  // ----- Grid Shapes ----- //

  _squareGridShape(p) { return TerrainGridSquare.fromLocation(p.x, p.y); }

  _hexGridShape(p) { return TerrainGridHexagon.fromLocation(p.x, p.y); }

  // ----- NOTE: Event Listeners and Handlers ----- //

  /**
   * Update the controls helper based on the active tool.
   */
  _updateControlsHelper() {
    const activeTool = game.activeTool;
    switch ( activeTool ) {
      case "fill-by-grid":
        this.#controlsHelper = new FillByGridHelper();
        break;
      case "fill-polygon":
        this.#controlsHelper = new FillPolygonHelper();
        break;
      default:
        this.#controlsHelper = undefined;
    }
  }

  #debugClickEvent(event, fnName) {
    const activeTool = game.activeTool;
    const o = event.interactionData.origin;
    const currT = this.toolbar.currentTerrain;
    console.debug(`TerrainLayer|${fnName} at ${o.x}, ${o.y} with tool ${activeTool} and terrain ${currT?.name}`, event);
  }


  /**
   * If the user clicks a canvas location, change its elevation using the selected tool.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(event) {
    this.#debugClickEvent(event, "_onClickLeft");
    const o = event.interactionData.origin;
    const currT = this.toolbar.currentTerrain;
    switch ( game.activeTool ) {
      case "fill-by-grid": {
        this.#controlsHelper._onClickLeft(event);
        break;
      }
      case "fill-by-los":
        this.fillLOS(o, currT);
        break;
      case "fill-by-pixel":
        console.debug("fill-by-pixel not yet implemented.");
        break;
      case "fill-space":
        this.fill(o, currT);
        break;
      case "fill-polygon": {
        this.#controlsHelper._onClickLeft(event);
        break;
      }
    }

    // Standard left-click handling
    super._onClickLeft(event);
  }


  /**
   * Handle a double-click left.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft2(event) {
    this.#debugClickEvent(event, "_onClickLeft2");

    if ( !this.#controlsHelper ) return;
    this.#controlsHelper._onClickLeft2(event);

    // Standard double-left-click handling
    super._onClickLeft2(event);
  }

  /**
   * Handle a right click.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickRight(event) {
    this.#debugClickEvent(event, "_onClickRight");

    if ( !this.#controlsHelper ) return;
    this.#controlsHelper._onClickRight(event);

    // Standard right-click handling
    super._onClickRight(event);
  }

  /**
   * If the user initiates a drag-left:
   * - fill-by-grid: keep a temporary set of left corner grid locations and draw the grid
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftStart(event) {
    this.#debugClickEvent(event, "_onDragLeftStart");

    if ( !this.#controlsHelper ) return;
    this.#controlsHelper._onDragLeftStart(event);
  }

  /**
   * User continues a drag left.
   * - fill-by-grid: If new grid space, add.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftMove(event) {
    this.#debugClickEvent(event, "_onDragLeftMove");

    if ( !this.#controlsHelper ) return;
    this.#controlsHelper._onDragLeftMove(event);
  }

  /**
   * User commits the drag
   * @param {PIXI.InteractionEvent} event
   */
  async _onDragLeftDrop(event) {
    this.#debugClickEvent(event, "_onDragLeftDrop");

    if ( !this.#controlsHelper ) return;
    return this.#controlsHelper._onDragLeftDrop(event);
  }

  /**
   * User cancels the drag.
   * Currently does not appear triggered by anything, but conceivably could be triggered
   * by hitting escape while in a drag.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftCancel(event) {
    this.#debugClickEvent(event, "_onDragLeftCancel");

    if ( !this.#controlsHelper ) return;
    this.#controlsHelper._onDragLeftCancel(event);

    super._onDragLeftCancel(event);
  }

  /**
   * Make temporary graphics permanent by adding them to the queue.
   * Assumes temp graphics already otherwise drawn.
   */
  _makeTemporaryGraphicsPermanent() {
    this.#temporaryGraphics.forEach(obj => {
      this._shapeQueue.enqueue(obj);
      this._drawTerrainName(obj.shape);
    });
    this.#temporaryGraphics.clear(); // Don't destroy children b/c added already to main graphics
  }

  /**
   * Clear the temporary graphics queue and destroy children.
   */
  _clearTemporaryGraphics() {
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
