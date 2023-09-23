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

/* Testing
api = game.modules.get("terrainmapper").api
Terrain = api.Terrain;
t1 = Terrain.sceneMap.get(1);
t2 = Terrain.sceneMap.get(2);

canvas.terrain._debugDraw();
canvas.terrain._debugClear();

s = new PIXI.Sprite(canvas.terrain._terrainTexture)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

for ( const g of canvas.terrain._graphicsContainer.children ) {
  canvas.stage.addChild(g)
}

for ( const g of canvas.terrain._graphicsContainer.children ) {
  canvas.stage.removeChild(g)
}

for ( const e of canvas.terrain._shapeQueue.elements ) {
  canvas.stage.addChild(e.graphics)
}

for ( const e of canvas.terrain._shapeQueue.elements ) {
  canvas.stage.removeChild(e.graphics)
}


*/


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

uniform sampler2D uTerrainSampler; // Terrain Texture
uniform vec4[${MAX_TERRAINS}] uTerrainColors;
// uniform uvec4[${MAX_TERRAINS}] uTerrainColors;

${defineFunction("decodeTerrainChannels")}

/**
 * Determine the color for a given terrain value.
 * Currently draws increasing shades of red with a gamma correction to avoid extremely light alpha.
 */
vec4 colorForTerrain(int terrainId) {
  // uvec4 uColor = uTerrainColors[terrainId];
  // vec4 color = vec4(uColor) / 255.0;
  vec4 color = uTerrainColors[terrainId];

  // Gamma correct alpha and colors?
  color = pow(color, vec4(1. / 2.2));

  return color;
}

void main() {
  // Terrain is sized to the scene.
  vec4 terrainPixel = texture(uTerrainSampler, vTextureCoord);
  // if ( terrainPixel.r == 0.0 ) fragColor = vec4(0.0);
  // else fragColor = vec4(1.0, 0.0, 0.0, 1.0);

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
    // uTerrainColors: new Uint8Array(MAX_TERRAINS * 4).fill(0)
    uTerrainColors: new Array(MAX_TERRAINS * 4).fill(0)
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
      // const rgba = this.constructor.getColorArray(t.color).map(x => x * 255);
      // colors.set(rgba, idx);

      const rgba = this.constructor.getColorArray(t.color);
      colors.splice(idx, 4, ...rgba);
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
