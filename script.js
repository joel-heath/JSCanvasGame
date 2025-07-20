const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');

const camera = {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height
};

const player = {
    x: 0,
    y: 0,
    xVel: 0,
    yVel: 0,
    acc: 1,
    terminalVel: 1,
    facing: 'left',
    location: ''
};

const keysPressed = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
    space: 0
};

// Global object to hold map data and assets
const game = {
    maps: {}, // Will be keyed by map name, e.g., 'house1'
    tileImages: {}, // Maps a GID to its loaded image (global cache)
    characters: {},
};
/* Each map object in game.maps[mapName] will have this structure:
{
    mapData: The raw Tiled JSON data,
    currentInteractable: null,
    backgroundLayer: null,
    collisionLayer: null,
    interactablesLayer: null,
    sortedForegroundObjects: [],
    topLayerObjects: [],
}
*/

// --- ASSET LOADING ---

/**
 * Helper function to load an image and return a promise.
 * @param {string} src The path to the image.
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    });
}

/**
 * Loads all Tiled maps and associated assets.
 * This function now processes multiple maps and organizes them.
 */
async function loadAssets() {
    // 1. Load Player Assets (these are global)
    const playerImagesToLoad = {
        'duck_r': loadImage('characters/duck_r.png'),
        'duck_l': loadImage('characters/duck_l.png'),
        'duck_f': loadImage('characters/duck_f.png'),
    };
    const loadedPlayerImages = await Promise.all(Object.values(playerImagesToLoad));
    Object.keys(playerImagesToLoad).forEach((key, index) => {
        game.characters[key] = loadedPlayerImages[index];
    });
    player.image = game.characters.duck_l;
    player.width = player.image.width;
    player.height = player.image.height;

    const playerCollisionImg = await loadImage('collision/duck.png');
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = playerCollisionImg.width;
    offscreenCanvas.height = playerCollisionImg.height;
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    offscreenCtx.drawImage(playerCollisionImg, 0, 0);
    player.collisionMap = offscreenCtx.getImageData(0, 0, player.width, player.height);

    // 2. Load All Map Data
    const mapFiles = ['house1.tmj', 'outdoors1.tmj'];
    const mapResponses = await Promise.all(mapFiles.map(map => fetch(`maps/${map}`)));
    const mapJsonData = await Promise.all(mapResponses.map(res => res.json()));

    // Create map objects keyed by name (e.g., 'house1')
    mapFiles.forEach((fileName, index) => {
        const mapName = fileName.replace('.tmj', '');
        game.maps[mapName] = {
            mapData: mapJsonData[index],
            currentInteractable: null,
            backgroundLayer: null,
            collisionLayer: null,
            interactablesLayer: null,
            sortedForegroundObjects: [],
            topLayerObjects: [],
        };
    });

    // 3. Process All Maps to Find Layers and Load Assets
    const allAssetLoadPromises = [];
    const domParser = new DOMParser();

    for (const mapName in game.maps) {
        const map = game.maps[mapName];
        const mapData = map.mapData;

        // Find important layers for this specific map
        mapData.layers.forEach(layer => {
            if (layer.name === "Collision") map.collisionLayer = layer;
            if (layer.name === "Interactables") map.interactablesLayer = layer;
            if (layer.type === "imagelayer" && layer.name === "Background") map.backgroundLayer = layer;
            if (layer.name === "Top") map.topLayerObjects = layer.objects;
        });

        // Queue background image for loading
        if (map.backgroundLayer) {
            const bgPath = 'backgrounds/' + map.backgroundLayer.image;
            const bgPromise = loadImage(bgPath).then(img => {
                map.backgroundLayer.image = img;
            });
            allAssetLoadPromises.push(bgPromise);
        }

        // Fetch and parse all tilesets for this map
        for (const ts of mapData.tilesets) {
            const tsxPath = 'tilesets/' + ts.source;
            const response = await fetch(tsxPath);
            if (!response.ok) throw new Error(`Failed to fetch tileset: ${tsxPath}`);

            const tsxText = await response.text();
            const tsxDoc = domParser.parseFromString(tsxText, 'application/xml');
            const tileNodes = tsxDoc.querySelectorAll('tile');

            // Queue individual tile images for loading
            for (const tileNode of tileNodes) {
                const localId = parseInt(tileNode.getAttribute('id'), 10);
                const imageNode = tileNode.querySelector('image');
                if (!imageNode) continue;

                const imagePath = 'tilesets/' + imageNode.getAttribute('source');
                const gid = ts.firstgid + localId;

                // Only queue for loading if we haven't already loaded it
                if (!game.tileImages[gid]) {
                    const promise = loadImage(imagePath).then(img => {
                        game.tileImages[gid] = img; // Add to global cache
                    });
                    allAssetLoadPromises.push(promise);
                }
            }
        }
        
        // Prepare and sort foreground objects for this map
        const foregroundLayer = mapData.layers.find(l => l.name === "Foreground");
        if (foregroundLayer) {
            map.sortedForegroundObjects = foregroundLayer.objects.sort((a, b) => a.y - b.y);
        }
    }

    // 4. Wait for all images (backgrounds, tiles) to load before starting the game
    await Promise.all(allAssetLoadPromises);
}


