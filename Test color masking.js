normal: use top layer alone, w/ alpha compositing. f(a, b) = alpha(b, a)

r0, r1 => r1
g0, g1 => g1
b0, b1 => b1


add: add pixel values one to the other

r0, r1 => r0 + r1
g0, g1 => g0 + g1
b0, b1 => b0 + b1


multiply: multiply pixel values

r0, r1 => r0 * r1 = r
g0, g1 => g0 * g1 = g
b0, b1 => b0 * b1 = b

screen: values inverted, multiplied, inverted again
f(a, b) = 1 - (1 - a) * (1 - b)

r0, r1 => 1 - (1 - r0) * (1 - r1)
g0, g1 => 1 - (1 - g0) * (1 - g1)
b0, b1 => 1 - (1 - b0) * (1 - b1)

canvas.app.renderer

Draw = CONFIG.GeometryLib.Draw
g = new PIXI.Graphics()
draw = new Draw(g)

rect0 = new PIXI.Rectangle(0, 0, 500, 500)
rect1 = new PIXI.Rectangle(100, 100, 500, 500)
rect2 = new PIXI.Rectangle(200, 200, 500, 500)

rectSmall = new PIXI.Rectangle(0, 0, 50, 50)

rectFull = rect0.union(rect1).union(rect2)

half = 128 / 255
q3 = 192 / 255

c0 = Color.fromRGB([q3, half, 0])
c1 = Color.fromRGB([0, 0, q3])
c2 = Color.fromRGB([half, 0, 0])

g.blendMode = PIXI.BLEND_MODES.NORMAL
g.blendMode = PIXI.BLEND_MODES.XOR;
g.blendMode = PIXI.BLEND_MODES.DST_OUT


rect0 = new PIXI.Rectangle(0, 0, 500, 500)
rect1 = new PIXI.Rectangle(100, 100, 500, 500)
rect2 = new PIXI.Rectangle(200, 200, 500, 500)

rect3 = new PIXI.Rectangle(0, 400, 300, 500);
rect4 = new PIXI.Rectangle(25, 500, 300, 500);
rect5 = new PIXI.Rectangle(50, 600, 300, 500);

c0 = new PIXI.Color([0.75, 0.5, 0])
c1 = new PIXI.Color([0, 0, 0.75])
c2 = new PIXI.Color([0.5, 0, 0])

c0 = new PIXI.Color([1, 0, 0])
c1 = new PIXI.Color([0, 1, 0])
c2 = new PIXI.Color([0, 0, 1])
c_clear = new PIXI.Color([0, 0, 0])

g0 = new PIXI.Graphics();
g1 = new PIXI.Graphics();
g2 = new PIXI.Graphics();


tex = PIXI.RenderTexture.create({
  resolution: 1,
  width: 1000,
  height: 1000,
  mipmap: PIXI.MIPMAP_MODES.OFF,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  format: PIXI.FORMATS.RGBA,
  type: PIXI.TYPES.UNSIGNED_BYTE
})
tex.baseTexture.clearColor = [0, 0, 0, 0];

g0.beginFill(c0, 1).drawShape(rect0).endFill();
g1.beginFill(c1, 1).drawShape(rect1).endFill()
g2.beginFill(c2, 1).drawShape(rect2).endFill()

canvas.app.renderer.state.setBlendMode(PIXI.BLEND_MODES.ADD);
canvas.app.renderer.render(g0, { renderTexture: tex, clear: true });
canvas.app.renderer.render(g1, { renderTexture: tex, clear: false });
canvas.app.renderer.render(g2, { renderTexture: tex, clear: false });
canvas.app.renderer.state.setBlendMode(PIXI.BLEND_MODES.NORMAL);


s = new PIXI.Sprite(tex)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)


// Versus:
g0 = new PIXI.Graphics();
g1 = new PIXI.Graphics();
g2 = new PIXI.Graphics();


tex = PIXI.RenderTexture.create({
  resolution: 1,
  width: 1000,
  height: 1000,
  mipmap: PIXI.MIPMAP_MODES.OFF,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  format: PIXI.FORMATS.RGBA,
  type: PIXI.TYPES.UNSIGNED_BYTE
})
tex.baseTexture.clearColor = [0, 0, 0, 0];

g0.beginFill(c0, 1).drawShape(rect0).endFill();
g1.beginFill(c1, 1).drawShape(rect1).endFill()
g2.beginFill(c2, 1).drawShape(rect2).endFill()

