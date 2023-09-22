/* global
canvas,
Color,
PIXI
*/
"use strict";

import { getSetting, SETTINGS } from "../settings.js";

import { defineFunction } from "./GLSLFunctions.js";
import { AbstractTerrainShader } from "./AbstractTerrainShader.js";

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
uniform vec4 uMinColor;
uniform vec4 uMaxColor;
uniform float uMaxNormalizedElevation;

${defineFunction("hsb2rgb")}
${defineFunction("hsb2rgb")}
${defineFunction("decodeElevationChannels")}

/**
 * Determine the color for a given elevation value.
 * Currently draws increasing shades of red with a gamma correction to avoid extremely light alpha.
 */
vec4 colorForElevation(float eNorm) {
  // Linear mix of the two HSV colors and alpha.
  // Skipping 0, so one less entry
  float maxNorm = max(1.0, uMaxNormalizedElevation - 1.0);
  vec4 color = mix(uMinColor, uMaxColor, (eNorm - 1.0) / maxNorm);

  // If using hsv
  // color.rgb = hsv2rgb(color.rgb);
  // color.rgb = hsb2rgb(color.rgb);

  // Gamma correction to avoid extremely light alpha?
  // color.a = pow(color.a, 1. / 2.2);

  // Gamma correct alpha and colors?
  color = pow(color, vec4(1. / 2.2));

  return color;
}

void main() {
  // Terrain is sized to the scene.
  vec4 terrainPixel = texture(uTerrainSampler, vTextureCoord);
  float eNorm = decodeElevationChannels(terrainPixel);
  fragColor = eNorm == 0.0 ? vec4(0.0) : colorForElevation(eNorm);
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
    uMinColor: [1, 0, 0, 1],
    uMaxColor: [0, 0, 1, 1],
    uMaxNormalizedElevation: 65536
  };

  static create(defaultUniforms = {}) {
    const ev = canvas.elevation;
    defaultUniforms.uTerrainSampler = ev._elevationTexture;
    defaultUniforms.uMinColor = this.getDefaultColorArray("MIN");
    defaultUniforms.uMaxColor = this.getDefaultColorArray("MAX");
    defaultUniforms.uMaxNormalizedElevation = ev._normalizeElevation(ev.elevationCurrentMax);

    return super.create(defaultUniforms);
  }

  /**
   * Update the minimum color uniform.
   * @param {string} newColorHex
   */
  updateMinColor(newColorHex) {
    this.uniforms.uMinColor = this.constructor.getColorArray(newColorHex);
  }

  /**
   * Update the maximum color uniform.
   * @param {string} newColorHex
   */
  updateMaxColor(newColorHex) {
    this.uniforms.uMaxColor = this.constructor.getColorArray(newColorHex);
  }

  /**
   * Update the maximum elevation value.
   * @param {number}
   */
  updateMaxCurrentElevation() {
    this.uniforms.uMaxNormalizedElevation = canvas.elevation._normalizeElevation(canvas.elevation.elevationCurrentMax);
  }

  /**
   * Return the current color setting as a 4-element array.
   * @param {string} type   MIN or MAX
   * @returns {number[4]}
   */
  static getDefaultColorArray(type = "MIN") {
    const hex = getSetting(SETTINGS.COLOR[type]);
    return this.getColorArray(hex);
  }

  /**
   * Return the color array for a given hex.
   * @param {string} hex    Hex value for color with alpha
   * @returns {number[4]}
   */
  static getColorArray(hex) {
    const startIdx = hex.startsWith("#") ? 1 : 0;
    const hexColor = hex.substring(startIdx, startIdx + 6);
    const hexAlpha = hex.substring(startIdx + 6);
    const alpha = parseInt(hexAlpha, 16) / 255;
    const c = Color.fromString(hexColor);
    return [...c.rgb, alpha];
  }
}
