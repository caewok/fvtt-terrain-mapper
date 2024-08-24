/* globals
canvas,
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "./geometry/3d/Point3d.js";

/**
 * A 3d point that can function as a Point3d|RegionMovementWaypoint.
 * Does not handle GridOffset3d so that it can be passed to 2d Foundry functions that
 * treat objects with {i,j} parameters differently.
 */
export class RegionMovementWaypoint3d extends Point3d {
  /** @type {number<grid units>} */
  get elevation() { return CONFIG.GeometryLib.utils.pixelsToGridUnits(this.z); }

  /** @type {number<grid units>} */
  set elevation(value) { this.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(value); }

  /**
   * Factory function to convert a generic point object to a RegionMovementWaypoint3d.
   * @param {Point|PIXI.Point|GridOffset|RegionMovementWaypoint|GridOffset3d|GridCoordinates3d} pt
   *   i, j, k assumed to refer to the center of the grid
   * @returns {RegionMovementWaypoint3d}
   */
  static fromPoint(pt) {
    // Priority: x,y,z | elevation | i, j, k
    let x;
    let y;
    if ( Object.hasOwn(pt, "x") ) {
      x = pt.x;
      y = pt.y;
    } else if ( Object.hasOwn(pt, "i") ) {
      const res = canvas.grid.getCenterPoint(pt);
      x = res.x;
      y = res.y;
    }

    // Process elevation.
    const newPt = new this(x, y);
    if ( Object.hasOwn(pt, "z") ) newPt.z = pt.z;
    else if ( Object.hasOwn(pt, "elevation") ) newPt.elevation = pt.elevation;
    else if ( Object.hasOwn(pt, "k") ) newPt.elevation = elevationForUnit(pt.k);
    return newPt;
  }

  /**
   * Given a token, modify this point to match the center point of the token for that position.
   * @param {Token} token
   * @param {RegionMovementWaypoint3d} outPoint
   * @returns {RegionMovementWaypoint3d} The outPoint
   */
  centerPointToToken(token, outPoint) {
    outPoint ??= new this.constructor();
    const center = token.getCenterPoint(this);
    outPoint.set(center.x, center.y, this.z);
    return outPoint;
  }

  /**
   * Modify this point to center it in elevation units.
   * @param {RegionMovementWaypoint3d} outPoint
   * @returns {RegionMovementWaypoint3d} The outPoint
   */
  centerElevation(outPoint) {
    outPoint ??= new this.constructor();
    outPoint.copyFrom(this);
    outPoint.elevation = elevationForUnit(unitElevation(this.elevation));
    return outPoint;
  }
}

/**
 * Calculate the unit elevation for a given set of coordinates.
 * @param {number} elevation    Elevation in grid units
 * @returns {number} Elevation in number of grid steps.
 */
function unitElevation(elevation) { return Math.round(elevation / canvas.scene.dimensions.distance); }


/**
 * Calculate the grid unit elevation from unit elevation.
 * Inverse of `unitElevation`.
 * @param {number} k            Unit elevation
 * @returns {number} Elevation in grid units
 */
function elevationForUnit(k) { return k * canvas.scene.dimensions.distance; }