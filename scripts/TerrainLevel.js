/* globals
canvas,
CONFIG,
MeasuredTemplate,
Tile
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { TerrainKey, TerrainPixelCache } from "./TerrainPixelCache.js";
import { gridShapeFromGridCoords } from "./util.js";


/**
 * Represent the terrain at a specific level.
 * Stores the level information for this terrain.
 * Singleton instance per id.
 */
export class TerrainLevel {

  static _instances = new Map();

  /** @type {TerrainKey} */
  key = new TerrainKey(0);

  constructor(terrain, level) {
    this.terrain = terrain ?? canvas.terrain.controls.currentTerrain;
    this.level = level ?? canvas.terrain.controls.currentLevel;

    const instances = this.constructor._instances;
    if (instances.has(this.id) ) return instances.get(this.id); // eslint-disable-line no-constructor-return
    instances.set(this.id, this);

    this.scene = canvas.scene;
    this.key = TerrainKey.fromTerrainValue(this.terrain.pixelValue, this.level);
  }

  // Simple getters used to pass through terrain values.

  /** @type {string} */
  get name() { return this.terrain.name; }

  /** @type {number} */
  get pixelValue() { return this.terrain.pixelValue; }

  /** @type {FLAGS.ANCHOR.CHOICES} */
  get anchor() { return this.terrain.anchor; }

  /** @type {boolean} */
  get userVisible() { return this.terrain.userVisible; }

  /**
   * Unique id for this type of level and terrain. Used to distinguish between copies.
   * @type {string}
   */
  get id() { return `${this.terrain.id}_canvasLevel_${this.level}`; }

  /**
   * Retrieve the anchor elevation of this level in this scene.
   * @returns {number} The elevation, in grid units.
   */
  _layerElevation() {
    const layerElevations = canvas.scene.getFlag(MODULE_ID, FLAGS.LAYER_ELEVATIONS) ?? (new Array(8)).fill(0);
    return layerElevations[this.level];
  }

  /**
   * Retrieve the elevation of the terrain at this point.
   * @returns {number}
   */
  _canvasElevation(location) { return canvas.elevation?.elevationAt(location) ?? 0; }

  /**
   * Determine the anchor elevation for this terrain.
   * @param {Point} [location]    Location on the map. Required if the anchor is RELATIVE_TO_TERRAIN and EV is present.
   * @returns {number}
   */
  getAnchorElevation(location) {
    const CHOICES = FLAGS.ANCHOR.CHOICES;
    switch ( this.anchor ) {
      case CHOICES.ABSOLUTE: return 0;
      case CHOICES.RELATIVE_TO_TERRAIN: return location ? this._canvasElevation(location) : 0;
      case CHOICES.RELATIVE_TO_LAYER: return this._layerElevation;
    }
  }

  /**
   * Elevation range for this terrain at a given canvas location.
   * @param {Point} [location]    Location on the map. Required if the anchor is RELATIVE_TO_TERRAIN and EV is present.
   * @returns {min: {number}, max: {number}} In grid units
   */
  elevationRange(location) {
    const anchorE = this.getAnchorElevation(location);
    return this.terrain._elevationMinMaxForAnchorElevation(anchorE);
  }

  /**
   * Convenience method to get the pixel units for the elevation range. Used by TravelTerrainRay.
   * @param {Point} [location]    Location on the map. Required if the anchor is RELATIVE_TO_TERRAIN and EV is present.
   * @returns {min: {number}, max: {number}} In pixel units
   */
  elevationRangeZ(location) {
    const minMax = this.elevationRange(location);
    minMax.min = CONFIG.GeometryLib.utils.gridUnitsToPixels(minMax.min);
    minMax.max = CONFIG.GeometryLib.utils.gridUnitsToPixels(minMax.max);
    return minMax;
  }

  /**
   * Determine if the terrain is active at the provided elevation.
   * @param {number} elevation    Elevation to test
   * @param {Point} [location]    Location on the map. Required if the anchor is RELATIVE_TO_TERRAIN and EV is present.
   * @returns {boolean}
   */
  activeAt(elevation, location) {
    const minMaxE = this.elevationRange(location);
    return elevation.between(minMaxE.min, minMaxE.max);
  }

  /**
   * Calculate what percentage of the grid square/hex is covered by this terrain.
   * See percentCoverage.
   */
  percentGridShapeCoverage(gridCoords, elevation = 0, opts = {}) {
    const shape = gridShapeFromGridCoords(gridCoords);
    return this.percentCoverage(shape, elevation, opts);
  }

  /**
   * Determine what percentage of a PIXI object is covered by this terrain for this level.
   * The shape center at this elevation must be active unless elevationTest is false.
   * @param {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle} shape
   * @param [number] [elevation=0]          Assumed elevation for this shape if not 0
   * @param {object} [opts]                 Options passed to PixelCache._aggregation
   * @param {number} [opts.skip]            Skip every X pixels when aggregating
   * @param {number[]} [opts.localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {boolean} [opts.testElevation]  If false, skip the activeAt test.
   * @returns {number}
   */
  percentCoverage(shape, elevation = 0, { skip, localOffsets, testElevation = true } = {}) {
    if ( testElevation && !this.activeAt(elevation, shape.center) ) return 0;
    const reducerFn = TerrainPixelCache.pixelAggregator("average_eq_threshold", Number(this.key));
    return canvas.terrain.pixelCache._aggregation(shape, reducerFn, skip, localOffsets);
  }
}

