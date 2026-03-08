(() => {
  const CLASS_OPTIONS = ['Earth', 'Fire', 'Wind', 'Water'];
  const COSMETIC_OPTIONS = ['stripe', 'spikes', 'halo'];
  const BOT_OPTIONS = ['easy', 'normal', 'hard'];

  const shared = {
    socket: io(),
    playerId: null,
    room: null,
    latestState: null,
    latestMatchEnded: null,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      dash: false,
      attack: false,
      special: false,
      angle: 0,
      specialTargetX: 0,
      specialTargetY: 0
    }
  };

  function askProfile() {
    const name = (window.prompt('Enter name (max 18 chars):', 'Player') || 'Player').slice(0, 18).trim() || 'Player';
    let className = (window.prompt('Choose class: Earth, Fire, Wind, Water', 'Earth') || 'Earth').trim();
    className = CLASS_OPTIONS.includes(className) ? className : 'Earth';
    let cosmetic = (window.prompt('Choose cosmetic: stripe, spikes, halo', 'stripe') || 'stripe').trim();
    cosmetic = COSMETIC_OPTIONS.includes(cosmetic) ? cosmetic : 'stripe';

    return { name, className, cosmetic };
  }

  function getLocalPlayer(state) {
    if (!state || !state.players) return null;
    return state.players.find((p) => p.id === shared.playerId) || null;
  }

  function sortScoreboard(players) {
    return [...players].sort((a, b) => b.score - a.score || b.totalKills - a.totalKills || a.name.localeCompare(b.name));
  }

  function hexColor(value) {
    return '#' + value.toString(16).padStart(6, '0');
  }

  class BaseScene extends Phaser.Scene {
    centerText(y, text, size = 28, color = '#ffffff') {
      return this.add.text(700, y, text, {
        fontFamily: 'Arial',
        fontSize: `${size}px`,
        color,
        align: 'center',
        wordWrap: { width: 1200 }
      }).setOrigin(0.5);
    }
  }

  class TitleScene extends BaseScene {
    constructor() {
      super('TitleScene');
    }

    create() {
      this.cameras.main.setBackgroundColor('#0a1020');
      this.centerText(180, 'ARENA BRAWLER ONLINE PROTOTYPE', 46, '#f4f7ff');
      this.centerText(310, 'Top-down elemental chaos with room-code multiplayer, bots, hazards, and enough problems to keep everyone busy.', 24, '#b7c6e4');
      this.centerText(420, 'WASD move   SPACE dash   Left Click melee   Right Click special', 28, '#d7e5ff');
      this.centerText(520, 'Press ENTER to continue', 34, '#ffd978');

      this.input.keyboard.once('keydown-ENTER', () => {
        this.scene.start('MenuScene');
      });
    }
  }

  class MenuScene extends BaseScene {
    constructor() {
      super('MenuScene');
    }

    create() {
      this.cameras.main.setBackgroundColor('#101729');
      this.centerText(170, 'MENU', 48, '#f4f7ff');
      this.centerText(330, 'Press C to create room', 32, '#99f5c1');
      this.centerText(400, 'Press J to join room', 32, '#8ad4ff');

      this.input.keyboard.on('keydown-C', () => this.handleCreate());
      this.input.keyboard.on('keydown-J', () => this.handleJoin());
    }

    handleCreate() {
      const profile = askProfile();
      let botDifficulty = (window.prompt('Bot difficulty: easy, normal, hard', 'normal') || 'normal').trim();
      botDifficulty = BOT_OPTIONS.includes(botDifficulty) ? botDifficulty : 'normal';

      shared.socket.emit('createRoom', { profile, botDifficulty }, (res) => {
        if (!res || !res.ok) {
          window.alert((res && res.error) || 'Failed to create room');
          return;
        }
        shared.playerId = res.playerId;
        shared.room = res.room;
        shared.latestState = res.room;
        this.scene.start('LobbyScene');
      });
    }

    handleJoin() {
      const roomCode = (window.prompt('Enter 4-character room code:', '') || '').trim().toUpperCase();
      const profile = askProfile();

      shared.socket.emit('joinRoom', { roomCode, profile }, (res) => {
        if (!res || !res.ok) {
          window.alert((res && res.error) || 'Failed to join room');
          return;
        }
        shared.playerId = res.playerId;
        shared.room = res.room;
        shared.latestState = res.room;
        this.scene.start('LobbyScene');
      });
    }
  }

  class LobbyScene extends BaseScene {
    constructor() {
      super('LobbyScene');
      this.roomUpdatedHandler = null;
      this.matchStartedHandler = null;
    }

    create() {
      this.cameras.main.setBackgroundColor('#101422');
      this.title = this.centerText(90, 'LOBBY', 44, '#ffffff');
      this.infoText = this.add.text(100, 170, '', { fontFamily: 'Arial', fontSize: '26px', color: '#d8e5ff' });
      this.controlsText = this.add.text(100, 760, 'S = start match   D = set bot difficulty', { fontFamily: 'Arial', fontSize: '26px', color: '#ffd978' });

      this.playerText = this.add.text(100, 250, '', {
        fontFamily: 'Arial',
        fontSize: '28px',
        color: '#f0f4ff',
        lineSpacing: 10
      });

      this.roomUpdatedHandler = (room) => {
        shared.room = room;
        this.renderLobby(room);
      };

      this.matchStartedHandler = (room) => {
        shared.room = room;
        shared.latestState = room;
        this.scene.start('ArenaScene');
      };

      shared.socket.on('roomUpdated', this.roomUpdatedHandler);
      shared.socket.on('matchStarted', this.matchStartedHandler);

      this.input.keyboard.on('keydown-S', () => {
        shared.socket.emit('startMatch', {}, (res) => {
          if (res && !res.ok) {
            window.alert(res.error || 'Could not start match');
          }
        });
      });

      this.input.keyboard.on('keydown-D', () => {
        const difficulty = (window.prompt('Bot difficulty: easy, normal, hard', shared.room?.botDifficulty || 'normal') || 'normal').trim();
        shared.socket.emit('setBotDifficulty', { difficulty }, (res) => {
          if (res && !res.ok) {
            window.alert(res.error || 'Could not change difficulty');
          }
        });
      });

      this.renderLobby(shared.room || shared.latestState);
    }

    renderLobby(room) {
      if (!room) return;
      const players = room.players || [];
      this.infoText.setText(
        `Room Code: ${room.code}\nBot Difficulty: ${room.botDifficulty}\nHost: ${(players.find((p) => p.id === room.hostSocketId) || {}).name || 'None'}`
      );

      const lines = players.map((p, i) => {
        const hostMarker = p.id === room.hostSocketId ? ' [HOST]' : '';
        const botMarker = p.isBot ? ' [BOT]' : '';
        return `${i + 1}. ${p.name}${hostMarker}${botMarker}  |  ${p.className}  |  Cosmetic: ${p.appearance.cosmetic}  |  Rank ${p.rank}  |  Wins ${p.wins}`;
      });
      this.playerText.setText(lines.join('\n\n') || 'No players yet');
    }

    shutdown() {
      if (this.roomUpdatedHandler) shared.socket.off('roomUpdated', this.roomUpdatedHandler);
      if (this.matchStartedHandler) shared.socket.off('matchStarted', this.matchStartedHandler);
    }
  }

  class ArenaScene extends Phaser.Scene {
    constructor() {
      super('ArenaScene');
      this.stateHandler = null;
      this.matchEndedHandler = null;
    }

    create() {
      this.input.mouse.disableContextMenu();
      this.cameras.main.setBackgroundColor('#182033');

      this.graphics = this.add.graphics();
      this.uiText = this.add.text(18, 12, '', { fontFamily: 'Arial', fontSize: '22px', color: '#ffffff' });
      this.scoreText = this.add.text(1080, 20, '', { fontFamily: 'Arial', fontSize: '22px', color: '#ffffff', align: 'left' });
      this.playerLabels = [];
      this.zoneLabels = [];

      this.keys = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        dash: Phaser.Input.Keyboard.KeyCodes.SPACE
      });

      this.input.on('pointerdown', (pointer) => {
        if (pointer.rightButtonDown()) {
          shared.input.special = true;
        } else {
          shared.input.attack = true;
        }
      });

      this.stateHandler = (state) => {
        shared.latestState = state;
        if (state.phase === 'lobby') {
          shared.room = state;
          this.scene.start('LobbyScene');
        }
      };

      this.matchEndedHandler = (payload) => {
        shared.latestMatchEnded = payload;
        this.scene.start('ResultsScene');
      };

      shared.socket.on('state', this.stateHandler);
      shared.socket.on('matchEnded', this.matchEndedHandler);
    }

    update() {
      const state = shared.latestState;
      if (!state) return;

      const me = getLocalPlayer(state);
      const pointer = this.input.activePointer;

      shared.input.up = this.keys.up.isDown;
      shared.input.down = this.keys.down.isDown;
      shared.input.left = this.keys.left.isDown;
      shared.input.right = this.keys.right.isDown;
      shared.input.dash = Phaser.Input.Keyboard.JustDown(this.keys.dash);

      if (me) {
        shared.input.angle = Phaser.Math.Angle.Between(me.x, me.y, pointer.worldX, pointer.worldY);
      } else {
        shared.input.angle = 0;
      }
      shared.input.specialTargetX = pointer.worldX;
      shared.input.specialTargetY = pointer.worldY;

      shared.socket.emit('playerInput', shared.input);

      shared.input.attack = false;
      shared.input.special = false;

      this.renderState(state, me);
    }

    renderState(state, me) {
      this.graphics.clear();

      // background grid
      this.graphics.fillStyle(0x162238, 1);
      this.graphics.fillRect(0, 0, 1400, 900);
      this.graphics.lineStyle(1, 0x22324d, 0.55);
      for (let x = 0; x <= 1400; x += 70) {
        this.graphics.lineBetween(x, 0, x, 900);
      }
      for (let y = 0; y <= 900; y += 70) {
        this.graphics.lineBetween(0, y, 1400, y);
      }

      // hazard
      this.graphics.fillStyle(0xaa2233, 0.18);
      this.graphics.fillCircle(state.hazard.x, state.hazard.y, state.hazard.radius);
      this.graphics.lineStyle(4, 0xdd4455, 0.6);
      this.graphics.strokeCircle(state.hazard.x, state.hazard.y, state.hazard.radius);

      // power-up
      if (state.powerUp.active) {
        this.graphics.fillStyle(0xffd85d, 0.9);
        this.graphics.fillCircle(state.powerUp.position.x, state.powerUp.position.y, state.powerUp.radius);
        this.graphics.lineStyle(3, 0xffffff, 0.9);
        this.graphics.strokeCircle(state.powerUp.position.x, state.powerUp.position.y, state.powerUp.radius + 6);
      }

      // element zones
      for (let i = 0; i < this.zoneLabels.length; i++) this.zoneLabels[i].setVisible(false);
      state.elementZones.forEach((zone, index) => {
        this.graphics.fillStyle(zone.color, 0.18);
        this.graphics.fillCircle(zone.x, zone.y, zone.radius);
        this.graphics.lineStyle(3, zone.color, 0.85);
        this.graphics.strokeCircle(zone.x, zone.y, zone.radius);
        this.upsertZoneLabel(index, zone);
      });

      for (let i = 0; i < this.playerLabels.length; i++) this.playerLabels[i].setVisible(false);

      // players
      state.players.forEach((p, index) => {
        const bodyColor = p.classMeta.color;
        const accentColor = p.classMeta.accent;
        const cosmetic = p.appearance.cosmetic;
        const accentRadius = cosmetic === 'stripe' ? 6 : cosmetic === 'spikes' ? 10 : 4;
        const auraAlpha = Phaser.Math.Clamp(p.appearance.winAuraLevel / 20, 0, 1) * 0.45;

        if (!p.alive) {
          this.graphics.fillStyle(0x777777, 0.22);
          this.graphics.fillCircle(p.x, p.y, 18);
          this.graphics.lineStyle(2, 0x888888, 0.4);
          this.graphics.strokeCircle(p.x, p.y, 18);
          this.graphics.lineBetween(p.x - 10, p.y - 10, p.x + 10, p.y + 10);
          this.graphics.lineBetween(p.x + 10, p.y - 10, p.x - 10, p.y + 10);
          return;
        }

        this.graphics.fillStyle(bodyColor, 0.95);
        this.graphics.fillCircle(p.x, p.y, 18);

        if (auraAlpha > 0) {
          this.graphics.lineStyle(6, p.classMeta.elementColor, auraAlpha);
          this.graphics.strokeCircle(p.x, p.y, 26 + p.appearance.winAuraLevel * 0.35);
        }

        this.graphics.fillStyle(accentColor, 0.95);
        if (cosmetic === 'stripe') {
          this.graphics.fillRect(p.x - 12, p.y - 3, 24, 6);
        } else if (cosmetic === 'spikes') {
          this.graphics.fillTriangle(p.x, p.y - 22, p.x - 8, p.y - 10, p.x + 8, p.y - 10);
        } else {
          this.graphics.lineStyle(4, accentColor, 0.95);
          this.graphics.strokeCircle(p.x, p.y - 20, accentRadius + 8);
        }

        // boosted ring
        const boosted = p.boostUntil > Date.now();
        if (boosted) {
          this.graphics.lineStyle(3, 0xffec88, 0.9);
          this.graphics.strokeCircle(p.x, p.y, 22);
        }

        // HP bar
        const hpPct = Phaser.Math.Clamp(p.hp / 100, 0, 1);
        this.graphics.fillStyle(0x000000, 0.5);
        this.graphics.fillRect(p.x - 22, p.y - 34, 44, 6);
        this.graphics.fillStyle(boosted ? 0xffec88 : hpPct < 0.35 ? 0xff6161 : 0x6bf28a, 0.95);
        this.graphics.fillRect(p.x - 22, p.y - 34, 44 * hpPct, 6);

        const labelColor = p.id === shared.playerId ? '#ffe77d' : '#ffffff';
        this.upsertPlayerLabel(index, p, labelColor);
      });

      const remaining = Math.max(0, state.endsAt - Date.now());
      const secs = Math.ceil(remaining / 1000);
      const sorted = sortScoreboard(state.players);
      this.scoreText.setText('SCOREBOARD\n' + sorted.map((p, i) => `${i + 1}. ${p.name} - ${p.score}`).join('\n'));

      const specialCd = me ? Math.max(0, Math.ceil((me.specialReadyIn || 0) / 1000)) : 0;
      this.uiText.setText(
        [
          `Timer: ${secs}s`,
          me ? `Class: ${me.className}` : 'Class: -',
          me ? `Rank: ${me.rank}` : 'Rank: -',
          me ? `Kills: ${me.totalKills}` : 'Kills: -',
          me ? `Wins: ${me.wins}` : 'Wins: -',
          me ? `${me.classMeta.elementName} CD: ${specialCd}s` : 'Special CD: -'
        ].join('\n')
      );
    }

    upsertPlayerLabel(index, player, color) {
      if (!this.playerLabels[index]) {
        this.playerLabels[index] = this.add.text(player.x, player.y + 26, player.name, {
          fontFamily: 'Arial',
          fontSize: '16px',
          color
        }).setOrigin(0.5);
      }
      this.playerLabels[index]
        .setVisible(true)
        .setPosition(player.x, player.y + 26)
        .setText(player.name)
        .setColor(color)
        .setAlpha(player.alive ? 1 : 0.5);
    }

    upsertZoneLabel(index, zone) {
      if (!this.zoneLabels[index]) {
        this.zoneLabels[index] = this.add.text(zone.x, zone.y, zone.label, {
          fontFamily: 'Arial',
          fontSize: '16px',
          color: '#ffffff'
        }).setOrigin(0.5);
      }
      this.zoneLabels[index]
        .setVisible(true)
        .setPosition(zone.x, zone.y)
        .setText(zone.label);
    }

    shutdown() {
      if (this.stateHandler) shared.socket.off('state', this.stateHandler);
      if (this.matchEndedHandler) shared.socket.off('matchEnded', this.matchEndedHandler);
    }
  }

  class ResultsScene extends BaseScene {
    constructor() {
      super('ResultsScene');
    }

    create() {
      this.cameras.main.setBackgroundColor('#131321');
      const result = shared.latestMatchEnded || { ranking: [], winnerId: null, roomCode: shared.room?.code || '' };
      this.centerText(90, 'ROUND OVER', 50, '#ffffff');

      const lines = (result.ranking || []).map((entry, idx) =>
        `${idx + 1}. ${entry.name}  |  ${entry.className}  |  Score ${entry.score}  |  Rank ${entry.rank}`
      );

      this.add.text(170, 190, lines.join('\n\n'), {
        fontFamily: 'Arial',
        fontSize: '28px',
        color: '#e9f0ff',
        lineSpacing: 8
      });

      const winner = (result.ranking || []).find((r) => r.id === result.winnerId);
      const winnerMsg = winner
        ? `${winner.name} wins the round and gets an aura upgrade. Humanity loves a shiny circle and calls it progression.`
        : 'No winner found.';
      this.centerText(720, winnerMsg, 28, '#ffd978');
      this.centerText(800, `Room ${result.roomCode} returned to lobby. Press ENTER to continue.`, 28, '#9bd5ff');

      this.input.keyboard.once('keydown-ENTER', () => {
        this.scene.start('LobbyScene');
      });
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 1400,
    height: 900,
    parent: 'game',
    scene: [TitleScene, MenuScene, LobbyScene, ArenaScene, ResultsScene]
  });

  // Clean up scene socket listeners when scenes change.
  game.events.on('transitionstart', (_from, _to) => {});
})();