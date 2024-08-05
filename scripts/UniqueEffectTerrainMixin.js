/* globals
canvas,
CONFIG,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ICONS, MODULE_ID } from "./const.js";
import { ElevationHandler } from "./ElevationHandler.js";

/**
 * A mixin which extends the UniqueEffect with specialized terrain behaviors
 * @category - Mixins
 * @param {AbstractUniqueEffect} Base         The base class mixed with terrain features
 * @returns {Terrain}                         The mixed Terrain class definition
 */
export function TerrainMixin(Base) {
  return class Terrain extends Base {
    /**
     * Alias
     * Test if a token has this terrain already.
     * @param {Token} token
     * @returns {boolean}
     */
    tokenHasTerrain(token) { return this.isOnToken(token); }

    /** @type {string} */
    static type = "Terrain";

    /** @type {object} */
    static get _storageMapData() {
      return {
        name: "Terrains",
        img: ICONS.MODULE,
        type: "base",
      };
    }

    /**
     * Default data required to be present in the base effect document.
     * @param {string} [activeEffectId]   The id to use
     * @returns {object}
     */
    static newDocumentData(activeEffectId) {
      const data = Base.newDocumentData.call(this, activeEffectId);
      data.name = game.i18n.localize(`${MODULE_ID}.phrases.new-terrain`);
      data.img = "icons/svg/hazard.svg";
      return data;
    }

  /**
     * Calculate the percent of the token speed that would be used if the token were to travel
     * along segment start|end. The token speed is adjusted over this span by terrains.
     * Percentage is from the token's initial speed, which may have effects applied already.
     * The start/end elevations are not adjusted; it is assumed the token passes through the region
     * in this straight line. Adjustments due to region elevation, etc. should be handled elsewhere.
     * @param {RegionPathWaypoint} start      The starting point for the move, using grid elevation
     * @param {RegionPathWaypoint} end        The ending point for the move, using grid elevation
     * @param {Token} token                   Token doing the move
     * @param {function} speedFn              Function used to obtain the token seed
     *  - @param {Token} token                Token whose speed is desired
     *  - @returns {number} speed             Speed of the token
     * @returns {number} The percent of the token starting speed, or 0 if the token speed is 0 at any point.
     */
    static percentTokenSpeedAlongSegment(start, end, token, speedFn) {
      // Determine what regions are encountered.
      const regions = canvas.regions.placeables.filter(region => region.terrainmapper.hasTerrain);
      if ( !regions.length ) return 1;
      const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;

      // Locally clone the token and actor, so terrains can be added/removed from the clone.
      const tClone = localTokenClone(token);

      // Get the cutaway(s) for each intersected region.
      const polys = [];
      regions.forEach(region => {
        const cutaway = region[MODULE_ID]._cutaway(start, end);
        if ( !cutaway ) return;
        const regionPolys = cutaway.toPolygons();
        regionPolys.forEach(poly => poly.region = region);
        polys.push(...regionPolys);
      });

      // Convert the y scale to pixel units so percent distance can be determined.
      polys => polys.forEach(poly => {
        const pts = poly.points;
        for ( let i = 1, n = pts.length; i < n; i += 2 ) pts[i] = gridUnitsToPixels(pts[i]);
      });

      // Determine intersections for each, accounting for holes.
      // Mark what terrains are added and removed at each intersection point.
      const polyIxs = [];
      const start2d = ElevationHandler._to2dCutawayCoordinate(start, start, end);
      const end2d = ElevationHandler._to2dCutawayCoordinate(end, start, end);
      start2d.y = gridUnitsToPixels(start2d.y);
      end2d.y = gridUnitsToPixels(end2d.y);
      polys.forEach(poly => {
        const { terrains, secretTerrains } = poly.region.terrainmapper.terrains;
        const allTerrains = terrains.union(secretTerrains);
        if ( !allTerrains.size ) return;
        const ixs = poly.segmentIntersections(start2d, end2d);
        ixs.sort((a, b) => a.t0 - b.t0);
        let isInside = poly.contains(start2d.x, start2d.y) ^ !poly.isPositive; // isPositive means not a hole.
        if ( !ixs.length ) {
          if ( isInside ) polyIxs.push({ ...start2d, region: poly.region}, { ...end2d, region: poly.region });
          return;
        }
        for ( const ix of ixs ) {
          const isMovingIntoRegion = isInside ^ poly.isPositive;
          if ( isMovingIntoRegion ) ix.addTerrains = new Set([...allTerrains]);
          else ix.removeTerrains = new Set([...allTerrains]);
          polyIxs.push(ix);
          isInside = !isInside;
        }
      });
      polyIxs.sort((a, b) => a.t0 - b.t0);

      // Traverse each intersection, calculating distance and speed.
      // Calculate the total time:  x m / y m/s = x/y s
      let totalDistance = 0;
      let totalTime = 0;
      let prevIx = start2d.almostEqual(polyIxs[0]) ? polyIxs.shift() : start2d;
      if ( prevIx.addTerrains ) Terrain.addToTokenLocally(tClone, [...prevIx.addTerrains], { refresh: false });
      if ( prevIx.removeTerrains ) Terrain.removeFromTokenLocally(tClone, [...prevIx.removeTerrains], { refresh: false });
      tClone.actor._initialize();
      const startingSpeed = speedFn(tClone);
      const Terrain = CONFIG[MODULE_ID].Terrain
      if ( !end2d.almostEqual(polyIxs.at(-1)) ) polyIxs.push(end2d);
      for ( const ix of polyIxs ) {
        const dist = PIXI.Point.distanceBetween(prevIx, ix);
        totalDistance += dist;
        const speed = speedFn(tClone);
        totalTime += dist / speed;

        // For debugging
        ix._dist = dist;
        ix._speed = speed;

        if ( ix.addTerrains ) Terrain.addToTokenLocally(tClone, [...ix.addTerrains], { refresh: false });
        if ( ix.removeTerrains ) Terrain.removeFromTokenLocally(tClone, [...ix.removeTerrains], { refresh: false });
        tClone.actor._initialize();
        prevIx = ix;
      }

      if ( CONFIG[MODULE_ID].debug ) {
        console.groupCollapsed(`${MODULE_ID}|percentTokenSpeedAlongSegment`);
        console.table(polyIxs.map(ix => {
          const addTerrains = ix.addTerrains ? [...ix.addTerrains].map(t => t.name).join(", ") : "";
          const removeTerrains = ix.removeTerrains ? [...ix.removeTerrains].map(t => t.name).join(", ") : "";
          const A = { x: ix.x, y: ix.y, addTerrains, removeTerrains, dist: ix._dist, speed: ix._speed };
          return A;
        }));
        console.groupEnd(`${MODULE_ID}|percentTokenSpeedAlongSegment`);
      }

      // Determine the ratio compared to a set speed
      const totalDefaultTime = totalDistance / startingSpeed;
      return (totalDefaultTime / totalTime) || 0; // Catch NaN or undefined.
    }
  };
}


// ----- Helper functions ----- //

/**
 *

/**
 * Local clone of a token.
 * Currently clones the actor and the token document but makes no effort to clone the other token properties.
 * @param {Token} token
 * @returns {object}
 *   - @prop {TokenDocument} document
 *   - @prop {Actor} actor
 */
function localTokenClone(token) {
  const actor = new CONFIG.Actor.documentClass(token.actor.toObject())
  const document = new CONFIG.Token.documentClass(token.document.toObject())
  return { document, actor };
}