/**
 * Represent a terrain linked to a tile.
 */
export class TerrainTile extends TerrainLevel {
  /** @type {Tile} */
  tile;

  constructor(terrain, tile) {
    if ( tile && !(tile instanceof Tile) ) console.error("TerrainTile requires a Tile object.", tile);
    super(terrain, tile);
    this.tile = tile;
  }

  /**
   * Unique id for this type of level and terrain. Used to distinguish between copies.
   * @type {string}
   */
  get id() { return `${this.terrain.id}_tile_${this.level.id}`; } // Level equals tile here.

  /**
   * Returns the tile elevation.
   * @returns {number} Elevation, in grid units.
   */
  _layerElevation() { return this.tile.elevationE || 0; }

  /**
   * Determine if the terrain is active at the provided elevation.
   * @param {number} elevation    Elevation to test
   * @param {Point}  location    Location on the map. Required.
   * @returns {boolean}
   */
  activeAt(elevation, location) {
    if ( !super.activeAt(elevation, location) ) return false;

    const tile = this.tile;
    const pixelCache = tile.evPixelCache;

    // First, check if the point is within the non-transparent boundary of the tile.
    const thresholdBounds = pixelCache.getThresholdCanvasBoundingBox(CONFIG[MODULE_ID].alphaThreshold);
    if ( !thresholdBounds.contains(location.x, location.y) ) return false;

    // Second, check if the point is not transparent (based on inner transparency threshold).
    const alphaThreshold = tile.document.getFlag(MODULE_ID, FLAGS.ALPHA_THRESHOLD);
    if ( !alphaThreshold ) return true;
    if ( alphaThreshold === 1 ) return false;
    return this.tile.mesh.getPixelAlpha(location.x, location.y) < alphaThreshold;
  }

  /**
   * Determine what percentage of a PIXI object is covered by this terrain tile.
   * @inherits
   */
  percentCoverage(shape, elevation = 0, { skip, localOffsets, testElevation = true } = {}) {
    if ( testElevation && !super.activeAt(elevation, shape.center) ) return 0;

    const shapeArea = shape.area;
    if ( shapeArea <= 0 ) return 0;

    const tile = this.tile;
    const trimmedShape = tile.bounds.intersectPolygon(shape.toPolygon());
    const trimmedArea = trimmedShape.area;
    if ( trimmedArea <= 0 ) return 0;

    const alphaThreshold = tile.document.getFlag(MODULE_ID, FLAGS.ALPHA_THRESHOLD);
    if ( !alphaThreshold ) return trimmedArea / shapeArea || 0;
    if ( alphaThreshold === 1 ) return 0;

    const reducerFn = TerrainPixelCache.pixelAggregator("average_gt_threshold", alphaThreshold);
    const percent = tile.evPixelCache._aggregation(trimmedShape, reducerFn, skip, localOffsets);
    return (trimmedArea / shapeArea) * percent;
  }
}

/**
 * Represent a measured template linked to a terrain.
 */
export class TerrainMeasuredTemplate extends TerrainLevel {
  /** @type {MeasuredTemplate} */
  template;

  constructor(terrain, template) {
    if ( template && !(template instanceof MeasuredTemplate) ) console.error("TerrainMeasuredTemplate requires a MeasuredTemplate object.", template);
    super(terrain, template);
    this.template = template;
  }

  /**
   * Unique id for this type of level and terrain. Used to distinguish between copies.
   * @type {string}
   */
  get id() { return `${this.terrain.id}_template_${this.level.id}`; } // Level equals template here.

  /**
   * Returns the tile elevation.
   * @returns {number} Elevation, in grid units.
   */
  _layerElevation() { return this.template.elevationE || 0; }

  /**
   * Determine if the terrain is active at the provided elevation.
   * @param {number} elevation    Elevation to test
   * @param {Point}  location    Location on the map. Required.
   * @returns {boolean}
   */
  activeAt(elevation, location) {
    if ( !super.activeAt(elevation, location) ) return false;

    // First, check if within the bounds of the template.
    const template = this.template;
    if ( !template.bounds.contains(location.x, location.y) ) return false;

    // Second, check if contained within the template shape.
    // Shape centered at origin 0, 0.
    const shape = template.shape.translate(template.x, template.y);
    return shape.contains(location.x, location.y);
  }

  /**
   * Determine what percentage of a PIXI object is covered by this terrain tile.
   * @inherits
   */
  percentCoverage(shape, elevation = 0, { testElevation = true } = {}) {
    if ( testElevation && !super.activeAt(elevation, shape.center) ) return 0;

    const shapeArea = shape.area;
    if ( shapeArea <= 0 ) return 0;

    const template = this.template;
    const trimmedShape = template.bounds.intersectPolygon(shape.toPolygon());
    const trimmedArea = trimmedShape.area;
    if ( trimmedArea <= 0 ) return 0;

    return trimmedArea / shapeArea;
  }
}