// --- COLLISION & INTERACTION ---

/**
 * Checks for collision against the collision layer of the CURRENT map.
 * @param {number} playerX The player's target X coordinate.
 * @param {number} playerY The player's target Y coordinate.
 * @returns {boolean} True if a solid collision occurs.
 */
function checkWallCollision(playerX, playerY) {
    const currentMap = game.maps[player.location];
    if (!currentMap || !currentMap.collisionLayer) return false;

    for (let y = 0; y < player.height; y++) {
        for (let x = 0; x < player.width; x++) {
            const playerPixelIndex = (y * player.width + x) * 4;
            if (player.collisionMap.data[playerPixelIndex + 3] === 0) {
                continue;
            }

            const mapX = Math.round(playerX + x);
            const mapY = Math.round(playerY + y);

            if (mapX < 0 || mapX >= currentMap.collisionLayer.width || mapY < 0 || mapY >= currentMap.collisionLayer.height) {
                return true; // Collision with map boundaries
            }

            const tileIndex = mapY * currentMap.collisionLayer.width + mapX;
            if (currentMap.collisionLayer.data[tileIndex] !== 0) {
                return true;
            }
        }
    }
    return false;
}


/**
 * Simplistic bounding-box collision detection for interactable objects.
 */
function checkInteractables() {
    const p = player;
    const currentMap = game.maps[p.location];
    if (!currentMap || !currentMap.interactablesLayer) {
        if (currentMap) currentMap.currentInteractable = null;
        return;
    }

    for (const obj of currentMap.interactablesLayer.objects) {
        if (p.x < obj.x + obj.width &&
            p.x + p.width > obj.x &&
            p.y < obj.y + obj.height &&
            p.y + p.height > obj.y) {
                currentMap.currentInteractable = obj;
                return;
        }
    }
    currentMap.currentInteractable = null;
}

/**
 * Helper to turn a Tiled object's properties array into a KV map.
 */
function getProperties(obj) {
    if (!obj.properties) return null;
    return Object.fromEntries(obj.properties.map(p => [p.name, p.value]));
}

// --- GAME LOGIC & DRAWING ---

/**
 * Updates the camera position to follow the player, clamped to map boundaries.
 */
