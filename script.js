const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');

const player = {
    x: 77,
    y: 45,
    xVel: 0,
    yVel: 0,
    acc: 1,
    terminalVel: 1,
    facing: 'left',
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
    map: null,
    tileImages: {}, // Maps a GID to its loaded image
    characters: {},
    currentInteractable: null,
    backgroundLayer: null,
    collisionLayer: null,
    interactablesLayer: null,
    // Holds foreground objects, sorted by Y-position for depth sorting
    sortedForegroundObjects: [],
    topLayerObjects: [], // For objects that should always be drawn on top
};

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
 * Loads the Tiled map and all associated assets by parsing the .tsx files.
 */
async function loadAssets() {
    // 1. Fetch Tiled map JSON
    const mapResponse = await fetch('maps/house1.tmj');
    game.map = await mapResponse.json();

    // 2. Load player assets
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

    // 3. Find important layers
    game.map.layers.forEach(layer => {
        if (layer.name === "Collision") game.collisionLayer = layer;
        if (layer.name === "Interactables") game.interactablesLayer = layer;
        if (layer.type === "imagelayer" && layer.name === "Background") game.backgroundLayer = layer;
        if (layer.name === "Top") game.topLayerObjects = layer.objects;
    });

    // 4. Load background image and all individual tiles from the .tsx files
    const bgPath = 'backgrounds/' + game.backgroundLayer.image;
    const imageLoadPromises = [loadImage(bgPath)];
    const domParser = new DOMParser();
    
    for (const ts of game.map.tilesets) {
        const tsxPath = 'tilesets/' + ts.source;
        const response = await fetch(tsxPath);
        if (!response.ok) throw new Error(`Failed to fetch tileset: ${tsxPath}`);
        
        const tsxText = await response.text();
        const tsxDoc = domParser.parseFromString(tsxText, 'application/xml');
        const tileNodes = tsxDoc.querySelectorAll('tile');

        for (const tileNode of tileNodes) {
            const localId = parseInt(tileNode.getAttribute('id'), 10);
            const imageNode = tileNode.querySelector('image');
            if (!imageNode) continue;
            
            const imagePath = 'tilesets/' + imageNode.getAttribute('source'); 
            const gid = ts.firstgid + localId;

            const promise = loadImage(imagePath).then(img => {
                game.tileImages[gid] = img;
            });
            imageLoadPromises.push(promise);
        }
    }

    const [bgImage] = await Promise.all(imageLoadPromises);
    game.backgroundLayer.image = bgImage;

    // 5. Prepare foreground objects for depth sorting
    prepareForeground();
}

/**
 * Gets all foreground objects and sorts them by their Y-position.
 * This is done once at load time for performance.
 */
function prepareForeground() {
    const foregroundLayer = game.map.layers.find(l => l.name === "Foreground");
    if (!foregroundLayer) return;

    // Sort objects by their bottom Y-coordinate (obj.y in Tiled)
    game.sortedForegroundObjects = foregroundLayer.objects.sort((a, b) => a.y - b.y);
}


// --- COLLISION & INTERACTION ---

const TILE_ID = {
    EMPTY: 0,
    WALL: 18,
};

/**
 * A smarter collision check that allows the player's upper body to pass under "overhangs".
 * This single function replaces the previous two and fixes the "getting stuck" bug.
 * @param {number} playerX The player's target X coordinate.
 * @param {number} playerY The player's target Y coordinate.
 * @returns {boolean} True if a solid, non-ignorable collision occurs.
 */
function checkWallCollision(playerX, playerY) {
    for (let y = 0; y < player.height; y++) {
        for (let x = 0; x < player.width; x++) {
            // Skip transparent pixels on the player's own mask
            const playerPixelIndex = (y * player.width + x) * 4;
            if (player.collisionMap.data[playerPixelIndex + 3] === 0) {
                continue;
            }

            // Find the world coordinate of this player pixel
            const mapX = Math.round(playerX + x);
            const mapY = Math.round(playerY + y);

            if (mapX < 0 || mapX >= game.collisionLayer.width || mapY < 0 || mapY >= game.collisionLayer.height) {
                return true;
            }

            const tileIndex = mapY * game.collisionLayer.width + mapX;
            if (game.collisionLayer.data[tileIndex] === TILE_ID.WALL)
                return true;
        }
    }
    return false; // No collision found
}


