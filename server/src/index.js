const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CLIENT_DIR = path.resolve(__dirname, '../../client');

app.use(express.static(CLIENT_DIR));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, now: Date.now() });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

const CONSTANTS = {
  ARENA_WIDTH: 1400,
  ARENA_HEIGHT: 900,
  TICK_RATE_MS: 50,
  ROUND_DURATION_MS: 90000,
  RESPAWN_DELAY_MS: 3000,
  PLAYER_SPEED: 240,
  DASH_SPEED: 620,
  DASH_DURATION_MS: 150,
  DASH_COOLDOWN_MS: 1800,
  ATTACK_RANGE: 82,
  ATTACK_DAMAGE: 22,
  ATTACK_COOLDOWN_MS: 400,
  ELEMENT_COOLDOWN_MS: 5000,
  ELEMENT_BASE_DAMAGE: 28,
  ELEMENT_RADIUS: 105,
  ELEMENT_LIFE_MS: 1200,
  HAZARD_DAMAGE_PER_SECOND: 24,
  MAX_HEALTH: 100,
  KILL_HEAL: 14,
  MAX_RANK: 99,
  BOT_TARGET_TOTAL: 4,
  POWERUP_RADIUS: 20,
  POWERUP_RESPAWN_MS: 12000,
  POWERUP_BOOST_MS: 8000,
  BOOST_MULTIPLIER: 1.15,
  WIN_AURA_MAX: 20,
  HAZARD_RADIUS: 95,
  SPAWN_MARGIN: 90,
};

const CLASS_DEFS = {
  Earth: {
    color: 0x9d7a53,
    accent: 0x5d472f,
    elementName: 'Earthquake',
    elementColor: 0xb58a63
  },
  Fire: {
    color: 0xe8613c,
    accent: 0x9b2a1b,
    elementName: 'Meteor',
    elementColor: 0xff813f
  },
  Wind: {
    color: 0x70d7d4,
    accent: 0x2e7f8d,
    elementName: 'Tornado',
    elementColor: 0x8bf3ff
  },
  Water: {
    color: 0x4b7dff,
    accent: 0x1f4eb7,
    elementName: 'Ice Spike',
    elementColor: 0x7db5ff
  }
};

const COSMETIC_DEFS = {
  stripe: { accentRadius: 6 },
  spikes: { accentRadius: 10 },
  halo: { accentRadius: 4 }
};

const BOT_PRESETS = {
  easy: { aimError: 0.6, attackDistance: 62, elementDistance: 130, reactionChance: 0.45 },
  normal: { aimError: 0.3, attackDistance: 72, elementDistance: 155, reactionChance: 0.7 },
  hard: { aimError: 0.12, attackDistance: 80, elementDistance: 175, reactionChance: 0.9 }
};

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSpawn() {
  return {
    x: rand(CONSTANTS.SPAWN_MARGIN, CONSTANTS.ARENA_WIDTH - CONSTANTS.SPAWN_MARGIN),
    y: rand(CONSTANTS.SPAWN_MARGIN, CONSTANTS.ARENA_HEIGHT - CONSTANTS.SPAWN_MARGIN)
  };
}

function sanitizeName(name) {
  const clean = String(name || 'Player')
    .replace(/[^\w \-]/g, '')
    .trim()
    .slice(0, 18);
  return clean || 'Player';
}

function sanitizeClass(className) {
  return CLASS_DEFS[className] ? className : 'Earth';
}

function sanitizeCosmetic(cosmetic) {
  return COSMETIC_DEFS[cosmetic] ? cosmetic : 'stripe';
}

function sanitizeDifficulty(diff) {
  return BOT_PRESETS[diff] ? diff : 'normal';
}

function createAppearance(className, cosmetic, existing = {}) {
  return {
    cosmetic,
    tint: existing.tint || CLASS_DEFS[className].color,
    winAuraLevel: clamp(existing.winAuraLevel || 0, 0, CONSTANTS.WIN_AURA_MAX)
  };
}

function computeRank(totalKills) {
  return clamp(1 + Math.floor((totalKills || 0) / 3), 1, CONSTANTS.MAX_RANK);
}