g0.blendMode = PIXI.BLEND_MODES.ADD;
g1.blendMode = PIXI.BLEND_MODES.ADD;
g2.blendMode = PIXI.BLEND_MODES.ADD;

canvas.app.renderer.render(g0, { renderTexture: tex, clear: true });
canvas.app.renderer.render(g1, { renderTexture: tex, clear: false });
canvas.app.renderer.render(g2, { renderTexture: tex, clear: false });


s = new PIXI.Sprite(tex)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

// Multiple shapes
rect0 = new PIXI.Rectangle(0, 0, 500, 500)
rect1 = new PIXI.Rectangle(100, 100, 500, 500)
rect2 = new PIXI.Rectangle(200, 200, 500, 500)

rect3 = new PIXI.Rectangle(0, 400, 300, 500);
rect4 = new PIXI.Rectangle(25, 500, 300, 500);
rect5 = new PIXI.Rectangle(50, 600, 300, 500);

c0 = new PIXI.Color([1, 0, 0])
c1 = new PIXI.Color([0, 1, 0])
c2 = new PIXI.Color([0, 0, 1])
c_clear = new PIXI.Color([0, 0, 0])

g0 = new PIXI.Graphics();
g1 = new PIXI.Graphics();
g2 = new PIXI.Graphics();

tex = PIXI.RenderTexture.create({
  resolution: 1,
  width: 1000,
  height: 1000,
  mipmap: PIXI.MIPMAP_MODES.OFF,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  format: PIXI.FORMATS.RGB,
  type: PIXI.TYPES.UNSIGNED_BYTE
})
tex.baseTexture.clearColor = [0, 0, 0, 0];

g0.beginFill(c0, 1).drawShape(rect0).endFill();
g1.beginFill(c1, 1).drawShape(rect1).endFill()
g2.beginFill(c2, 1).drawShape(rect2).endFill()

g0.beginFill(c0, 1).drawShape(rect3).endFill();
g1.beginFill(c1, 1).drawShape(rect4).endFill()
g2.beginFill(c2, 1).drawShape(rect5).endFill()

g0.beginFill(c_clear, 1).drawShape(rectSmall).endFill; // Doesn't work b/c of ADD blending.

g0.blendMode = PIXI.BLEND_MODES.ADD;
g1.blendMode = PIXI.BLEND_MODES.ADD;
g2.blendMode = PIXI.BLEND_MODES.ADD;

canvas.app.renderer.render(g0, { renderTexture: tex, clear: true });
canvas.app.renderer.render(g1, { renderTexture: tex, clear: false });
canvas.app.renderer.render(g2, { renderTexture: tex, clear: false });

s = new PIXI.Sprite(tex)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

// Multiple shapes, multiple graphics
gRed = new PIXI.Graphics();
gGreen = new PIXI.Graphics();
gBlue = new PIXI.Graphics();
g0 = new PIXI.Graphics();
g1 = new PIXI.Graphics();
g2 = new PIXI.Graphics();

g0.addChild(gRed);
g1.addChild(gGreen);
g2.addChild(gBlue);

gRed.beginFill(c0, 1).drawShape(rect0).endFill();
gGreen.beginFill(c1, 1).drawShape(rect1).endFill()
gBlue.beginFill(c2, 1).drawShape(rect2).endFill()

gRed.beginFill(c0, 1).drawShape(rect3).endFill();
gGreen.beginFill(c1, 1).drawShape(rect4).endFill()
gBlue.beginFill(c2, 1).drawShape(rect5).endFill()

gRed.beginFill(c_clear, 1).drawShape(rectSmall).endFill; // Doesn't work b/c of ADD blending.

g0.blendMode = PIXI.BLEND_MODES.ADD;
g1.blendMode = PIXI.BLEND_MODES.ADD;
g2.blendMode = PIXI.BLEND_MODES.ADD;

canvas.app.renderer.render(g0, { renderTexture: tex, clear: true });
canvas.app.renderer.render(g1, { renderTexture: tex, clear: false });
canvas.app.renderer.render(g2, { renderTexture: tex, clear: false });


s = new PIXI.Sprite(tex)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

// Multiple shapes, multiple graphics
tex = PIXI.RenderTexture.create({
  resolution: 1,
  width: 1000,
  height: 1000,
  mipmap: PIXI.MIPMAP_MODES.OFF,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  format: PIXI.FORMATS.RGB,
  type: PIXI.TYPES.UNSIGNED_BYTE
})
tex.baseTexture.clearColor = [0, 0, 0, 0];
rect0 = new PIXI.Rectangle(0, 0, 500, 500)
rect1 = new PIXI.Rectangle(100, 100, 500, 500)
rect2 = new PIXI.Rectangle(200, 200, 500, 500)
rect3 = new PIXI.Rectangle(0, 400, 300, 500);
rect4 = new PIXI.Rectangle(25, 500, 300, 500);
rect5 = new PIXI.Rectangle(50, 600, 300, 500);

