/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { gridUnitsToPixels } from "../geometry/util.js";

/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

export const PATCHES = {};
PATCHES.REGIONS = {};

/**
 * Wrap ClockwiseSweepPolygon#_determineEdgeTypes
 * Include region edge types
 *
 * Determine the edge types and their manner of inclusion for this polygon instance.
 * @returns {Record<EdgeTypes, 0|1|2>}
 */
function _determineEdgeTypes(wrapper) {
  const edgeTypes = wrapper();
  edgeTypes.region = { mode: 1, priority: -Infinity }; // 0 is never include, 1 is test, 2 is always include.
  return edgeTypes;
}

/**
 * Wrap ClockwiseSweepPolygon#_testEdgeInclusion
 * Exclude region edges that are not within the requisite elevation.
 *
 * @param {Edge} edge                     The Edge being considered
 * @param {Record<EdgeTypes, 0|1|2>} edgeTypes Which types of edges are being used? 0=no, 1=maybe, 2=always
 * @param {PIXI.Rectangle} bounds         The overall bounding box
 * @returns {boolean}                     Should the edge be included?
 */
function _testEdgeInclusion(wrapper, edge, edgeTypes, bounds) {
  if ( !wrapper(edge, edgeTypes, bounds) ) return false;
  if ( !edgeTypes.region ) return true;
  if ( !edge.type === "region" ) return true;

  // If the region edge has infinite top/bottom heights then it must count.
  const elev = edge.elevationLibGeometry;
  if ( elev.a.top == null && elev.a.bottom == null && elev.b.top == null && elev.b.bottom == null ) return true;

  // Take the lowest point of the edge top; highest of edge bottom (only relevant when region is a ramp or step).
  const edgeTopZ = gridUnitsToPixels(Math.min(
    elev.a.top ?? Number.POSITIVE_INFINITY,
    elev.b.top ?? Number.POSITIVE_INFINITY
  ));
  const edgeBottomZ = gridUnitsToPixels(Math.max(
    elev.a.bottom ?? Number.NEGATIVE_INFINITY,
    elev.b.bottom ?? Number.NEGATIVE_INFINITY
  ));

  const { source, type } = this.config;
  const placeable = source.object;
  if ( !placeable ) return true;

  switch ( type ) {
    case "light":
    case "sound": {
      // If the source center is above the edge top or below the edge bottom, it goes past the edge.
      // NOTE: This does not account for light angle. Left to Elevation Shadows module.
      const elevationZ = placeable.elevationZ;
      if ( elevationZ >= edgeTopZ || elevationZ < edgeBottomZ ) return false;
      break;
    }
    case "move":
    case "sight": {
      // If the token bottom is at or above the edge top, the token can see/move past the edge.
      const bottomZ = placeable.bottomZ;
      if ( bottomZ >= edgeTopZ ) return false;

      // If the token top is below the edge bottom, the token can see/move past the edge.
      const topZ = type === "sight" ? placeable.visionZ : placeable.topZ;
      if ( topZ < edgeBottomZ ) return false;

      // TODO: Test for Wall Height vaulting.
    }
  }

  // TODO: Is testing the source necessary?
  // e.g., source instanceof foundry.canvas.sources.PointMovementSource
  return true;
}


PATCHES.REGIONS.WRAPS = { _determineEdgeTypes, _testEdgeInclusion };
