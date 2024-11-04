/* globals
canvas,
foundry,
Hooks,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

import { MODULE_ID, FLAGS } from "../const.js";
import { RegionElevationHandler } from "./RegionElevationHandler.js";

export const PATCHES = {};
PATCHES.REGIONS = {};

/* Modify Region#segmentizeMovement to handle elevation options.

1. Plateau
--> Move token from any elevation w/in region to defined elevation.
- If token enters the region, redo waypoints.
- If token exits the region, redo waypoints if reset is true.


2. Ramp / Steps
--> In a user-defined direction, the region increases elevation from a defined min to a defined max.
--> Any token moving in the region has elevation adjusted accordingly
--> User can define the step size

2. Stairs
--> Define halfway point between two elevations. Tokens below halfway point go up to set upper elevation.
    Tokens above halfway point go down to set lower elevation.

Options:
• Teleport. Ignore other regions. Elevation movement is a teleport that will not trigger overlapping regions.
  Acts as exit for other regions at start, followed by enter for other regions at end.
• Ignore Other Elevations. Ignore tokens not at top/bottom elevation points when entering.

Ignores tokens within the region already that may be at a different elevation.
For ramp, tokens not at the defined elevation are not moved to the next up/down step.

When exiting, moves back to the scene elevation

(No dialog option; use levels stairs/elevator for that region behavior.)


*/

// ----- NOTE: Hooks ----- //

/**
 * On init, add the terrain mapper refresh flag.
 */
Hooks.on("init", function() {
  CONFIG.Region.objectClass.RENDER_FLAGS.refreshTerrainMapperMesh = {};
  CONFIG.Region.objectClass.RENDER_FLAGS.refreshBorder.propagate ??= [];
  CONFIG.Region.objectClass.RENDER_FLAGS.refreshBorder.propagate.push("refreshTerrainMapperMesh");
});

/**
 * Hook updateRegion
 * If the region changes, clear the region cache and update the mesh.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateRegion(regionDoc, changed, _options, _userId) {
  // Refresh the hashing display for the region.
  const region = regionDoc.object;
  if ( !region ) return;
  if ( foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) ) region.renderFlags.set({ "refreshTerrainMapperMesh": true });

  // Clear the cache used to calculate ramp properties.
  if ( Object.hasOwn(changed, "shapes")
      || foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${FLAGS.REGION.RAMP.DIRECTION}`) ) region[MODULE_ID].clearCache();;

}

PATCHES.REGIONS.HOOKS = { updateRegion };



// ----- NOTE: Wraps ----- //

/**
 * Wrap Region#segmentizeMovement to handle plateau/ramp/stairs/elevator
 * @param {RegionMovementWaypoint[]} waypoints    The waypoints of movement.
 * @param {Point[]} samples                       The points relative to the waypoints that are tested.
 *                                                Whenever one of them is inside the region, the moved object
 *                                                is considered to be inside the region.
 * @param {object} [options]                      Additional options
 * @param {boolean} [options.freefall=false]      Should elevation changes follow the ramp/plateau when moving down?
 * @returns {RegionMovementSegment[]}             The movement split into its segments.
 */
function segmentizeMovement(wrapper, waypoints, samples, opts) {
  const segments = wrapper(waypoints, samples, opts);
  if ( !segments.length ) return segments;

  // Modify segments if moving through plateau or ramp regions.
  return this[MODULE_ID]._modifySegments(segments);
}

/**
 * Wrap Region#_draw
 * Modify hatch direction to match setElevation.
 */
async function _draw(wrapped, options) {
  wrapped(options);
  const mesh = this.children.find(c => c instanceof foundry.canvas.regions.RegionMesh);
  if ( !mesh ) return;

  // Must be defined for all region meshes.
  mesh.shader.uniforms.hatchThickness = canvas.dimensions.size / 10;
  this._refreshTerrainMapperMesh();
}

/**
 * Calculate the hatch X and Y based on the direction of the ramp.'
 * Stripe represents where elevation is equal across the shape.
 * @param {number} direction  Direction, in degrees, between 0º and 359º
 * @returns {object}
 * - @prop {number} hatchX
 * - @prop {number} hatchY
 */
