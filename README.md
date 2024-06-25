[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-terrain-mapper)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=blueviolet)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-terrain-mapper)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/terrainmapper&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/total)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H3Y7IJW)

You can use this [Module JSON link](https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json) to install.

As of version 0.3.0, this [Foundry VTT](https://foundryvtt.com) module facilitates the use of Foundry v12 regions to define "Terrains." Terrains are active effects (or for PF2e, items with defined effects) that are applied to tokens that enter a defined region. Examples include difficult terrain, water (swimming), or cliffs (climbing). While movement is the obvious choice for terrain, any active effect can be defined as a terrain. 

Besides terrain, Terrain Mapper also provides a region behavior to set token elevation. This is useful for defining plateaus of different elevation.

Terrain mapper also provides some advanced region drawing tools: fill-by-grid, fill-by-line-of-sight, and fill-by-enclosed-walls. 

This module intends to be system-neutral. I will endeavor to make this module compatible with other systems upon request (and to the extent possible).

You can use the [wiki page](https://github.com/caewok/fvtt-terrain-mapper/wiki/Terrains) to share exported terrains.

[Screen Recording 2024-06-22 at 8.40.46 AM.webm](https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/acf36c7b-04a6-4673-b02a-9901f71a138e)

# Thanks

Special thanks to:
- [dev7355608](https://github.com/dev7355608) for answering yet more random PIXIjs questions.
- [DFreds](https://github.com/DFreds) for inspiration from their [Convenient Effects](https://github.com/DFreds/dfreds-convenient-effects) module.



## Required modules
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- [socketlib](https://github.com/manuelVo/foundryvtt-socketlib)

# Recommended modules
- [Wall Height](https://github.com/theripper93/wall-height)

# Known issues
None at the moment. But version 0.3.0 represents a substantial rewrite, deleting almost 10,000 lines of code and modifying or adding about half of that! So I expect some bugs will need to be ironed out.

# Basic Use

Terrain Mapper lets the GM create one or more "terrains." Each terrain is, basically, an active effect that can be added to a token manually or as the token moves through a region. 

Go to the "Terrain Book" in region controls to define terrains. You may already see some default terrains, depending on your system and current installation. If not, add a new terrain. Optionally configure the terrain, giving it a name and an icon.

<img width="479" alt="Screenshot 2024-06-21 at 9 08 07 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/594d5a8e-298b-4c63-b14e-8875eb0abee8">

In a region, go to the Behaviors tab and add a new behavior. Select "Set Terrain." In the pop-out, select one or more terrains that will be added to the token when it enters the region. Save the region. Now when you move a token into a region, you should see that terrain get added to the token. Any active effects defined on that terrain will now apply to the token. 

Similarly, you can define an elevation for the region that will apply to tokens. In the region behaviors, select "Set Elevation." In the pop-out, set the elevation you want for the token. In its simplest form, regions can be thought of like plateaus. Thus, you may want to define the top of the region to be the same as the elevation you select, so the region does not affect flying tokens that move above it. Now, when moving a token through the region, it will change elevation accordingly. Note that it is possible to having overlapping regions that set elevation. It is also possible to set the token elevation such that it moves the token out of the region. This can cause interesting, but not always intended, behavior! 

To add a terrain effect to a token manually, open a token's actor sheet. Go to the Region controls and open the Terrains book. Drag a terrain to the token to have its effects added to the token.

Terrain effects are active effects (well, except in pf2e and a few other systems), meaning you can disable or remove them directly from the Token document.

## Terrain Book
<img width="440" alt="Screenshot 2024-06-21 at 9 07 13 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/100b1b85-577c-43fe-9061-ed90a26bcbe3">

The terrain book, found in Region controls, defines terrains for the game. If you delete terrains from this book, regions with those terrains may no longer apply them! Right-click a given terrain to get additional options, including import/export. You can drag terrains to actor sheets to have the underlying active effect applied.

## Fill tools
Terrain Mapper adds some additional fill tools to the Region controls, to facilitate drawing region shapes.

### Fill by grid
<img width="432" alt="Screenshot 2024-06-21 at 9 07 49 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/0c31f7e9-f735-43f9-8e71-0cbc3a1cbae7">

Fills one or more grid squares with the terrain. Hold and drag to fill a bunch of grid squares in a row. This will combine the grid squares into a single shape at the end, potentially with one or more holes.

### Fill by line-of-sight
<img width="432" alt="Screenshot 2024-06-21 at 9 07 43 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/392ac416-244a-434e-a0a4-517c97f1b6bb">

Fills an area representing the line-of-sight from the point selected on the canvas. This is equivalent to the line-of-sight used in token vision.

### Fill space enclosed by walls
<img width="432" alt="Screenshot 2024-06-21 at 9 07 37 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/01c2ca39-b9d1-4dda-b89c-20761050bb3b">

Based on the current wall configuration for the scene, this tool will fill an enclosed space with the selected terrain from the point selected. If there are "islands" within the enclosed space, those islands will not be filled. To assist you, wall outlines will be displayed while this tool is active. 

Unlike the "Create Shape from Controlled Walls" tool provided by Regions, this does not require you to select walls first. But because of this, gaps between walls can cause this tool to "leak" and fill much more area than intended. To undo it, go to the region shapes and delete the last shape in the list.
<img width="1047" alt="Screenshot 2024-06-21 at 9 16 16 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/143d3ebc-787c-4c45-97fa-dc832cbfd78e">

## Region configuration
Within a region, you can choose two behaviors: set terrain and set elevation.

### Set Terrain
<img width="479" alt="Screenshot 2024-06-21 at 9 08 17 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/4b94090f-44a6-4ef0-b803-f40b1e17ebcc">

### Set Elevation
<img width="479" alt="Screenshot 2024-06-21 at 9 08 30 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/147fc1e8-c883-4d04-9d76-a642bc7733b6">

## Terrain configuration
You can edit a terrain by clicking it in the Terrain book or right-clicking and selecting "Edit Terrain" in the dropdown. This is how you define the active effect for the terrain.

In addition, Terrain Mapper adds some terrain-specific configurations.

### Duplicates
If you enable duplicates, more than one instance of the terrain may be applied to a token. This is useful, for example, if you want to designate difficult x2 and difficult x4 terrain. Just overlap the x2 region with x4 region, and the terrain will be applied twice as the token moves through the overlap. 

### Secret
Normally, users can preview terrains by dragging their token over a region. This option precludes users from seeing the terrain in advance. 