function generateRoomCode() {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createPlayer(id, profile, isBot = false, botDifficulty = 'normal') {
  const className = sanitizeClass(profile.className);
  const cosmetic = sanitizeCosmetic(profile.cosmetic);
  const spawn = randomSpawn();
  const totalKills = Math.max(0, Number(profile.totalKills) || 0);
  const wins = Math.max(0, Number(profile.wins) || 0);

  return {
    id,
    name: sanitizeName(profile.name),
    className,
    classMeta: CLASS_DEFS[className],
    appearance: createAppearance(className, cosmetic, {
      tint: profile.tint,
      winAuraLevel: profile.winAuraLevel || wins
    }),
    isBot,
    botDifficulty: sanitizeDifficulty(botDifficulty),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    hp: CONSTANTS.MAX_HEALTH,
    alive: true,
    respawnAt: 0,
    score: 0,
    totalKills,
    rank: computeRank(totalKills),
    wins,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      dash: false,
      attack: false,
      special: false,
      angle: 0,
      specialTargetX: spawn.x,
      specialTargetY: spawn.y
    },
    lastDashAt: 0,
    dashingUntil: 0,
    lastAttackAt: 0,
    lastSpecialAt: 0,
    boostUntil: 0,
  };
}

function createRoom(hostSocketId, profile, botDifficulty) {
  const code = generateRoomCode();
  const host = createPlayer(hostSocketId, profile, false, botDifficulty);
  const room = {
    code,
    hostSocketId,
    phase: 'lobby',
    startedAt: 0,
    endsAt: 0,
    botDifficulty: sanitizeDifficulty(botDifficulty),
    players: new Map([[hostSocketId, host]]),
    hazard: {
      x: CONSTANTS.ARENA_WIDTH / 2,
      y: CONSTANTS.ARENA_HEIGHT / 2,
      radius: CONSTANTS.HAZARD_RADIUS,
    },
    powerUp: {
      active: true,
      position: randomSpawn(),
      radius: CONSTANTS.POWERUP_RADIUS,
      nextSpawnAt: 0
    },
    elementZones: []
  };
  rooms.set(code, room);
  return room;
}

function getHumanPlayers(room) {
  return Array.from(room.players.values()).filter((p) => !p.isBot);
}

function getPlayersArray(room) {
  return Array.from(room.players.values());
}

function removeLobbyBots(room) {
  for (const [id, player] of room.players.entries()) {
    if (player.isBot) {
      room.players.delete(id);
    }
  }
}

function addBotsToRoom(room) {
  removeLobbyBots(room);
  const needed = Math.max(0, CONSTANTS.BOT_TARGET_TOTAL - room.players.size);
  const classes = Object.keys(CLASS_DEFS);
  const cosmetics = Object.keys(COSMETIC_DEFS);

  for (let i = 0; i < needed; i++) {
    const botId = `bot_${room.code}_${Date.now()}_${i}_${Math.floor(Math.random() * 9999)}`;
    const profile = {
      name: `Bot ${i + 1}`,
      className: randomChoice(classes),
      cosmetic: randomChoice(cosmetics)
    };
    const bot = createPlayer(botId, profile, true, room.botDifficulty);
    room.players.set(botId, bot);
  }
}

function resetPlayerForMatch(player) {
  const spawn = randomSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.hp = CONSTANTS.MAX_HEALTH;
  player.alive = true;
  player.respawnAt = 0;
  player.score = 0;
  player.input.attack = false;
  player.input.special = false;
  player.input.dash = false;
  player.lastAttackAt = 0;
  player.lastSpecialAt = 0;
  player.lastDashAt = 0;
  player.dashingUntil = 0;
  player.boostUntil = 0;
  player.rank = computeRank(player.totalKills);
  player.appearance.winAuraLevel = clamp(player.appearance.winAuraLevel, 0, CONSTANTS.WIN_AURA_MAX);
}

