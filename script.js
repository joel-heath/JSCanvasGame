const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');

const player = {
    x: 77,
    y: 45,
    xVel: 0,
    yVel: 0,
    acc: 1,
    terminalVel: 1,
    facing: -1
};

const keysPressed = {
    up: 0,
    down: 0,
    left: 0,
    right: 0
};

const collisionState = {
    wall: false,
    door: false,
    interact1: false,
    interact2: false
};

const locations = {};
const backgrounds = {};
const characters = {};
const collision = {};

function assignCollisionMapData(collisionMaps) {
    const offscreenCanvas = document.createElement('canvas');
    //offscreenCanvas.style.display = 'hidden';

    for (const [prop, image] of Object.entries(collisionMaps)) {
        offscreenCanvas.width = image.width;
        offscreenCanvas.height = image.height;
        const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
        offscreenCtx.drawImage(image, 0, 0);

        collision[prop] = offscreenCtx.getImageData(0, 0, image.width, image.height);
    }
}

function loadImages() {
    const collisionMaps = {};
    return new Promise((resolve, reject) => {
        const bgNames = ['interior_house1', 'interior_house1_foreground', 'outside'];
        const charNames = ['duck_r', 'duck_l', 'duck_f'];
        const collisionNames = ['duck', 'interior_house1', 'outside'];
        const totalImages = bgNames.length + charNames.length + collisionNames.length;
        let loadedImagesCount = 0;

        const handleImageLoad = () => {
            loadedImagesCount++;
            if (loadedImagesCount === totalImages) {
                assignCollisionMapData(collisionMaps);
                resolve();
            }
        };

        const loadImageSet = (names, folder, storage) => {
            names.forEach(name => {
                const img = new Image();
                img.src = `${folder}/${name}.png`;
                img.onload = handleImageLoad;
                img.onerror = () => reject(new Error(`Failed to load image: ${img.src}`));
                storage[name] = img;
            });
        };

        loadImageSet(bgNames, 'backgrounds', backgrounds);
        loadImageSet(charNames, 'characters', characters);
        loadImageSet(collisionNames, 'collision', collisionMaps);
    });
}

loadImages().then(() => {
    player.image = characters['duck_l'];
    player.width = player.image.width;
    player.height = player.image.height;
    player.collisionMap = collision['duck'];

    locations['interior_house1'] = {
        name: 'interior_house1',
        background: backgrounds['interior_house1'],
        foreground: backgrounds['interior_house1_foreground'],
        collision: collision['interior_house1'],
        playerStart: { x: 23, y: 55 }
    };

    locations['outside'] = {
        name: 'outside',
        background: backgrounds['outside'],
        foreground: undefined,
        collision: collision['outside'],
        playerStart: { x: 23, y: 8 }
    };

    player.location = locations['interior_house1'];

    //gameLoop();
});


document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'w') {
        if (keysPressed.down)
            keysPressed.down = 1;
        keysPressed.up = 2;
    } else if (event.key === 'ArrowDown' || event.key === 's') {
        if (keysPressed.up)
            keysPressed.up = 1;
        keysPressed.down = 2;
    } else if (event.key === 'ArrowLeft' || event.key === 'a') {
        if (keysPressed.right)
            keysPressed.right = 1;
        keysPressed.left = 2;
    } else if (event.key === 'ArrowRight' || event.key === 'd') {
        if (keysPressed.left)
            keysPressed.left = 1;
        keysPressed.right = 2;
    }
    if (event.key === ' ')
        keysPressed.space = 1;
});

document.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'w') {
        keysPressed.up = 0;
    } else if (event.key === 'ArrowDown' || event.key === 's') {
        keysPressed.down = 0;
    } else if (event.key === 'ArrowLeft' || event.key === 'a') {
        keysPressed.left = 0;
    } else if (event.key === 'ArrowRight' || event.key === 'd') {
        keysPressed.right = 0;
    }
    if (event.key === ' ')
        keysPressed.space = 0;
});


class PixelType {
    static collision = new Uint8ClampedArray([255, 255, 255, 255]);
    static door = new Uint8ClampedArray([0, 255, 0, 255]);
    static interact1 = new Uint8ClampedArray([0, 0, 255, 255]);
    static interact2 = new Uint8ClampedArray([0, 255, 255, 255]);