/**
 * Checks if the player is overlapping with any interactable objects.
 */
function checkInteractables() {
    const p = player;
    for (const obj of game.interactablesLayer.objects) {
        if (p.x < obj.x + obj.width &&
            p.x + p.width > obj.x &&
            p.y < obj.y + obj.height &&
            p.y + p.height > obj.y) {
            game.currentInteractable = obj;
            return;
        }
    }
    game.currentInteractable = null;
}

/**
 * Helper to safely get a custom property value from a Tiled object.
 */
function getProperty(obj, propName) {
    if (!obj.properties) return null;
    const prop = obj.properties.find(p => p.name === propName);
    return prop ? prop.value : null;
}


// --- GAME LOGIC & DRAWING ---

function updatePlayerPosition() {
    // 1. Check for interactions
    checkInteractables();

    // 2. Handle player input for interactions
    if (keysPressed.space && game.currentInteractable) {
        keysPressed.space = 0;
        const type = getProperty(game.currentInteractable, 'type');

        if (type === 'door') {
            const destination = getProperty(game.currentInteractable, 'destination');
            console.log(`Player activated a door to: ${destination}`);
        } else if (type === 'move') {
            player.x = getProperty(game.currentInteractable, 'destination_x');
            player.y = getProperty(game.currentInteractable, 'destination_y');
        }
    }

    // 3. Calculate vertical movement
    if (keysPressed.up && (keysPressed.down != 2))
        player.yVel = Math.max(player.yVel - player.acc, -player.terminalVel);
    else if (keysPressed.down && (keysPressed.up != 2))
        player.yVel = Math.min(player.yVel + player.acc, player.terminalVel);
    else
        player.yVel = 0;

    const newY = player.y + player.yVel;
    if (!checkWallCollision(player.x, newY)) {
        player.y = newY;
    }

    // 4. Calculate horizontal movement
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

    if (!checkWallCollision(newX, player.y)) {
        player.x = newX;
    }
}

/**
 * Draws the scene and handles Y-sorting for player and foreground objects.
 */
function drawSceneAndEntities() {
    if (game.backgroundLayer && game.backgroundLayer.image) {
        ctx.drawImage(game.backgroundLayer.image, 0, 0);
    }

    const playerBaseY = player.y + player.height - 1; // -1 for shadow
    let playerDrawn = false;

    for (const obj of game.sortedForegroundObjects) {
        if (!playerDrawn && playerBaseY < obj.y) {
            ctx.drawImage(player.image, Math.round(player.x), Math.round(player.y), player.width, player.height);
            playerDrawn = true;
        }
        
        const tileImage = game.tileImages[obj.gid];
        if (tileImage) {
            const drawY = obj.y - obj.height; // Adjust for Tiled's coordinate system
            const width = tileImage.width || obj.width;
            const height = tileImage.height || obj.height;
            ctx.drawImage(tileImage, obj.x, drawY, width, height);
        }
    }
    
    if (!playerDrawn) {
        ctx.drawImage(player.image, Math.round(player.x), Math.round(player.y), player.width, player.height);
    }

    for (const obj of game.topLayerObjects) {
        const tileImage = game.tileImages[obj.gid];
        if (tileImage) {
            const width = tileImage.width || obj.width;
            const height = tileImage.height || obj.height;
            const drawY = obj.y - height;
            ctx.drawImage(tileImage, obj.x, drawY, width, height);
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
    }
    if (event.key === ' ')
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

    try {
        await loadAssets();
        player.x = 23;
        player.y = 55;

        startButton.style.display = 'none';
        canvas.style.display = 'block';
        gameLoop();
    } catch (error) {
        console.error("💥 Failed to load game assets:", error);
        startButton.textContent = 'Error! Check console.';
    }
});