/* globals
canvas,
CONFIG,
foundry,
game,
PIXI,
PlaceablesLayer,
RegionDocument,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { log } from "../util.js";
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { SCENE_GRAPH } from "../WallTracer.js";

export const PATCHES = {};
PATCHES.REGIONS = {};


// ----- NOTE: Fill-by-Grid control ----- //

let fillByGridTracker;

/**
 * Wrap RegionLayer#_onClickLeft.
 * Create a region at that point.
 * @param {PIXI.InteractionEvent} event
 */
function _onClickLeft(wrapper, event) {
  if ( game.activeTool === "fill-by-los" || game.activeTool === "fill-by-walls" ) {
    const origin = event.interactionData.origin;
    let paths;
    if ( game.activeTool === "fill-by-los" ) {
      const type = "move";
      paths = CONFIG.Canvas.polygonBackends[type].create(origin, { type });
    } else { // fill-by-walls
      const polys = SCENE_GRAPH.encompassingPolygonWithHoles(origin);
      if ( !polys.length ) {
        ui.notifications.warn(`Sorry; cannot locate a closed boundary for the requested fill at { x: ${origin.x}, y: ${origin.y} }!`);
        return wrapper(event);
      }
      paths = ClipperPaths.fromPolygons(polys);
    }
    const elev = this.legend.elevation;
    const shapeData = createRegionShapeData(paths, { bottomE: elev.bottom, topE: elev.top, isHole: this._holeMode });
    const drawingRegion = this.controlled.at(0);
    const drawingColor = drawingRegion?.document.color;
    addShapesToRegion(shapeData, drawingRegion, drawingColor);
  }

  // Handle fill-by-grid later
  else if ( game.activeTool === "fill-by-grid" ) {
    // From RegionLayer#_canDragLeftStart
    if ( !PlaceablesLayer.prototype._canDragLeftStart.call(this, game.user, event)
      || this.controlled.length > 1
      || this.controlled.at(0)?.document.locked ) return wrapper();

    // Set a callback to draw the grid shape if drag is not initiated.
    const handleMouseUp = handleMouseUpFillByGrid.bind(this);
    canvas.stage.once("mouseup", handleMouseUp);
  }

  wrapper(event);
}

/**
 * Callback to handle mouseup event after a click left on the canvas.
 */
function handleMouseUpFillByGrid(event) {
  if ( event.interactionData[MODULE_ID]?.dragging ) return;
  const gridCoords = canvas.grid.getOffset(event.interactionData.origin);
  const pts = canvas.grid.getVertices(gridCoords);
  const poly = new PIXI.Polygon(pts);
  const elev = this.legend.elevation;
  const shapeData = createRegionShapeData(poly, { bottomE: elev.bottom, topE: elev.top, isHole: this._holeMode });
  const drawingRegion = this.controlled.at(0);
  const drawingColor = drawingRegion?.document.color;
  addShapesToRegion(shapeData, drawingRegion, drawingColor);
}

/**
 * Wrap RegionLayer#_canDragLeftStart
 * Allow drag for other shape tools.
 * @param {User} user
 * @param {PIXI.InteractionEvent} event
 * @returns {boolean}
 */
function _canDragLeftStart(wrapper, user, event) {
  if ( wrapper(user, event) ) return true;
  if ( !["fill-by-grid"].includes(game.activeTool) ) return false;

  log("RegionLayer#_canDragLeftStart");
  // Redo the wrapped tests.
  if ( !PlaceablesLayer.prototype._canDragLeftStart.call(this, user, event) ) return false;
  if ( this.controlled.length > 1 ) {
    ui.notifications.error("REGION.NOTIFICATIONS.DrawingMultipleRegionsControlled", {localize: true});
    return false;
  }
  if ( this.controlled.at(0)?.document.locked ) {
    ui.notifications.warn(game.i18n.format("CONTROLS.ObjectIsLocked", {type: RegionDocument.documentName}));
    return false;
  }
  return true;
}

/**
 * Wrap RegionLayer#_onDragLeftStart.
 * Start tracking origin points.
 * @param {PIXI.InteractionEvent} event
 */
function _onDragLeftStart(wrapper, event) {
  wrapper(event);
  event.interactionData[MODULE_ID] ??= {}
  event.interactionData[MODULE_ID].dragging = true;

  const interaction = event.interactionData;
  if ( interaction.drawingTool !== "fill-by-grid" ) return;

  log("RegionLayer#_onDragLeftStart");
  fillByGridTracker = new TrackAndDrawGridSpaces(interaction.drawingColor);
  fillByGridTracker.addPosition(interaction.origin);
}

/**
 * Wrap RegionLayer#_onDragLeftMove.
 * Add grid shapes
 * @param {PIXI.InteractionEvent} event
 */