function startMatch(room) {
  addBotsToRoom(room);
  room.phase = 'playing';
  room.startedAt = Date.now();
  room.endsAt = room.startedAt + CONSTANTS.ROUND_DURATION_MS;
  room.elementZones = [];
  room.powerUp.active = true;
  room.powerUp.position = randomSpawn();
  room.powerUp.nextSpawnAt = 0;

  for (const player of room.players.values()) {
    resetPlayerForMatch(player);
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distXY(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function respawnPlayer(player) {
  const spawn = randomSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.hp = CONSTANTS.MAX_HEALTH;
  player.alive = true;
  player.respawnAt = 0;
}

function markDead(player, now) {
  player.alive = false;
  player.hp = 0;
  player.vx = 0;
  player.vy = 0;
  player.respawnAt = now + CONSTANTS.RESPAWN_DELAY_MS;
}

function registerKill(room, killerId, victimId, now) {
  if (!room.players.has(killerId) || !room.players.has(victimId) || killerId === victimId) {
    return;
  }
  const killer = room.players.get(killerId);
  const victim = room.players.get(victimId);
  if (!killer || !victim) return;
  if (!victim.alive) return;

  markDead(victim, now);
  killer.score += 1;
  killer.totalKills += 1;
  killer.rank = computeRank(killer.totalKills);
  killer.hp = clamp(killer.hp + CONSTANTS.KILL_HEAL, 0, CONSTANTS.MAX_HEALTH);
}

function applyDamage(room, target, amount, ownerId, now) {
  if (!target.alive) return false;
  target.hp -= amount;
  if (target.hp <= 0) {
    if (ownerId && room.players.has(ownerId) && ownerId !== target.id) {
      registerKill(room, ownerId, target.id, now);
    } else {
      markDead(target, now);
    }
    return true;
  }
  return false;
}

function botThink(room, bot, now) {
  const preset = BOT_PRESETS[bot.botDifficulty] || BOT_PRESETS.normal;
  const enemies = getPlayersArray(room).filter((p) => p.id !== bot.id && p.alive);
  if (!bot.alive || enemies.length === 0) {
    bot.input.up = false;
    bot.input.down = false;
    bot.input.left = false;
    bot.input.right = false;
    bot.input.attack = false;
    bot.input.special = false;
    bot.input.dash = false;
    return;
  }

  let nearest = enemies[0];
  let nearestDist = distance(bot, nearest);
  for (const enemy of enemies.slice(1)) {
    const d = distance(bot, enemy);
    if (d < nearestDist) {
      nearest = enemy;
      nearestDist = d;
    }
  }

  if (Math.random() > preset.reactionChance) {
    bot.input.up = false;
    bot.input.down = false;
    bot.input.left = false;
    bot.input.right = false;
    bot.input.attack = false;
    bot.input.special = false;
    bot.input.dash = false;
    return;
  }

  const angle = Math.atan2(nearest.y - bot.y, nearest.x - bot.x);
  const noisyAngle = angle + ((Math.random() * 2 - 1) * preset.aimError);

  bot.input.left = nearest.x < bot.x - 10;
  bot.input.right = nearest.x > bot.x + 10;
  bot.input.up = nearest.y < bot.y - 10;
  bot.input.down = nearest.y > bot.y + 10;
  bot.input.angle = noisyAngle;
  bot.input.specialTargetX = clamp(nearest.x + Math.cos(noisyAngle) * 18, 0, CONSTANTS.ARENA_WIDTH);
  bot.input.specialTargetY = clamp(nearest.y + Math.sin(noisyAngle) * 18, 0, CONSTANTS.ARENA_HEIGHT);

  bot.input.dash = nearestDist > 180 && (now - bot.lastDashAt >= CONSTANTS.DASH_COOLDOWN_MS);
  bot.input.attack = nearestDist <= preset.attackDistance && (now - bot.lastAttackAt >= CONSTANTS.ATTACK_COOLDOWN_MS);
  bot.input.special = nearestDist <= preset.elementDistance && (now - bot.lastSpecialAt >= CONSTANTS.ELEMENT_COOLDOWN_MS);
}

function serializePlayer(player, room) {
  return {
    id: player.id,
    name: player.name,
    className: player.className,
    classMeta: player.classMeta,
    appearance: player.appearance,
    isBot: player.isBot,
    botDifficulty: player.botDifficulty,
    x: Number(player.x.toFixed(2)),
    y: Number(player.y.toFixed(2)),
    vx: Number(player.vx.toFixed(2)),
    vy: Number(player.vy.toFixed(2)),
    hp: Number(player.hp.toFixed(2)),
    alive: player.alive,
    respawnAt: player.respawnAt,
    score: player.score,
    totalKills: player.totalKills,
    rank: player.rank,
    wins: player.wins,
    boostUntil: player.boostUntil,
    input: room.phase === 'playing'
      ? undefined
      : {
          angle: player.input.angle
        },
    dashReadyIn: Math.max(0, CONSTANTS.DASH_COOLDOWN_MS - (Date.now() - player.lastDashAt)),
    attackReadyIn: Math.max(0, CONSTANTS.ATTACK_COOLDOWN_MS - (Date.now() - player.lastAttackAt)),
    specialReadyIn: Math.max(0, CONSTANTS.ELEMENT_COOLDOWN_MS - (Date.now() - player.lastSpecialAt)),
  };
}

function roomSummary(room) {
  return {
    code: room.code,
    hostSocketId: room.hostSocketId,
    phase: room.phase,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    botDifficulty: room.botDifficulty,
    constants: CONSTANTS,
    hazard: room.hazard,
    powerUp: room.powerUp,
    elementZones: room.elementZones.map((zone) => ({ ...zone })),
    players: getPlayersArray(room).map((player) => serializePlayer(player, room)),
  };
}

function emitRoomUpdated(room) {
  io.to(room.code).emit('roomUpdated', roomSummary(room));
}

function emitMatchStarted(room) {
  io.to(room.code).emit('matchStarted', roomSummary(room));
}

function emitState(room) {
  io.to(room.code).emit('state', roomSummary(room));
}

function chooseNextHost(room) {
  const humans = getHumanPlayers(room);
  room.hostSocketId = humans.length ? humans[0].id : null;
}

function cleanupRoomIfEmpty(room) {
  const humans = getHumanPlayers(room);
  if (humans.length === 0) {
    rooms.delete(room.code);
    return true;
  }
  return false;
}

function leaveRoomForSocket(socketId) {
  for (const [code, room] of rooms.entries()) {
    if (!room.players.has(socketId)) continue;

    room.players.delete(socketId);
    if (room.hostSocketId === socketId) {
      chooseNextHost(room);
    }
    if (cleanupRoomIfEmpty(room)) {
      return;
    }
    if (room.phase === 'lobby') {
      removeLobbyBots(room);
    }
    emitRoomUpdated(room);
    return;
  }
}

function processMovement(room, player, now) {
  const input = player.input;
  let moveX = 0;
  let moveY = 0;
  if (input.left) moveX -= 1;
  if (input.right) moveX += 1;
  if (input.up) moveY -= 1;
  if (input.down) moveY += 1;

  const boosted = player.boostUntil > now;
  let speed = boosted ? CONSTANTS.PLAYER_SPEED * CONSTANTS.BOOST_MULTIPLIER : CONSTANTS.PLAYER_SPEED;

  if (input.dash && now - player.lastDashAt >= CONSTANTS.DASH_COOLDOWN_MS) {
    player.lastDashAt = now;
    player.dashingUntil = now + CONSTANTS.DASH_DURATION_MS;
  }

  if (moveX !== 0 || moveY !== 0) {
    const len = Math.hypot(moveX, moveY);
    moveX /= len;
    moveY /= len;
  }

  if (player.dashingUntil > now) {
    speed = CONSTANTS.DASH_SPEED;
  }

  player.vx = moveX * speed;
  player.vy = moveY * speed;
  player.x = clamp(player.x + player.vx * (CONSTANTS.TICK_RATE_MS / 1000), 0, CONSTANTS.ARENA_WIDTH);
  player.y = clamp(player.y + player.vy * (CONSTANTS.TICK_RATE_MS / 1000), 0, CONSTANTS.ARENA_HEIGHT);

  input.dash = false;
}

function processHazard(room, player, now) {
  const dist = distXY(player.x, player.y, room.hazard.x, room.hazard.y);
  if (dist <= room.hazard.radius) {
    applyDamage(room, player, CONSTANTS.HAZARD_DAMAGE_PER_SECOND / 20, null, now);
  }
}

function processPowerUp(room, player, now) {
  if (room.powerUp.active) {
    const dist = distXY(player.x, player.y, room.powerUp.position.x, room.powerUp.position.y);
    if (dist <= room.powerUp.radius + 14) {
      room.powerUp.active = false;
      room.powerUp.nextSpawnAt = now + CONSTANTS.POWERUP_RESPAWN_MS;
      player.boostUntil = now + CONSTANTS.POWERUP_BOOST_MS;
    }
  } else if (room.powerUp.nextSpawnAt && now >= room.powerUp.nextSpawnAt) {
    room.powerUp.active = true;
    room.powerUp.position = randomSpawn();
    room.powerUp.nextSpawnAt = 0;
  }
}

function processMelee(room, player, now) {
  if (!player.input.attack) return;
  if (now - player.lastAttackAt < CONSTANTS.ATTACK_COOLDOWN_MS) {
    player.input.attack = false;
    return;
  }

  player.lastAttackAt = now;
  for (const target of room.players.values()) {
    if (target.id === player.id || !target.alive) continue;
    const d = distXY(player.x, player.y, target.x, target.y);
    if (d <= CONSTANTS.ATTACK_RANGE) {
      applyDamage(room, target, CONSTANTS.ATTACK_DAMAGE, player.id, now);
    }
  }
  player.input.attack = false;
}

function processSpecial(room, player, now) {
  if (!player.input.special) return;
  if (now - player.lastSpecialAt < CONSTANTS.ELEMENT_COOLDOWN_MS) {
    player.input.special = false;
    return;
  }

  player.lastSpecialAt = now;
  room.elementZones.push({
    ownerId: player.id,
    className: player.className,
    x: clamp(player.input.specialTargetX, 0, CONSTANTS.ARENA_WIDTH),
    y: clamp(player.input.specialTargetY, 0, CONSTANTS.ARENA_HEIGHT),
    radius: CONSTANTS.ELEMENT_RADIUS,
    damage: CONSTANTS.ELEMENT_BASE_DAMAGE + (player.boostUntil > now ? 8 : 0),
    expiresAt: now + CONSTANTS.ELEMENT_LIFE_MS,
    color: player.classMeta.elementColor,
    label: player.classMeta.elementName
  });
  player.input.special = false;
}

function processElementZones(room, now) {
  room.elementZones = room.elementZones.filter((zone) => zone.expiresAt > now);
  for (const zone of room.elementZones) {
    for (const target of room.players.values()) {
      if (!target.alive || target.id === zone.ownerId) continue;
      const d = distXY(zone.x, zone.y, target.x, target.y);
      if (d <= zone.radius) {
        applyDamage(room, target, zone.damage / 20, zone.ownerId, now);
      }
    }
  }
}

function endMatch(room) {
  const ranking = getPlayersArray(room)
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      className: player.className,
      rank: player.rank,
      wins: player.wins,
      isBot: player.isBot
    }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name));

  const winner = ranking[0] ? room.players.get(ranking[0].id) : null;
  if (winner) {
    winner.wins += 1;
    winner.appearance.winAuraLevel = clamp(winner.appearance.winAuraLevel + 1, 0, CONSTANTS.WIN_AURA_MAX);
    ranking[0].wins = winner.wins;
  }

  io.to(room.code).emit('matchEnded', {
    ranking,
    roomCode: room.code,
    winnerId: winner ? winner.id : null
  });

  room.phase = 'lobby';
  room.endsAt = 0;
  room.startedAt = 0;
  room.elementZones = [];
  removeLobbyBots(room);
  emitRoomUpdated(room);
}

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (room.phase !== 'playing') continue;

    for (const player of room.players.values()) {
      if (player.isBot) {
        botThink(room, player, now);
      }

      if (!player.alive) {
        if (player.respawnAt && now >= player.respawnAt) {
          respawnPlayer(player);
        }
        continue;
      }

      processMovement(room, player, now);
      processHazard(room, player, now);
      if (!player.alive) continue;

      processPowerUp(room, player, now);
      if (!player.alive) continue;

      processMelee(room, player, now);
      if (!player.alive) continue;

      processSpecial(room, player, now);
      if (player.hp <= 0 && player.alive) {
        markDead(player, now);
      }
    }

    processElementZones(room, now);

    if (now >= room.endsAt) {
      endMatch(room);
    } else {
      emitState(room);
    }
  }
}, CONSTANTS.TICK_RATE_MS);

