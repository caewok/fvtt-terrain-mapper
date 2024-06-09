[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-terrain-mapper)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=blueviolet)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-terrain-mapper)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/terrainmapper&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/total)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H3Y7IJW)

You can use this [Module JSON link](https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json) to install.

This [Foundry VTT](https://foundryvtt.com) module provides a terrain canvas layer that lets the GM designate areas of the canvas to have one or more terrain types. Each terrain is associated with an [active effect](https://foundryvtt.com/article/active-effects/), which can be applied to tokens manually or as the token moves across the canvas.

This module intends to be system-neutral. Note that at the moment, however, this module requires a system that uses Foundry VTT's active effects system. I will endeavor to make this module compatible with other systems upon request (and to the extent possible).

# Thanks

Special thanks to:
- [dev7355608](https://github.com/dev7355608) for answering yet more random PIXIjs questions.
- [DFreds](https://github.com/DFreds) for inspiration from their [Convenient Effects](https://github.com/DFreds/dfreds-convenient-effects) module.

# Module compatibility

## Required modules
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- [socketlib](https://github.com/manuelVo/foundryvtt-socketlib)

## Recommended modules
- [Elevated Vision](https://github.com/caewok/fvtt-elevated-vision). Elevated Vision allows the GM to set elevation for the canvas. Terrain Mapper will account for the differing elevation when applying terrains to the token.

# Basic Use

Terrain Mapper lets the GM create one or more "terrains." Each terrain is, basically, an active effect that can be added to a token manually or (optionally) as the token moves across the canvas. Terrains also can be defined to affect only a specific range of elevation.

Each pixel of the canvas can be coded to a specific terrain. Drawing tools assist the GM with filling in parts of the canvas with terrain values. A scene can have up to 6 "layers" or "levels" of terrain---meaning that up to 6 terrains can overlap on the same pixel. A scene can have up to 31 distinct terrains.

1. Create a new terrain

Start by going to the Terrain Mapper control. Find the book icon (Terrains) in that set of sub-controls. Click the "Create Terrain" button. Optionally, give it a name. You may also want to customize the options in the "Terrain Mapper" tab.

2. Fill a grid square with the terrain.

Now that you have a terrain, select its name in the drop-down terrain menu. (It probably says "No Terrain" to start.) Select the paintbrush tool ("Fill by grid"). Click somewhere on the canvas. You should see the color of the terrain appear in the grid square you clicked.

Note that you can "undo" a limited number of fills. You can also select "No Terrain," which operates as an eraser.

3. Decide whether you want auto-terrain.

In the module settings, you can choose whether the active effects for terrain(s) are applied automatically to tokens as they move across the screen. There is also an option to interrupt token movement with a GM dialog when new terrain is encountered. This allows, for example, the GM to require an ability check before allowing the token to continue movement.

4. Test in the Token layer.

In the token layer, dragging a token over terrain areas will display the name of the terrain. Moving the token may cause terrain effects to be added or removed from the token, depending on your settings.

5. Add a terrain effect to a token manually.

Open a token document. Go to the Terrain Mapper controls and open the Terrains book. Drag a terrain to the token to have its effects added to the token.

Terrain effects are active effects, meaning you can disable or remove them directly from the Token document.

https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/99ef6e46-992b-4677-83a0-ecf03b552983

# Terrain controls
<img width="199" alt="All controls" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/e7378f46-3918-4a4d-a4c1-9a5cd547130c" style="float: left;">
GMs and users can use the Terrain Mapper controls. Users can only see terrains that are marked as visible to users, and only if they have line-of-sight to the terrain.

## Layer selector
<img width="481" alt="Layer selector" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/3a8cdc4e-1844-4fd9-853c-eb9024c013fb" style="float: left;">
Select one of the six layers here. Terrain labeling on the scene will change based on which layer you are on.
Non-GMs can also switch between terrain layers using this tool.

## Terrain selector
<img width="481" alt="Terrain selector" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/cef92547-c323-44c5-8cc4-9b3c11e8a8f5">

GMs can select a terrain to use with the fill tools here. The divider line separates terrains currently in the scene from terrains not in the scene.

## Fill tools

GMs can use the fill tools to "color" parts of the canvas with terrains, based on the currently selected layer and terrain. Note that "No Terrain" can be used as an eraser.

### Fill by grid

<img width="44" alt="Brush" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/18fe4c3e-b8e0-4f79-aa5d-705acc668fcc" style="float: left;"> Fills one or more grid squares with the terrain. Hold and drag to fill a bunch of grid squares in a row.

### Fill by line-of-sight
<img width="44" alt="Eye" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/ac1439b8-9297-4118-a0f9-ff36c9aa23f4" style="float: left;"> Fills an area representing the line-of-sight from the point selected on the canvas. This is equivalent to the line-of-sight used in token vision.

### Fill space enclosed by walls
<img width="44" alt="Paint" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/45a06ad8-c0ce-4370-a2d2-ab6ac09f7225" style="float: left;"> Based on the current wall configuration for the scene, this tool will fill an enclosed space with the selected terrain from the point selected. If there are "islands" within the enclosed space, those islands will not be filled.

Note that gaps between walls can cause this tool to fill much more area than intended. The undo button is your friend here!

### Polygon tool
<img width="44" alt="Polygon" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/dc17ee4d-46ba-4a3d-9047-8ca83dcfda4b" style="float: left;"> This tool allows the GM to create a polygon, which is then filled with the selected terrain. The tool operates similarly to the polygon tool in the Drawings layer. Click a spot to start; click again to create a polygon edge; double-click to end. The start and end points of the polygon will be automatically connected to create a closed shape.

## Undo
<img width="44" alt="Undo" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/538a508c-a7ee-402a-8c30-e02da2913458" style="float: left;"> A limited number of undos are available. (Hint: these are per-layer.)

## Trash
<img width="44" alt="Trash" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/32a0e53c-ace4-4dbc-8e9a-15e06109cecd" style="float: left;"> If you want to clear the scene of all terrain values, this is the tool to use.

## Download / Upload
<img width="44" alt="Download" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/849545f7-96d5-442e-8d52-09525845b215" style="float: left;">
<img width="44" alt="Upload" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/7326a726-6c2d-474d-9110-711e931bcf3e" style="float: left;"> You can download a JSON file of the scene terrain, and then upload it using these tools. Note that the file contains information about the scene, but not information about the terrains themselves. (See the terrain book for saving and loading terrains.) Thus, if you load this file in a new world, or an existing world after changing or deleting terrains, some or all of the pixels in the scene will be coded to new terrains.

## Toggle terrain names
<img width="44" alt="Enable labels" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/aaac932b-73c5-4200-91d2-5066ed4ec17d" style="float: left;"> Enable to show terrain names on the canvas map.

## Terrain Book
<img width="44" alt="Terrain book" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/b5a82920-a1dd-4743-8504-1b8e7259fd33" style="float: left;">

The terrain book stores all the terrains the GM has defined, and provides for advanced settings.

Note that the terrains are per-world, not per scene.

Click a terrain to edit it. Right click a terrain in the list to get more options. You can duplicate, favorite, import, export, and delete terrains. "Export Terrain" will save a JSON file with that specific terrain's information. "Import Terrain" will overwrite that specific terrain with information from the JSON file.

If you want to add multiple terrains, or replace the terrains in your world entirely, expand the "All" folder. Three buttons appear: Import terrains, replace terrains, and export terrains. Export will save a JSON of all the terrains in the Terrain Book. Import will add terrains from an exported JSON to the Terrain Book without removing the existing terrains. Replace, as the name suggests, removes all terrains in the Terrain Book and replaces them with the terrains found in the JSON.

# Terrain Book configuration
<img width="298" alt="Terrain book config" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/5ae4e851-712c-4a30-9a95-aa9832b587e8" style="float: left;">

## Create Terrain button

Pretty self-explanatory. Adds a new terrain to the book.

## List Terrains (Advanced Edit) button

This button pops out a helper that lists terrain information in a compact form for editing.

## Advanced Scene Configuration button

This button pops out a dialog with two parts: elevation settings and pixel representation.

# Advanced Scene Configuration
<img width="694" alt="Advanced Scene config" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/05b68086-efe9-4d80-b313-e860e1199dc6" style="float: left;">

## Terrain Layer Elevation

The GM can designate an elevation for each terrain layer. If the given terrain is set to elevation relative to the layer, then the layer is used to calculate the terrain elevation. See the discussion of Terrain configuration for more details.

## Terrain Pixel Representation

This allows the GM to define which terrains are coded in the scene. Usually, you would not touch this except if you have imported one or more terrains and wish to use them instead of what was already coded in the scene.

# Terrain configuration
<img width="694" alt="Terrain list" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/1ce9dd02-cd84-4b71-bee5-4b4329893386" style="float: left;">

You can edit a terrain by clicking it in the Terrain book or right-clicking and selecting "Edit Terrain" in the dropdown. This is how you define the active effect for the terrain.

In addition, Terrain Mapper adds a tab with terrain-specific configurations.

## User Visible

If enabled, the terrain is visible to users when they select the Terrain Mapper control or when they drag their token across the canvas.

## Color

Set the color used to display the terrain in the Terrain Mapper layer here.

## Anchor, offset, range below and above

Terrains have a defined elevation range. Only a token within the elevation will have that terrain applied (assuming the token has moved onto the terrain).

The offset is the change between the anchor's elevation and the terrain's base elevation. The base elevation is used to define its low/high range based on "range below" and "range above."

The GM has three options:

1. Absolute. Technically, the anchor is set to elevation 0. Terrain Elevation will always be anchored at the offset value, ranging from below to above the anchor based on the values provided.

For example, if the offset is 10 and the range below/above is -10 / 20, then the elevation range for the terrain would be 0 / 30. (-10 + 10; 20 + 10.)

2. Relative to Ground. Typically, ground is 0 and this option operates just like "Absolute." But if you have Elevated Vision installed, the base terrain will follow the elevation defined in that module. So if the ground elevation rises from 0 to 10, the terrain's elevation range will rise accordingly.

3. Relative to Layer. The GM can define a layer's elevation in the List Terrains (Advanced Edit) button in the Terrain Book.

For example, imagine you set the terrain offset from its anchor to be +5, with a low range of -5 and a high range of +20. If the layer for the terrain is elevation 10, then the terrain would have an effective elevation range of 10–35. (10 + 5 - 5 = 10; 10 + 5 + 20 = 35). For this terrain on this layer, tokens must be within an elevation of 10 to 35 for the terrain to affect them.

Different terrains might logically have different elevation ranges. Water might be 0/-20/0 because it affects tokens that dive below the surface. Ice might be 0/-0/+0, because it only affects tokens on the surface. A forest of tall trees might be 0/-0/+50, affecting flying creatures up to 50'. And a low-hanging fog might only affect flying creatures, say, 20/-0/+20 (range between 20 and 40 feet off the ground).

# Module Settings

## Auto-terrain

As the GM or PCs drag a token across the canvas, Terrain Mapper can automatically add and subtract terrain effects to that token. Here, you can choose between disabling auto-terrain, enabling it only if a combat is active, or enabling all the time.

## Auto-terrain dialog

When enabled, this setting presents the GM with a dialog that interrupts token movement whenever the token encounters a new terrain. The GM can then decide whether to continue or cancel the movement.