cR = new PIXI.Color([1, 0, 0])
cG = new PIXI.Color([0, 1, 0])
cB = new PIXI.Color([0, 0, 1])
cClear = new PIXI.Color([0, 1, 1, 1])
rectClear = new PIXI.Rectangle(100, 100, 50, 50)

gRed = new PIXI.Graphics();
gGreen = new PIXI.Graphics();
gBlue = new PIXI.Graphics();
gRedClear = new PIXI.Graphics();

gRed.beginFill(cR, 1).drawShape(rect0).endFill();
gGreen.beginFill(cG, 1).drawShape(rect1).endFill()
gBlue.beginFill(cR, 1).drawShape(rect2).endFill()

gRedClear.beginFill(cClear, 1).drawShape(rectClear).endFill();

gRed.beginFill(cR, 1).drawShape(rect3).endFill();
gGreen.beginFill(cG, 1).drawShape(rect4).endFill()
gBlue.beginFill(cB, 1).drawShape(rect5).endFill()

gRed.blendMode = PIXI.BLEND_MODES.ADD;
gGreen.blendMode = PIXI.BLEND_MODES.ADD;
gBlue.blendMode = PIXI.BLEND_MODES.ADD;
gRedClear.blendMode = PIXI.BLEND_MODES.MULTIPLY;

canvas.app.renderer.render(gRed, { renderTexture: tex, clear: true });
canvas.app.renderer.render(gRedClear, { renderTexture: tex, clear: false });
canvas.app.renderer.render(gGreen, { renderTexture: tex, clear: false });
canvas.app.renderer.render(gBlue, { renderTexture: tex, clear: false });

s = new PIXI.Sprite(tex)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)



g.beginFill(0, 1).drawShape(rectFull).endFill()


g.beginFill(c0, 1).drawShape(rect0).endFill()
g.beginFill(c1, 1).drawShape(rect1).endFill()
g.beginFill(c2, 1).drawShape(rect2).endFill()


draw.shape(rect0, { color: Draw.COLORS.black, fill: Draw.COLORS.black })
draw.shape(rect0, { color: c0, fill: c0 })
draw.shape(rect1, { color: c1, fill: c1 })
draw.shape(rect2, { color: c2, fill: c2 })
g.clear()

canvas.stage.addChild(g)


// Color Mask
tex = PIXI.RenderTexture.create({
  resolution: 1,
  width: 1000,
  height: 1000,
  mipmap: PIXI.MIPMAP_MODES.OFF,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  format: PIXI.FORMATS.RGB,
  type: PIXI.TYPES.UNSIGNED_BYTE
})
tex.baseTexture.clearColor = [0, 0, 0, 0];

rect0 = new PIXI.Rectangle(0, 0, 500, 500)
rect1 = new PIXI.Rectangle(100, 100, 500, 500)
rect2 = new PIXI.Rectangle(200, 200, 500, 500)
rect3 = new PIXI.Rectangle(0, 400, 300, 500);
rect4 = new PIXI.Rectangle(25, 500, 300, 500);
rect5 = new PIXI.Rectangle(50, 600, 300, 500);
rectClear = new PIXI.Rectangle(100, 100, 50, 50)
rectRedo = new PIXI.Rectangle(120, 120, 20, 20)


cR = new PIXI.Color([1, 0, 0])
cG = new PIXI.Color([0, 1, 0])
cB = new PIXI.Color([0, 0, 1])
cClear = new PIXI.Color([0, 0, 0]);

gRed = new PIXI.Graphics();
gRed.mask = new PIXI.MaskData();
gRed.mask.colorMask = PIXI.COLOR_MASK_BITS.RED | PIXI.COLOR_MASK_BITS.ALPHA;

gGreen = new PIXI.Graphics();
gGreen.mask = new PIXI.MaskData();
gGreen.mask.colorMask = PIXI.COLOR_MASK_BITS.GREEN | PIXI.COLOR_MASK_BITS.ALPHA;

gBlue = new PIXI.Graphics();
gBlue.mask = new PIXI.MaskData();
gBlue.mask.colorMask = PIXI.COLOR_MASK_BITS.BLUE | PIXI.COLOR_MASK_BITS.ALPHA;

