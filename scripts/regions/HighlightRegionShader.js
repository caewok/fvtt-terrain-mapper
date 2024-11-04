/* globals
canvas,
PIXI,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


// Modify HighlightRegionShader so the hatch direction can be manipulated

Hooks.on("init", function() {
  HighlightRegionShader.vertexShader = `\
    precision ${PIXI.settings.PRECISION_VERTEX} float;

    ${HighlightRegionShader.CONSTANTS}

    attribute vec2 aVertexPosition;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;
    uniform vec2 canvasDimensions;
    uniform vec4 sceneDimensions;
    uniform vec2 screenDimensions;
    uniform mediump float hatchThickness;

    varying vec2 vCanvasCoord; // normalized canvas coordinates
    varying vec2 vSceneCoord; // normalized scene coordinates
    varying vec2 vScreenCoord; // normalized screen coordinates
    varying float vHatchOffset;

    // Added by Terrain Mapper
    uniform mediump float hatchX;
    uniform mediump float hatchY;
    uniform vec4 border; // Region border: s: left, t: top, p: right, q: bottom
    uniform mediump float insetBorderThickness;
    varying vec2 vPercentFromBorder;
    varying float vHatchHorizontal;
    varying float vHatchVertical;
    varying vec2 vSquarePercentFromBorder;

    void main() {
      vec2 pixelCoord = aVertexPosition;
      vCanvasCoord = pixelCoord / canvasDimensions;
      vSceneCoord = (pixelCoord - sceneDimensions.xy) / sceneDimensions.zw;
      vec3 tPos = translationMatrix * vec3(aVertexPosition, 1.0);
      vScreenCoord = tPos.xy / screenDimensions;
      gl_Position = vec4((projectionMatrix * tPos).xy, 0.0, 1.0);

      // Added by Terrain Mapper.
      // Determine where we are as a percent of the region border.
      vPercentFromBorder = (pixelCoord - border.st) / (border.pq - border.st);
      vHatchOffset = ((pixelCoord.x * hatchX) + (pixelCoord.y * hatchY)) / (SQRT2 * 2.0);
      vHatchHorizontal = pixelCoord.y / (SQRT2 * 2.0 * insetBorderThickness); // hatchX = 0, hatchY = 1
      vHatchVertical =   pixelCoord.x / (SQRT2 * 2.0 * insetBorderThickness); // hatchX = 1, hatchY = 0

      // Determine how far along the ramp path we are.
      // stpq
      float size = max(border.p - border.s, border.q - border.t);
      vSquarePercentFromBorder = (pixelCoord - border.st) / size;
    }
  `;

  HighlightRegionShader.fragmentShader = `\
    precision ${PIXI.settings.PRECISION_FRAGMENT} float;

    varying float vHatchOffset;

    uniform vec4 tintAlpha;
    uniform float resolution;
    uniform bool hatchEnabled;
    uniform mediump float hatchThickness;

    // Added by Terrain Mapper
    uniform mediump float hatchX;
    uniform mediump float hatchY;
    uniform mediump float insetPercentage;
    uniform mediump float insetBorderThickness;
    uniform bool variableHatchThickness;
    varying vec2 vPercentFromBorder;
    varying float vHatchHorizontal;
    varying float vHatchVertical;
    varying vec2 vSquarePercentFromBorder;

    void main() {
      gl_FragColor = tintAlpha;
      if ( !hatchEnabled ) return;

      float thisHatchThickness = hatchThickness;
      if ( variableHatchThickness ) {
        // hatchX and hatchY are between -1.0 and 1.0
        // vSquarePercentFromBorder are between 0.0 and 1.0.
        float xPortion = (hatchX >= 0.0 ? vSquarePercentFromBorder.x : (1.0 - vSquarePercentFromBorder.x)) * abs(hatchX);
        float yPortion = (hatchY <= 0.0 ? vSquarePercentFromBorder.y : (1.0 - vSquarePercentFromBorder.y)) * abs(hatchY);
        float ratio = clamp(xPortion + yPortion, 0.0, 1.0);
        // (thisHatchThickness * xPortion) + (thisHatchThickness * yPortion)
        thisHatchThickness = hatchThickness + (hatchThickness * ratio * 3.0);
        // gl_FragColor = vec4(vSquarePercentFromBorder.x, vSquarePercentFromBorder.y, 0.0, 0.8);
        // return;
      }

      // Added by Terrain Mapper.
      float hatchOffset = vHatchOffset / thisHatchThickness;

      if ( insetPercentage != 0.0 ) {
        bvec4 isInset = bvec4(
          vPercentFromBorder.x < insetPercentage,
          vPercentFromBorder.y < insetPercentage,
          vPercentFromBorder.x > 1.0 - insetPercentage,
          vPercentFromBorder.y > 1.0 - insetPercentage
        );

        // s: left, t: top, p: right, q: bottom
        if ( any(isInset.sp) ) hatchOffset = vHatchVertical;
        if ( any(isInset.tq) ) hatchOffset = vHatchHorizontal;

        // Split the corners along the diagonal.
        if ( all(isInset.st) ) {
          if ( vPercentFromBorder.x < vPercentFromBorder.y ) hatchOffset = vHatchVertical;
          else hatchOffset = vHatchHorizontal;
        }

        if ( all(isInset.pq) ) {
          if ( vPercentFromBorder.x > vPercentFromBorder.y ) hatchOffset = vHatchVertical;
          else hatchOffset = vHatchHorizontal;
        }

        if ( all(isInset.sq) ) {
          if ( vPercentFromBorder.x < (1.0 - vPercentFromBorder.y) ) hatchOffset = vHatchVertical;
          else hatchOffset = vHatchHorizontal;
        }

        if ( all(isInset.tp) ) {
          if ( (1.0 - vPercentFromBorder.x) < vPercentFromBorder.y ) hatchOffset = vHatchVertical;
          else hatchOffset = vHatchHorizontal;
        }

        if ( any(isInset) ) thisHatchThickness = insetBorderThickness;
      }




      // From original HighlightRegionShader.
      float x = abs(hatchOffset - floor(hatchOffset + 0.5)) * 2.0;
      float s = thisHatchThickness * resolution;
      float y0 = clamp((x + 0.5) * s + 0.5, 0.0, 1.0);
      float y1 = clamp((x - 0.5) * s + 0.5, 0.0, 1.0);
      gl_FragColor *= mix(0.3333, 1.0, y0 - y1);
    }
  `;


  HighlightRegionShader.defaultUniforms.hatchX = 1;
  HighlightRegionShader.defaultUniforms.hatchY = 1;
  HighlightRegionShader.defaultUniforms.insetPercentage = 0;
  HighlightRegionShader.defaultUniforms.border = [0, 0, 0, 0];
  HighlightRegionShader.defaultUniforms.insetBorderThickness = 1;
  HighlightRegionShader.defaultUniforms.variableHatchThickness = false;
});