function calculateHatchXY(direction) {
  // hatchX = 1, hatchY = 0: vertical stripes.
  // hatchX = 0, hatchY = 1: horizontal stripes.
  // hatchX === hatchY: 45º stripes, running SW to NE
  // hatchX = -1, hatchY = 1: 45º stripes, running NW to SE
  // hatchX = .3, hatchY = .7: ~ 30º, SW to NE
  // hatchX = .7, hatchY = .3: ~ 60º, SW to NE
  // Going larger than 1 shrinks the stripe width
  // 0º direction should be due south, so horizontal stripes.
  // 0º: hatchX = 0, hatchY = 1  // Due south; horizontal stripes
  //
  // 45º: hatchX = -.5, hatchY = .5
  //
  // 90º: hatchX = -1, hatchY = 0 // Due west; vertical stripes
  // 45º: hatchX = .5, hatchY = .5

  if ( direction <= 90 ) {
    const t0 = direction / 90;
    return { hatchX: -t0, hatchY: 1 - t0 };
  } else if ( direction <= 180 ) {
    const t0 = (direction - 90) / 90;
    return { hatchX: 1 - t0, hatchY: t0 };
  } else if ( direction <= 270 ) {
    const t0 = (direction - 180) / 90;
    return { hatchX: t0, hatchY: t0 - 1 };
  } else if ( direction <= 360 ) {
    const t0 = (direction - 270) / 90;
    return { hatchX: t0 - 1, hatchY: -t0 };
  }

  /* Test with
  0, 30, 45, 60, 90,
   120, 135, 150, 180
   210, 225, 240, 270
   300, 315, 330, 360

  res = calculateHatchXY(0)
  mesh.shader.uniforms.hatchX = res.hatchX;
  mesh.shader.uniforms.hatchY = res.hatchY;
  */

}

/**
 * Wrap Region._applyRenderFlags
 * Apply the terrain mapper mesh modifications.
 */
function _applyRenderFlags(wrapper, flags) {
  wrapper(flags);
  if ( flags.refreshTerrainMapperMesh ) this._refreshTerrainMapperMesh();
}


PATCHES.REGIONS.WRAPS = { segmentizeMovement, _draw, _applyRenderFlags};


// ----- NOTE: Methods ----- //

/**
 * Region._refreshTerrainMapperMesh
 * Update the mesh uniforms depending on region elevation settings.
 */
function _refreshTerrainMapperMesh() {
  const mesh = this.children.find(c => c instanceof foundry.canvas.regions.RegionMesh);
  if ( !mesh ) return;

  let hatchThickness = canvas.dimensions.size / 10;
  mesh.shader.uniforms.hatchThickness = hatchThickness; // Must be defined for all region meshes.

  // Only change the mesh for plateaus and ramps.
  if ( !this[MODULE_ID].isElevated ) return;

  // insetPercentage: Rectangular edge portion. 0.5 covers the entire space (inset from region border on each side).
  // hatchX, hatchY: Controls direction of the hatching except for the inset border.
  // insetBorderThickness: Separate control over the inset border hatching.

  let hatchX = 1;
  let hatchY = 1;
  let insetPercentage = 0;
  let insetBorderThickness = hatchThickness;
  let variableHatchThickness = false;
  if ( this[MODULE_ID].isPlateau ) {
    // Set a striped inset border.
    // Inside the border is solid.
    insetPercentage = 0.1;
    hatchThickness = 0;
  } else if ( this[MODULE_ID].isRamp ) {
    // Stripe across with no inset.
    // Direction controls stripes, which get wider as the ramp increases.
    insetPercentage = 0.0;
    const res = calculateHatchXY(this[MODULE_ID].rampDirection);
    hatchX = res.hatchX;
    hatchY = res.hatchY;
    variableHatchThickness = true;
    hatchThickness *= 2;
  }
  const { left, top, right, bottom } = this.bounds;
  mesh.shader.uniforms.border = [left, top, right, bottom];
  mesh.shader.uniforms.hatchX = hatchX;
  mesh.shader.uniforms.hatchY = hatchY;
  mesh.shader.uniforms.hatchThickness = hatchThickness;
  mesh.shader.uniforms.insetPercentage = insetPercentage;
  mesh.shader.uniforms.insetBorderThickness = insetBorderThickness
  mesh.shader.uniforms.variableHatchThickness = variableHatchThickness;
}

PATCHES.REGIONS.METHODS = { _refreshTerrainMapperMesh };

// ----- NOTE: Getters ----- //

/**
 * New getter: Region.terrainmapper
 * Class that handles elevation settings and calcs for a region.
 * @type {RegionElevationHandler}
 */
function terrainmapper() { return (this._terrainmapper ??= new RegionElevationHandler(this)); }

PATCHES.REGIONS.GETTERS = { terrainmapper };
