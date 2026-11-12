/* globals
CONFIG,
game,
PIXI,
RegionDocument,
canvas,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { findWallFill } from "./wall_rings.js";

export const PATCHES = {};
PATCHES.REGIONS = {};

const FILL_TOOLS = new Set(["fill-by-los", "fill-by-walls"]);

// ----- NOTE: Wraps ----- //

/**
 * Wrap RegionLayer#_onClickLeft.
 * - fill-by-walls, fill-by-los: click-only. Does not call core, so core's left-click-release cannot
 *   deselect the region the shape is being added to.
 * @param {PIXI.FederatedEvent} event
 */
function _onClickLeft(wrapper, event) {
  const tool = game.activeTool;
  if ( !(this.active && FILL_TOOLS.has(tool)) ) return wrapper(event);

  const { ok, region } = getFillTarget(this);
  if ( !ok ) return;

  const { x, y } = event.interactionData.origin; // Copy; never hand core's point to the graph.
  fillAtPoint(this, event, tool, { x, y }, region);
}


PATCHES.REGIONS.WRAPS = { _onClickLeft };

// ----- NOTE: Fill-by-walls and fill-by-LOS ----- //

/**
 * Same preconditions core applies when drawing: not paused, no preview open, at most one
 * targeted (controlled or sheet-open) unlocked region, and create permission if making a new one.
 * @param {RegionLayer} layer
 * @returns {{ok: boolean, region?: Region}}   region is undefined if a new one should be created
 */
function getFillTarget(layer) {
  const fail = { ok: false };
  if ( game.paused && !game.user.isGM ) {
    ui.notifications.warn("GAME.PausedWarning", { localize: true });
    return fail;
  }
  if ( layer.preview.children.length ) {
    ui.notifications.warn("CONTROLS.ObjectConfigured", { localize: true });
    return fail;
  }

  const type = game.i18n.localize(RegionDocument.metadata.label);
  const targets = layer.placeables.filter(r => r.controlled || r.sheet?.rendered);
  if ( targets.length > 1 ) {
    ui.notifications.warn("SHAPE.NOTIFICATIONS.DrawingMultipleObjectsControlled", { format: { type } });
    return fail;
  }
  const region = targets.at(0);
  if ( region?.document.locked ) {
    ui.notifications.warn("CONTROLS.ObjectIsLocked", { format: { type } });
    return fail;
  }
  if ( !region && !RegionDocument.implementation.canUserCreate(game.user) ) {
    ui.notifications.warn("PERMISSION.WarningNoCreate", { format: { document: RegionDocument.documentName } });
    return fail;
  }
  return { ok: true, region };
}

/**
 * Fill the area enclosed by walls, or the line-of-sight polygon, at a point.
 * @param {RegionLayer} layer
 * @param {PIXI.FederatedEvent} event
 * @param {string} tool           "fill-by-walls" or "fill-by-los"
 * @param {Point} origin
 * @param {Region} [region]       Region to add to; otherwise a new region is created
 */
function fillAtPoint(layer, event, tool, origin, region) {
  const isHole = ui.controls.tools?.hole?.active ?? false;
  let shapeData;

  if ( tool === "fill-by-los" ) {
    const type = "move";
    const shape = CONFIG.Canvas.polygonBackends[type].create(origin, { type });
    shapeData = createRegionShapeData(shape, { isHole });
  } else {
    const fill = findWallFill(origin);
    if ( !fill ) {
      ui.notifications.warn(`Sorry; cannot locate a boundary for the requested fill at { x: ${origin.x}, y: ${origin.y} }!`);
      return;
    }
    // Holes come after the outer ring so they subtract from it. Hole mode flips both.
    shapeData = [
      createRegionPolygonData(new PIXI.Polygon(fill.outer), isHole),
      ...fill.holes.map(pts => createRegionPolygonData(new PIXI.Polygon(pts), !isHole))
    ].filter(Boolean);
  }

  if ( !shapeData.length ) {
    ui.notifications.warn("Sorry; the requested fill produced no shape.");
    return;
  }
  addShapesToRegion(layer, event, shapeData, region);
}

// ----- NOTE: Helper functions ----- //

/**
 * Add the shape(s) to a region or create a new one.
 * New regions start from the same data core uses for a drag-created region: palette defaults
 * (levels, elevation, color, etc.) plus a default name.
 * @param {RegionLayer} layer
 * @param {PIXI.FederatedEvent} event
 * @param {object[]} shapeData      Result of createRegionShapeData
 * @param {Region} [region]
 * @returns {Promise<RegionDocument|undefined>}
 */
async function addShapesToRegion(layer, event, shapeData, region) {
  if ( !shapeData?.length ) return;
  if ( region ) {
    const shapes = [...region.document.toObject().shapes, ...shapeData];
    return region.document.update({ shapes });
  }

  const data = layer._createDragPreviewData(event);
  data.shapes = shapeData;
  if ( data.color == null ) delete data.color; // Null palette color means random; let the schema pick.
  return RegionDocument.implementation.create(data,
    { parent: canvas.scene, renderSheet: true, controlObject: true });
}

/**
 * Create region shape data from ClipperPaths, a polygon, or a PIXI primitive.
 * @param {ClipperPaths|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse|PIXI.Rectangle} shape
 * @param {object} [opts]
 * @param {boolean} [opts.isHole=false]
 * @returns {object[]}
 */
function createRegionShapeData(shape, { isHole = false } = {}) {
  if ( !shape ) return [];

  let shapeData;
  if ( shape instanceof PIXI.Polygon ) shapeData = createRegionPolygonData(shape, isHole);
  else if ( shape instanceof PIXI.Rectangle ) {
    shapeData = { type: "rectangle", x: shape.x, y: shape.y, width: shape.width, height: shape.height, rotation: 0 };
  } else if ( shape instanceof PIXI.Circle ) {
    shapeData = { type: "circle", x: shape.x, y: shape.y, radius: shape.radius };
  } else if ( shape instanceof PIXI.Ellipse ) {
    shapeData = {
      type: "ellipse",
      x: shape.x,
      y: shape.y,
      radiusX: shape.halfWidth ?? shape.width,
      radiusY: shape.halfHeight ?? shape.height,
      rotation: 0
    };
  }
  if ( !shapeData ) return [];
  if ( isHole ) shapeData.hole = true;
  return [shapeData];
}

/**
 * Create region shape data from a single polygon.
 * @param {PIXI.Polygon} poly
 * @param {boolean} [isHole=false]
 * @returns {object|undefined}
 */
function createRegionPolygonData(poly, isHole = false) {
  const points = poly.points;
  if ( points.length < 6 ) return;
  const data = { type: "polygon", points: [...points] };
  if ( isHole ) data.hole = true;
  return data;
}