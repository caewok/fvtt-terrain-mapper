/* globals
*/
"use strict";

export const MODULE_ID = "terrainmapper";

export const SOCKETS = { socket: null };

export const TEMPLATES = {
  TILE: `modules/${MODULE_ID}/templates/tile-config.html`
}

export const LABELS = {
  ANCHOR_OPTIONS: {
    absolute: "terrainmapper.settings.terrain.anchorOptions.absolute",
    relativeToTerrain: "terrainmapper.settings.terrain.anchorOptions.relativeToTerrain",
    relativeToLayer: "terrainmapper.settings.terrain.anchorOptions.relativeToLayer"
  },

  ANCHOR_ABBR_OPTIONS: {
    absolute: "terrainmapper.settings.terrain.anchorAbbrOptions.absolute",
    relativeToTerrain: "terrainmapper.settings.terrain.anchorAbbrOptions.relativeToTerrain",
    relativeToLayer: "terrainmapper.settings.terrain.anchorAbbrOptions.relativeToLayer"
  }
};

export const FLAGS = {
  ANCHOR: {
    VALUE: "anchor",
    CHOICES: {
      ABSOLUTE: 0,
      RELATIVE_TO_TERRAIN: 1,
      RELATIVE_TO_LAYER: 2
    }
  },

  OFFSET: "offset",
  RANGE_BELOW: "rangeBelow",
  RANGE_ABOVE: "rangeAbove",
  USER_VISIBLE: "userVisible",
  COLOR: "color",

  LAYER_ELEVATIONS: "layerElevations", // Stored per scene.

  ATTACHED_TERRAIN: "attachedTerrain", // Stored in Tile and MeasuredTemplate documents
  ALPHA_THRESHOLD: "alphaThreshold" // Stored in Tile documents
};



// https://www.canva.com/colors/color-wheel/
// Pick triadic colors, then get analogous to the first and locate other two triadic, ...
export const COLORS = [
  0x2C99D3, // Bluish
  0xD32C99, // Magenta (triad 2)
  0x99D32C, // Lime green (triad 3)

  0x2C45D3, // <-- Analogous to [0]: 0x2C99D3 in one direction
  0xD32C45, // Triad 2
  0x45D32C, // Triad 3

  0x2CD3BA, // <-- Analogous to [0]: 0x2C99D3 in other direction
  0xBA2CD3,
  0xD3BA2C,

  0x662CD3,
  0xD3662C,
  0x2CD366,

  0x2CD367,
  0x672CD3,
  0xD3672C,

  0xB92CD3,
  0xD3B92C,
  0x2CD3B9,

  0x44D32C,
  0x2C44D3,
  0xD32C44,

  0xD32C9A,
  0x9AD32C,
  0x2C9AD3,

  0x98D32C,
  0x2C98D3,
  0xD32C98,

  0xD32C47,
  0x47D32C,
  0x2C47D3,

  0xD3BA2C,
  0x2CD3BA,
  0xBA2CD3
];