function _onDragLeftMove(wrapper, event) {
  wrapper(event);
  const interaction = event.interactionData;
  if ( interaction.drawingTool !== "fill-by-grid" ) return;

  log("RegionLayer#_onDragLeftMove");
  fillByGridTracker.addPosition(interaction.destination);
}

/**
 * Wrap RegionLayer#_onDragLeftDrop.
 * Start tracking origin points.
 * @param {PIXI.InteractionEvent} event
 */
function _onDragLeftDrop(wrapper, event) {
  wrapper(event);
  const interaction = event.interactionData;
  if ( interaction.drawingTool !== "fill-by-grid" ) return;
  log("RegionLayer#_onDragLeftDrop");

  // Build the full shape.
  const paths = fillByGridTracker.constructShape();
  const elev = this.legend.elevation;
  const shapeData = createRegionShapeData(paths, { bottomE: elev.bottom, topE: elev.top, isHole: this._holeMode });
  addShapesToRegion(shapeData, interaction.drawingRegion, interaction.drawingColor)
}

/**
 * Wrap RegionLayer#_onDragLeftCancel.
 * Start tracking origin points.
 * @param {PIXI.InteractionEvent} event
 */
function _onDragLeftCancel(wrapper, event) {
  wrapper(event);
  const interaction = event.interactionData;
  if ( interaction.drawingTool !== "fill-by-grid" ) return;

  log("RegionLayer#_onDragLeftDrop");
  fillByGridTracker.destroy();
  wrapper(event);
}

PATCHES.REGIONS.WRAPS = {
  _canDragLeftStart,
  _onClickLeft,
  _onDragLeftStart,
  _onDragLeftMove,
  _onDragLeftDrop,
  _onDragLeftCancel
};

// ----- NOTE: Helper functions ----- //

/**
 * Class to track and temporarily draw grid spaces.
 */
class TrackAndDrawGridSpaces {
  /**
   * Track keys corresponding to grid offsets.
   * @type {Set<number>}
   */
  gridKeys = new Set();

  /** @type {Color} */
  color;

  /** @type {PIXI.Graphics} */
  #preview = new PIXI.Graphics();

  /** @type {Draw} */
  draw;

  /** @type {PIXI.Polygon} */
  gridShape;