    static pixelMatch(collisionMap, i, pixelType) {
        return collisionMap[i]     === pixelType[0] && // R
               collisionMap[i + 1] === pixelType[1] && // G
               collisionMap[i + 2] === pixelType[2] && // B
               collisionMap[i + 3] === pixelType[3];   // A
    }
}


function checkCollision(playerX, playerY, player, bgCollision) {
    collisionState.door = false;
    collisionState.interact1 = false;
    collisionState.interact2 = false;
    collisionState.collision = false;

    for (let y = 0, i = 0; y < player.height; y++) {
        for (let x = 0; x < player.width; x++, i += 4) {
            const playerCollision = player.collisionMap.data;
            const collides = PixelType.pixelMatch(playerCollision, i, PixelType.collision);

            if (!collides) continue;

            const bgX = playerX + x,
                  bgY = playerY + y,
                  bgI = (bgY * bgCollision.width + bgX) * 4;

            if (PixelType.pixelMatch(bgCollision.data, bgI, PixelType.door))
                collisionState.door = true;
            else if (PixelType.pixelMatch(bgCollision.data, bgI, PixelType.interact1))
                collisionState.interact1 = true;
            else if (PixelType.pixelMatch(bgCollision.data, bgI, PixelType.interact2))
                collisionState.interact2 = true;

            else if (bgX < 0 || bgX >= bgCollision.width ||
                bgY < 0 || bgY >= bgCollision.height || 
                PixelType.pixelMatch(bgCollision.data, bgI, PixelType.collision)) {
                collisionState.collision = true;
                return true;
            }
        }
    }

    return false;
}

function updatePlayerPosition(collisionMap) {
    if (keysPressed.up && (keysPressed.down != 2))
        player.yVel = Math.max(player.yVel - player.acc, -player.terminalVel);
    if (keysPressed.down && (keysPressed.up != 2))
        player.yVel = Math.min(player.yVel + player.acc, player.terminalVel);
    if (!keysPressed.up && !keysPressed.down)
        player.yVel = 0;

    const newY = Math.round(player.y + player.yVel);
    if (!checkCollision(player.x, newY, player, collisionMap)) {
        player.y = newY;
    }

    if (keysPressed.left && (keysPressed.right != 2)) {
        player.xVel = Math.max(player.xVel - player.acc, -player.terminalVel);
        player.image = characters['duck_l'];
    }
    if (keysPressed.right && (keysPressed.left != 2)) {
        player.xVel = Math.min(player.xVel + player.acc, player.terminalVel);
        player.image = characters['duck_r'];
    }
    if (!keysPressed.left && !keysPressed.right)
        player.xVel = 0;

    const newX = Math.round(player.x + player.xVel);

    if (!checkCollision(newX, player.y, player, collisionMap)) {
        player.x = newX;
    }

    if (keysPressed.space && collisionState.door) {
        keysPressed.space = 0;
        player.location = player.location.name === 'interior_house1' ? locations['outside'] : locations['interior_house1'];
        player.x = player.location.playerStart.x;
        player.y = player.location.playerStart.y;
    }

    if (keysPressed.space && collisionState.interact1) {
        keysPressed.space = 0;
        player.y -= 10;
        player.image = characters['duck_f'];
        setTimeout(() => {
            player.y += 10;
        }, 2000);
    }

    if (keysPressed.space && collisionState.interact2) {
        keysPressed.space = 0;
        player.x += 10;
        player.image = characters['duck_f'];
        setTimeout(() => {
            player.x -= 10;
        }, 2000);
    }
}

function gameLoop() {
    updatePlayerPosition(player.location.collision);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(player.location.background, 0, 0);

    ctx.drawImage(player.image, player.x, player.y, player.width, player.height);
    if (player.location.foreground) {
        //ctx.drawImage(player.location.foreground, 0, player.y, canvas.width, canvas.height - player.height, 0, player.y, canvas.width, canvas.height - player.height);
        ctx.drawImage(player.location.foreground, 0, 0, canvas.width, canvas.height);
    }

    requestAnimationFrame(gameLoop);
}

canvas.style.display = 'none';
const startButton = document.getElementById('start-button');
startButton.addEventListener('click', () => {
    startButton.style.display = 'none';
    canvas.style.display = 'block';
    gameLoop();
});