io.on('connection', (socket) => {
  socket.on('createRoom', (payload, ack = () => {}) => {
    try {
      leaveRoomForSocket(socket.id);
      const profile = payload && payload.profile ? payload.profile : {};
      const difficulty = sanitizeDifficulty(payload && payload.botDifficulty);
      const room = createRoom(socket.id, profile, difficulty);
      socket.join(room.code);
      ack({ ok: true, room: roomSummary(room), playerId: socket.id });
      emitRoomUpdated(room);
    } catch (error) {
      ack({ ok: false, error: error.message || 'Failed to create room' });
    }
  });

  socket.on('joinRoom', (payload, ack = () => {}) => {
    try {
      const roomCode = String(payload && payload.roomCode || '').toUpperCase().trim();
      const room = rooms.get(roomCode);
      if (!room) {
        return ack({ ok: false, error: 'Room not found.' });
      }
      if (room.phase !== 'lobby') {
        return ack({ ok: false, error: 'Match already started.' });
      }
      const humans = getHumanPlayers(room);
      if (humans.length >= 4) {
        return ack({ ok: false, error: 'Room is full.' });
      }

      leaveRoomForSocket(socket.id);

      const player = createPlayer(socket.id, payload.profile || {}, false, room.botDifficulty);
      room.players.set(socket.id, player);
      socket.join(room.code);

      ack({ ok: true, room: roomSummary(room), playerId: socket.id });
      emitRoomUpdated(room);
    } catch (error) {
      ack({ ok: false, error: error.message || 'Failed to join room' });
    }
  });

  socket.on('startMatch', (_payload, ack = () => {}) => {
    try {
      const room = Array.from(rooms.values()).find((r) => r.players.has(socket.id));
      if (!room) return ack({ ok: false, error: 'Not in a room.' });
      if (room.phase !== 'lobby') return ack({ ok: false, error: 'Match already in progress.' });
      if (room.hostSocketId !== socket.id) return ack({ ok: false, error: 'Only host can start.' });

      startMatch(room);
      ack({ ok: true });
      emitMatchStarted(room);
    } catch (error) {
      ack({ ok: false, error: error.message || 'Could not start match' });
    }
  });

  socket.on('setBotDifficulty', (payload, ack = () => {}) => {
    try {
      const room = Array.from(rooms.values()).find((r) => r.players.has(socket.id));
      if (!room) return ack({ ok: false, error: 'Not in a room.' });
      if (room.hostSocketId !== socket.id) return ack({ ok: false, error: 'Only host can set bot difficulty.' });
      if (room.phase !== 'lobby') return ack({ ok: false, error: 'Cannot change during match.' });

      room.botDifficulty = sanitizeDifficulty(payload && payload.difficulty);
      emitRoomUpdated(room);
      ack({ ok: true, difficulty: room.botDifficulty });
    } catch (error) {
      ack({ ok: false, error: error.message || 'Could not update difficulty' });
    }
  });

  socket.on('playerInput', (input = {}) => {
    const room = Array.from(rooms.values()).find((r) => r.players.has(socket.id));
    if (!room || room.phase !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || player.isBot) return;

    player.input.up = !!input.up;
    player.input.down = !!input.down;
    player.input.left = !!input.left;
    player.input.right = !!input.right;
    player.input.dash = !!input.dash;
    player.input.attack = !!input.attack;
    player.input.special = !!input.special;
    player.input.angle = Number(input.angle) || 0;
    player.input.specialTargetX = clamp(Number(input.specialTargetX) || player.x, 0, CONSTANTS.ARENA_WIDTH);
    player.input.specialTargetY = clamp(Number(input.specialTargetY) || player.y, 0, CONSTANTS.ARENA_HEIGHT);
  });

  socket.on('disconnect', () => {
    leaveRoomForSocket(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Arena Brawler Online Prototype listening on http://localhost:${PORT}`);
});