function updateCamera() {
    const currentMap = game.maps[player.location];
    if (!currentMap) return;

    const mapWidth = currentMap.mapData.width * currentMap.mapData.tilewidth;
    const mapHeight = currentMap.mapData.height * currentMap.mapData.tileheight;

    if (mapWidth <= camera.width && mapHeight <= camera.height)
        return;

    const x = (player.x + player.width / 2) - camera.width / 2;
    const y = (player.y + player.height / 2) - camera.height / 2;

    camera.x = Math.max(0, Math.min(x, mapWidth - camera.width)); // clamp [0, mapWidth - camera.width]
    camera.y = Math.max(0, Math.min(y, mapHeight - camera.height)); // clamp [0, mapHeight - camera.height]
}

const undef = (obj) => obj === null || obj === undefined;

function verifyInteractable(interactable) {
    const { type, destinationX, destinationY, destinationMap, reboundTime } = interactable;

    if (type === 'door') {
        if (undef(destinationMap)) {
            console.warn(`Door missing \`destinationMap\` field.`);
            return false;
        }
        if (!game.maps[destinationMap]) {
            console.warn(`Door destination map "${destinationMap}" not found.`);
            return false;
        }
    }
    if (type === 'moveRebound') {
        if (undef(reboundTime)) {
            console.warn(`Interactable missing \`reboundTime\` field.`);
            return false;
        }
        if (typeof reboundTime !== 'number') {
            console.warn(`Interactable \`reboundTime\` must be a number.`);
            return false;
        }
    }
    if (undef(destinationX)) {
        console.warn(`Interactable missing \`destinationX\` field${type === 'door' ? ` for "${destinationMap}"` : ''}.`);
        return false;
    }
    if (undef(destinationY)) {
        console.warn(`Interactable missing \`destinationY\` field${type === 'door' ? ` for "${destinationMap}"` : ''}.`);
        return false;
    }
    if (typeof destinationX !== 'number') {
        console.warn(`Interactable \`destinationX\` must be a number.`);
        return false;
    }
    if (typeof destinationY !== 'number') {
        console.warn(`Interactable \`destinationY\` must be a number.`);
        return false;
    }
    return true;
}

function updatePlayerPosition() {
    const currentMap = game.maps[player.location];
    if (!currentMap) return;

    checkInteractables();

    // We will early return on any route that moves the character to prevent physics bugs on the same frame
    if (keysPressed.space && currentMap.currentInteractable) {
        keysPressed.space = 0;
        const interactable = getProperties(currentMap.currentInteractable);
        const type = interactable.type;

        if (!verifyInteractable(interactable))
            return;

        if (type === 'door') {
            player.location = interactable.destinationMap;
            player.x = interactable.destinationX;
            player.y = interactable.destinationY;
            player.xVel = 0;
            player.yVel = 0;
        } else if (type === 'move') {
            player.x = interactable.destinationX;
            player.y = interactable.destinationY;
        } else if (type === 'moveRebound') {
            const oldX = player.x;
            const oldY = player.y;

            player.x = interactable.destinationX;
            player.y = interactable.destinationY;

            setTimeout(() => {
                player.x = oldX;
                player.y = oldY;
                player.xVel = 0;
                player.yVel = 0;
            }, interactable.reboundTime);
        }
        else {
            console.warn(`Unknown interactable type: ${type}`);
        }
        updateCamera();
        return;
    }

    // Vertical movement
    if (keysPressed.up && (keysPressed.down != 2))
        player.yVel = Math.max(player.yVel - player.acc, -player.terminalVel);
    else if (keysPressed.down && (keysPressed.up != 2))
        player.yVel = Math.min(player.yVel + player.acc, player.terminalVel);
    else
        player.yVel = 0;

    const newY = player.y + player.yVel;
    if (!checkWallCollision(player.x, newY))
        player.y = newY;

    // Horizontal movement
    if (keysPressed.left && (keysPressed.right != 2)) {
        player.xVel = Math.max(player.xVel - player.acc, -player.terminalVel);
        if (player.facing !== 'left') {
            player.image = game.characters.duck_l;
            player.facing = 'left';
        }
    } else if (keysPressed.right && (keysPressed.left != 2)) {
        player.xVel = Math.min(player.xVel + player.acc, player.terminalVel);
        if (player.facing !== 'right') {
            player.image = game.characters.duck_r;
            player.facing = 'right';
        }
    } else
        player.xVel = 0;
    
    const newX = player.x + player.xVel;
    if (!checkWallCollision(newX, player.y))
        player.x = newX;

    updateCamera(); 
}