  /**
   * @param {Color} color
   */
  constructor(color) {
    this.color = color;
    this.draw = new Draw(this.#preview);
    canvas.regions.addChild(this.#preview);
  }

  /**
   * Add a position on the canvas, deduplicating along the way.
   * Adds the position and draws the shape.
   * @param {GridCoordinate} position
   */
  addPosition(position) {
    if ( !this._addPosition(position) ) return;
    this._drawShape(position);
  }

  /**
   * Add a position on the canvas.
   * @param {GridCoordinate} position
   * @returns {boolean} True if this is a new grid offset.
   */
  _addPosition(position) {
    const gridCoords = canvas.grid.getOffset(position);
    const key = PIXI.Point._tmp.copyFrom({ x: gridCoords.i, y: gridCoords.j}).key;
    if ( this.gridKeys.has(key) ) return false;
    this.gridKeys.add(key);
    return true;
  }

  /**
   * Draw a shape at the given grid coordinates.
   * @param {GridCoordinate} position
   * @param {object} config             Options to pass to the draw tool
   */
  _drawShape(position, config = {}) {
    config.fill ??= this.color;
    config.fillAlpha ??= 0.5;
    config.width ??= 0;
    const pts = canvas.grid.getVertices(position);
    this.draw.shape(new PIXI.Polygon(pts), config);
  }

  /**
   * Construct a shape that combines the grid shapes.
   * @returns {ClipperPaths}
   */
  constructShape() {
    const polygons = [...this.gridKeys].map(key => {
      const { x, y } = PIXI.Point._invertKey(key);
      const offset = { i: x, j: y };
      const pts = canvas.grid.getVertices(offset);
      return new PIXI.Polygon(pts);
    });
    const paths = ClipperPaths.fromPolygons(polygons);
    return paths.union().clean();
  }

  /**
   * Destroy this object.
   */
  destroy() {
    canvas.regions.removeChild(this.#preview);
    this.#preview.destroy();
    this.gridKeys.clear();
  }
}

/**
 * Add the shape(s) to a region or construct a new one.
 * @param {Object} shapeData            Result of createRegionShapeData
 * @param {Region} [region]             Drawing region to use
 * @param {Color} [color]               Color of the new region; required if region not provided
 */
function addShapesToRegion(shapeData, region, color) {
  if (!shapeData || !shapeData.length ) return;
  // See RegionLayer#_onDragLeftDrop.
  if ( region ) {
    if ( !region.document.locked ) region.document.update({shapes: [...region.document.shapes, ...shapeData]});
  } else RegionDocument.implementation.create({
    name: RegionDocument.implementation.defaultName({parent: canvas.scene}),
    color,
    shapes: shapeData
  }, {parent: canvas.scene, renderSheet: true}).then(r => r.object.control({releaseOthers: true}));
}

/**
 * Create region shape from ClipperPaths data.
 * @param {ClipperPaths|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse|PIXI.Rectangle} shape
 * @returns {object[]|[]}
 */
function createRegionShapeData(shape, opts) {
  if ( shape instanceof ClipperPaths ) {
    shape = shape.simplify();
    if ( shape instanceof ClipperPaths ) {
      const data = [];
      const polyOpts = foundry.utils.duplicate(opts);
      for ( const poly of shape.toPolygons() ) {
        polyOpts.isHole = poly.isHole ^ opts.isHole;
        const shapeData = createRegionPolygonData(poly, polyOpts);
        if ( shapeData ) data.push(shapeData);
      }
      return data;
    }
  }

  // Process individual shapes.
  let shapeData;
  if ( shape instanceof PIXI.Polygon ) shapeData = createRegionPolygonData(shape, opts);
  else if ( shape instanceof PIXI.Rectangle ) shapeData = createRegionRectangleData(shape, opts);
  else if ( shape instanceof PIXI.Circle ) shapeData = createRegionCircleData(shape, opts);
  else if ( shape instanceof PIXI.Ellipse ) shapeData = createRegionEllipseData(shape, opts);
  return shapeData ? [shapeData] : [];
}

/**
 * Create region shape data from a single polygon.
 * See RegionLayer##createPolygonData
 * @param {PIXI.Polygon} poly
 * @param {object} [opts]
 * @param {number;gridUnits} [opts.topE]    Top elevation for the shape
 * @param {number;gridUnits} [opts.bottomE] Bottom elevation for the shape
 * @param {boolean} [opts.isHole=false]     Whether this shape represents a hole
 * @returns {object|undefined}
 */
function createRegionPolygonData(poly, { topE, bottomE, isHole = false } = {}) {
  const points = poly.points;
  if ( points.length < 6 ) return;
  const data = {
    points,
    type: "polygon"
  };
  _addOptionalShapeData(data, topE, bottomE, isHole);
  return data;
}

/**
 * Create region shape data from a single rectangle.
 * @param {PIXI.Rectangle} rect
 * @param {object} [opts]
 * @param {number;gridUnits} [opts.topE]    Top elevation for the shape
 * @param {number;gridUnits} [opts.bottomE] Bottom elevation for the shape
 * @param {boolean} [opts.isHole=false]     Whether this shape represents a hole
 * @returns {object|undefined}
 */
function createRegionRectangleData(rect, { topE, bottomE, isHole = false } = {}) {
  const data = foundry.utils.duplicate(rect);
  data.type = "rectangle";
  data.rotation = 0;
  _addOptionalShapeData(data, topE, bottomE, isHole);
  return data;
}

/**
 * Create region shape data from a single circle.
 * @param {PIXI.Circle} circle
 * @param {object} [opts]
 * @param {number;gridUnits} [opts.topE]    Top elevation for the shape
 * @param {number;gridUnits} [opts.bottomE] Bottom elevation for the shape
 * @param {boolean} [opts.isHole=false]     Whether this shape represents a hole
 * @returns {object|undefined}
*/
function createRegionCircleData(circle, { topE, bottomE, isHole = false } = {}) {
  const data = foundry.utils.duplicate(circle);
  data.type = "circle";
  _addOptionalShapeData(data, topE, bottomE, isHole);
  return data;
}

/**
 * Create region shape data from a single ellipse.
 * @param {PIXI.Ellipse} ellipse
 * @param {object} [opts]
 * @param {number;gridUnits} [opts.topE]    Top elevation for the shape
 * @param {number;gridUnits} [opts.bottomE] Bottom elevation for the shape
 * @param {boolean} [opts.isHole=false]     Whether this shape represents a hole
 * @returns {object|undefined}
 */
function createRegionEllipseData(ellipse, { topE, bottomE, isHole = false } = {}) {
  const data = foundry.utils.duplicate(ellipse);
  data.type = "ellipse";
  data.radiusX = data.width;
  data.radiusY = data.height;
  delete data.width;
  delete data.height;
  data.rotation = 0;
  _addOptionalShapeData(data, topE, bottomE, isHole);
  return data;
}

/**
 * Add hole and elevation data.
 */
function _addOptionalShapeData(data, topE, bottomE, isHole = false) {
  if ( isHole ) data.hole = true;
  data.elevation = {
    bottom: Number.isFinite(bottomE) ? bottomE : null,
    top: Number.isFinite(topE) ? topE : null
  };
  return data;
}


