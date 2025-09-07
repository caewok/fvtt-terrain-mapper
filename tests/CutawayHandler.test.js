/* globals
CONFIG,
Hooks,
PIXI
*/
"use strict";

import { TokenElevationHandler, CutawayHandler } from "../scripts/TokenElevationHandler.js";

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "terrainmapper.CutawayHandler",

  (context) => {
      const { describe, it, expect } = context;

      const { ABOVE, BELOW, GROUND, OUTSIDE } = TokenElevationHandler.ELEVATION_LOCATIONS;

// ----- NOTE: AABB2d.overlapsAABB -----
describe('CutawayPolygon Ramp Handler elevationType', () => {
  const cutPoly = CONFIG.GeometryLib.CutawayPolygon.fromCutawayPoints([
    0, -200,
    0, 0,
    16249, 0,
    16249,600,
    1326834, 200,
    1326834, 0,
    1735265, 0,
    1735265, -200
  ], new CONFIG.GeometryLib.threeD.ElevatedPoint(2350, 2250, 0), new CONFIG.GeometryLib.threeD.ElevatedPoint(3650, 2450, 0))


  const cutHandler = new CutawayHandler(cutPoly);
  let pt;

  it('should handle outside points', () => {
     pt = new PIXI.Point(-10, 0)        // Outside left
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);

    pt = new PIXI.Point(1735267, 0)        // Outside right
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);
  });

  it('should handle the left vertical', () => {
    pt = new PIXI.Point(16249, 1000)        // Above left
    expect(cutHandler.elevationType(pt)).to.equal(ABOVE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(600);

    pt = new PIXI.Point(16249, 600)        // Ground left
    expect(cutHandler.elevationType(pt)).to.equal(GROUND);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(600);

    pt = new PIXI.Point(16249, 0)        // Below left
    expect(cutHandler.elevationType(pt)).to.equal(BELOW);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(600);

    pt = new PIXI.Point(16249, -500)        // Outside left
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);
  });

  it('should handle the right vertical', () => {
    pt = new PIXI.Point(1326834, 1000)        // Above right
    expect(cutHandler.elevationType(pt)).to.equal(ABOVE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(0);

    pt = new PIXI.Point(1326834, 0)        // Ground right
    expect(cutHandler.elevationType(pt)).to.equal(GROUND);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(0);

    pt = new PIXI.Point(1326834, -100)        // Below right
    expect(cutHandler.elevationType(pt)).to.equal(BELOW);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(0);

    pt = new PIXI.Point(1326834, -500)        // Below right
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);
  });

  it('should handle mid-cutaway', () => {
    pt = new PIXI.Point(20000, 1000)        // Above
    expect(cutHandler.elevationType(pt)).to.equal(ABOVE);
    expect(cutHandler.elevationUponEntry(pt)).to.be.closeTo(598.855, 0.001);

    pt = new PIXI.Point(20000, 598.8551677304786)        // Ground
    expect(cutHandler.elevationType(pt)).to.equal(GROUND);
    expect(cutHandler.elevationUponEntry(pt)).to.be.closeTo(598.855, 0.001);

    pt = new PIXI.Point(20000, -100)        // Below
    expect(cutHandler.elevationType(pt)).to.equal(BELOW);
    expect(cutHandler.elevationUponEntry(pt)).to.be.closeTo(598.855, 0.001);

    pt = new PIXI.Point(20000, -500)        // Outside
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);
  });
});

describe('CutawayPolygon Handler Overlap Plateau elevationType', () => {
  const cutPoly = CONFIG.GeometryLib.CutawayPolygon.fromCutawayPoints([
    0, 0,
    500, 0,
    500, 200,
    300, 200,
    300, 1000,
    900, 1000,
    900, -200,
    0, -200
  ], new CONFIG.GeometryLib.threeD.ElevatedPoint(2350, 2250, 0), new CONFIG.GeometryLib.threeD.ElevatedPoint(3650, 2450, 0))


  const cutHandler = new CutawayHandler(cutPoly);
  let pt;

  it('should handle outside points', () => {
     pt = new PIXI.Point(500, -300)        // Outside left
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);

    pt = new PIXI.Point(-10, 0)        // Outside right
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);
  });

  it('should handle the left vertical', () => {
    pt = new PIXI.Point(500, 300)
    expect(cutHandler.elevationType(pt)).to.equal(BELOW);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(1000);

    pt = new PIXI.Point(500, 200)
    expect(cutHandler.elevationType(pt)).to.equal(BELOW);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(1000);

    pt = new PIXI.Point(500, 1000)
    expect(cutHandler.elevationType(pt)).to.equal(GROUND);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(1000);

    pt = new PIXI.Point(500, 1200)
    expect(cutHandler.elevationType(pt)).to.equal(ABOVE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(1000);
  });

  it('should handle the left vertical overhang', () => {
    pt = new PIXI.Point(300, 1000)
    expect(cutHandler.elevationType(pt)).to.equal(GROUND);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(1000);

    pt = new PIXI.Point(300, 0)
    expect(cutHandler.elevationType(pt)).to.equal(GROUND);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(0);

    pt = new PIXI.Point(300, 300);
    expect(cutHandler.elevationType(pt)).to.equal(BELOW);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(1000);

    pt = new PIXI.Point(300, -300);
    expect(cutHandler.elevationType(pt)).to.equal(OUTSIDE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(-Infinity);

    pt = new PIXI.Point(300, 100);
    expect(cutHandler.elevationType(pt)).to.equal(ABOVE);
    expect(cutHandler.elevationUponEntry(pt)).to.equal(0);
  });
});

});  // registerBatch
});  // Hooks.on