/**
 * Draws the scene for the CURRENT map, handling Y-sorting.
 */
function drawSceneAndEntities() {
    const currentMap = game.maps[player.location];
    if (!currentMap) return;

    if (currentMap.backgroundLayer && currentMap.backgroundLayer.image) {
        ctx.drawImage(currentMap.backgroundLayer.image, -camera.x, -camera.y);
    }

    const playerBaseY = player.y + player.height - 1;
    let playerDrawn = false;

    for (const obj of currentMap.sortedForegroundObjects) {
        if (!playerDrawn && playerBaseY < obj.y) {
            const drawX = Math.round(player.x - camera.x);
            const drawY = Math.round(player.y - camera.y);
            ctx.drawImage(player.image, drawX, drawY, player.width, player.height);
            playerDrawn = true;
        }
        
        const tileImage = game.tileImages[obj.gid];
        if (tileImage) {
            const drawY = obj.y - obj.height;
            const width = tileImage.width || obj.width;
            const height = tileImage.height || obj.height;
            ctx.drawImage(tileImage, obj.x - camera.x, drawY - camera.y, width, height);
        }
    }
    
    if (!playerDrawn) {
        ctx.drawImage(player.image, Math.round(player.x - camera.x), Math.round(player.y - camera.y), player.width, player.height);
    }

    for (const obj of currentMap.topLayerObjects) {
        const tileImage = game.tileImages[obj.gid];
        if (tileImage) {
            const width = tileImage.width || obj.width;
            const height = tileImage.height || obj.height;
            const drawY = obj.y - height;
            ctx.drawImage(tileImage, obj.x - camera.x, drawY - camera.y, width, height);
        }
    }
}

function gameLoop() {
    updatePlayerPosition();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSceneAndEntities();
    requestAnimationFrame(gameLoop);
}


// --- EVENT LISTENERS & GAME START ---

document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'w') {
        if (keysPressed.down) keysPressed.down = 1;
        keysPressed.up = 2;
    } else if (event.key === 'ArrowDown' || event.key === 's') {
        if (keysPressed.up) keysPressed.up = 1;
        keysPressed.down = 2;
    } else if (event.key === 'ArrowLeft' || event.key === 'a') {
        if (keysPressed.right) keysPressed.right = 1;
        keysPressed.left = 2;
    } else if (event.key === 'ArrowRight' || event.key === 'd') {
        if (keysPressed.left) keysPressed.left = 1;
        keysPressed.right = 2;
    } else if (event.key === ' ')
        keysPressed.space = 1;
});

document.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'w') keysPressed.up = 0;
    else if (event.key === 'ArrowDown' || event.key === 's') keysPressed.down = 0;
    else if (event.key === 'ArrowLeft' || event.key === 'a') keysPressed.left = 0;
    else if (event.key === 'ArrowRight' || event.key === 'd') keysPressed.right = 0;
    else if (event.key === ' ') keysPressed.space = 0;
});


canvas.style.display = 'none';
const startButton = document.getElementById('start-button');

startButton.addEventListener('click', async () => {
    startButton.textContent = 'Loading...';
    startButton.disabled = true;

    player.x = 77;
    player.y = 42;
    player.facing = 'left';
    player.location = 'house1';

    try {
        await loadAssets();
        startButton.style.display = 'none';
        canvas.style.display = 'block';
        gameLoop();
    } catch (error) {
        console.error("Failed to load game assets:", error);
        startButton.textContent = 'Error! Check console.';
    }
});