gRed.beginFill(cR, 1).drawShape(rect0).endFill();
gRed.beginFill(cClear, 1).drawShape(rectClear).endFill();
gRed.beginFill(cR, 1).drawShape(rect3).endFill();
gRed.beginFill(cR, 1).drawShape(rectRedo).endFill();

gGreen.beginFill(cG, 1).drawShape(rect1).endFill()
gGreen.beginFill(cG, 1).drawShape(rect4).endFill()

gBlue.beginFill(cB, 1).drawShape(rect2).endFill()
gBlue.beginFill(cB, 1).drawShape(rect5).endFill()

canvas.app.renderer.render(gRed, { renderTexture: tex, clear: true });
canvas.app.renderer.render(gGreen, { renderTexture: tex, clear: false });
canvas.app.renderer.render(gBlue, { renderTexture: tex, clear: false });

s = new PIXI.Sprite(tex)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)



// Color Mask using containers to store graphics.
tex = PIXI.RenderTexture.create({
  resolution: 1,
  width: 1000,
  height: 1000,
  mipmap: PIXI.MIPMAP_MODES.OFF,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  format: PIXI.FORMATS.RGB,
  type: PIXI.TYPES.UNSIGNED_BYTE
})
tex.baseTexture.clearColor = [0, 0, 0, 0];

rect0 = new PIXI.Rectangle(0, 0, 500, 500)
rect1 = new PIXI.Rectangle(100, 100, 500, 500)
rect2 = new PIXI.Rectangle(200, 200, 500, 500)
rect3 = new PIXI.Rectangle(0, 400, 300, 500);
rect4 = new PIXI.Rectangle(25, 500, 300, 500);
rect5 = new PIXI.Rectangle(50, 600, 300, 500);
rectClear = new PIXI.Rectangle(100, 100, 50, 50)
rectRedo = new PIXI.Rectangle(120, 120, 20, 20)


cR = new PIXI.Color([1, 0, 0])
cG = new PIXI.Color([0, 1, 0])
cB = new PIXI.Color([0, 0, 1])
cClear = new PIXI.Color([0, 0, 0]);

containerRed = new PIXI.Container;
containerRed = new PIXI.Graphics();
containerRed.mask = new PIXI.MaskData();
containerRed.mask.colorMask = PIXI.COLOR_MASK_BITS.RED | PIXI.COLOR_MASK_BITS.ALPHA;

containerGreen = new PIXI.Graphics();
containerGreen.mask = new PIXI.MaskData();
containerGreen.mask.colorMask = PIXI.COLOR_MASK_BITS.GREEN | PIXI.COLOR_MASK_BITS.ALPHA;

containerBlue = new PIXI.Graphics();
containerBlue.mask = new PIXI.MaskData();
containerBlue.mask.colorMask = PIXI.COLOR_MASK_BITS.BLUE | PIXI.COLOR_MASK_BITS.ALPHA;

g0 = new PIXI.Graphics();
g1 = new PIXI.Graphics();
g2 = new PIXI.Graphics();
g3 = new PIXI.Graphics();
g4 = new PIXI.Graphics();
g5 = new PIXI.Graphics();
gClear = new PIXI.Graphics();
gRedo = new PIXI.Graphics();

g0.beginFill(cR, 1).drawShape(rect0).endFill();
gClear.beginFill(cClear, 1).drawShape(rectClear).endFill();
g3.beginFill(cR, 1).drawShape(rect3).endFill();
gRedo.beginFill(cR, 1).drawShape(rectRedo).endFill();

g1.beginFill(cG, 1).drawShape(rect1).endFill()
g4.beginFill(cG, 1).drawShape(rect4).endFill()

g2.beginFill(cB, 1).drawShape(rect2).endFill()
g5.beginFill(cB, 1).drawShape(rect5).endFill()

containerRed.addChild(g0);
containerRed.addChild(gClear);
containerRed.addChild(g3);
containerRed.addChild(gRedo);

containerGreen.addChild(g1);
containerGreen.addChild(g4);

containerBlue.addChild(g2);
containerBlue.addChild(g5);

canvas.app.renderer.render(containerRed, { renderTexture: tex, clear: true });
canvas.app.renderer.render(containerGreen, { renderTexture: tex, clear: false });
canvas.app.renderer.render(containerBlue, { renderTexture: tex, clear: false });

s = new PIXI.Sprite(tex)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)


