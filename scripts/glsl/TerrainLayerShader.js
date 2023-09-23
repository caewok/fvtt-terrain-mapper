/* global
canvas,
Color,
PIXI
*/
"use strict";

import { defineFunction } from "./GLSLFunctions.js";
import { AbstractTerrainShader } from "./AbstractTerrainShader.js";
import { Terrain } from "../Terrain.js";

const MAX_TERRAINS = 32; // Including 0 as no terrain.

/**
 * Shader to represent terrain values on the terrain layer canvas.
 */
export class TerrainLayerShader extends AbstractTerrainShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`
#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

uniform sampler2D uTerrainSampler; // Elevation Texture
uniform vec4[${MAX_TERRAINS}] uTerrainColors;

${defineFunction("hsb2rgb")}
${defineFunction("hsb2rgb")}
${defineFunction("decodeTerrainChannels")}

/**
 * Determine the color for a given terrain value.
 * Currently draws increasing shades of red with a gamma correction to avoid extremely light alpha.
 */
vec4 colorForTerrain(int terrainId) {
  vec4 color = uTerrainColors[terrainId];

  // Gamma correct alpha and colors?
  color = pow(color, vec4(1. / 2.2));

  return color;
}

void main() {
  // Terrain is sized to the scene.
  vec4 terrainPixel = texture(uTerrainSampler, vTextureCoord);
  int terrainId = decodeTerrainChannels(terrainPixel);
  fragColor = colorForTerrain(terrainId);
}`;

  /**
   * Uniforms:
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    uTerrainSampler: 0,
    uTerrainColors: new Int8Array(MAX_TERRAINS * 4).fill(0)
  };

  static create(defaultUniforms = {}) {
    const tm = canvas.terrain;
    defaultUniforms.uTerrainSampler = tm._terrainTexture;
    const shader = super.create(defaultUniforms);
    shader.updateTerrainColors();
    return shader;
  }

  /**
   * Update the terrain colors represented in the scene.
   */
  updateTerrainColors() {
    const colors = this.uniforms.uTerrainColors;
    colors.fill(0);
    Terrain.sceneMap.forEach(t => {
      const i = t.pixelValue;
      const idx = i * 4;
      const rgba = this.constructor.getColorArray(t.color);
      colors.set(rgba, idx);
    });
  }

  /**
   * Return the color array for a given hex.
   * @param {number} hex    Hex value for color with alpha
   * @returns {number[4]}
   */
  static getColorArray(hex) {
    const c = new Color(hex);
    const alpha = 1;
    return [...c.rgb, alpha];
  }
}
