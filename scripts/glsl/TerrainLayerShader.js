/* global
canvas,
Color,
PIXI
*/
"use strict";

import { defineFunction } from "./GLSLFunctions.js";
import { AbstractTerrainShader } from "./AbstractTerrainShader.js";
import { Settings } from "../settings.js";

const MAX_TERRAINS = 16; // Including 0 as no terrain.

/* Testing
Draw = CONFIG.GeometryLib.Draw
api = game.modules.get("terrainmapper").api
Terrain = api.Terrain;
t1 = canvas.terrain.sceneMap.get(1);
t2 = canvas.terrain.sceneMap.get(2);

canvas.terrain._debugDraw();
canvas.terrain._debugClear();

tex0 = canvas.terrain._terrainTextures[0]
tex1 = canvas.terrain._terrainTextures[1]


s = new PIXI.Sprite(tex0)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

s = new PIXI.Sprite(tex1)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

pt = _token.center
canvas.terrain.pixelCache.pixelAtCanvas(pt.x, pt.y)

graphicsChildren = canvas.terrain._graphicsContainer.children
for ( const g of graphicsChildren ) {
  canvas.stage.addChild(g)
}

for ( const g of graphicsChildren ) {
  canvas.stage.removeChild(g)
}

for ( const e of canvas.terrain._shapeQueue.elements ) {
  canvas.stage.addChild(e.graphics)
}

for ( const e of canvas.terrain._shapeQueue.elements ) {
  canvas.stage.removeChild(e.graphics)
}

draw = new Draw();
for ( const e of canvas.terrain._shapeQueue.elements ) {
  const t = canvas.terrain.sceneMap.get(e.shape.pixelValue);
  const txt = draw.labelPoint(e.shape.origin, t.name, { fontSize: 24 })
  txt.anchor.set(0.5); // Center text
}

s = PIXI.Sprite.from(t.icon)
s.position = e.shape.origin
canvas.stage.addChild(s)
s.anchor.set(0.5)
s.scale.set(.1, .1)

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

uniform sampler2D uTerrainSampler0; // Terrain Texture
uniform sampler2D uTerrainSampler1; // Terrain Texture
uniform sampler2D uTerrainIcon;
uniform vec4[${MAX_TERRAINS}] uTerrainColors;
uniform int uTerrainLayer;
// uniform uvec4[${MAX_TERRAINS}] uTerrainColors;

${defineFunction("decodeTerrainChannels")}

/**
 * Determine the color for a given terrain value.
 * Currently draws increasing shades of red with a gamma correction to avoid extremely light alpha.
 */
vec4 colorForTerrain(uint terrainId) {
  // uvec4 uColor = uTerrainColors[terrainId];
  // vec4 color = vec4(uColor) / 255.0;
  vec4 color = uTerrainColors[terrainId];

  // Gamma correct alpha and colors?
  color = pow(color, vec4(1. / 2.2));

  return color;
}

void main() {
  fragColor = vec4(0.0);

  // Terrain is sized to the scene.
  vec4 terrainPixel;
  if ( uTerrainLayer < 3 ) terrainPixel = texture(uTerrainSampler0, vTextureCoord);
  else terrainPixel = texture(uTerrainSampler1, vTextureCoord);

  uint terrainId = decodeTerrainChannels(terrainPixel, uTerrainLayer);
  if ( terrainId == 0u ) return;

  // if ( terrainPixel.r == 0.0 ) fragColor = vec4(0.0);
  // else fragColor = vec4(1.0, 0.0, 0.0, 1.0);
  // ivec2 iconSize = textureSize(uTerrainIcon);
  // vec4 iconColor = texture(uTerrainIcon, vTextureCoord);
  vec4 terrainColor = colorForTerrain(terrainId);
  // fragColor = mix(terrainColor, iconColor, 0.5);
  fragColor = terrainColor;
}`;

  /**
   * Uniforms:
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    uTerrainSampler0: 0,
    uTerrainSampler1: 0,
    // Unused: uTerrainColors: new Uint8Array(MAX_TERRAINS * 4).fill(0)
    uTerrainColors: new Array(MAX_TERRAINS * 4).fill(0),
    uTerrainIcon: 0,
    uTerrainLayer: 0
  };

  static create(defaultUniforms = {}) {
    const tm = canvas.terrain;
    defaultUniforms.uTerrainSampler0 = tm._terrainTextures[0];
    defaultUniforms.uTerrainSampler1 = tm._terrainTextures[1];
    const shader = super.create(defaultUniforms);
    shader.updateTerrainColors();
    shader.updateTerrainIcons();
    shader.updateTerrainLayer();
    return shader;
  }

  /**
   * Update the terrain icons represented in the scene.
   */
  updateTerrainIcons() {
    // TODO: Handle multiple icons.
    for ( const terrain of canvas.terrain.sceneMap.values()) {
      if ( !terrain.icon ) continue;
      this.uniforms.uTerrainIcon = PIXI.Texture.from(terrain.icon);
      break;
    }
  }

  /**
   * Update the terrain colors represented in the scene.
   */
  updateTerrainColors() {
    const colors = this.uniforms.uTerrainColors;
    colors.fill(0);
    canvas.terrain.sceneMap.forEach(t => {
      const i = t.pixelValue;
      const idx = i * 4;
      // Unused:
      // const rgba = this.constructor.getColorArray(t.color).map(x => x * 255);
      // colors.set(rgba, idx);

      const rgba = this.constructor.getColorArray(t.color);
      colors.splice(idx, 4, ...rgba);
    });
  }

  /**
   * Update the terrain layer currently represented in the scene.
   */
  updateTerrainLayer() {
    this.uniforms.uTerrainLayer = canvas.terrain?.toolbar?.currentLayer
      ?? Settings.get(Settings.KEYS.CURRENT_LAYER) ?? 0;
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
