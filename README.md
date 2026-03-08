# Arena Brawler Online Prototype

Arena Brawler Online Prototype is a server-authoritative real-time browser game built with a Phaser 3 frontend and a Node.js + Express + Socket.IO backend. Players create or join a room by code, choose an elemental class and cosmetic, fight in 90-second rounds, and battle alongside or against bots when the lobby is not full.

The elemental class and arena presentation direction in this prototype was grounded by the uploaded art references, especially the four-element roster, readable silhouettes, and AoE readability goals described in the production pack and visual development bible. fileciteturn0file0 fileciteturn0file1

## Features

- Room-code multiplayer
- Host creates room, others join by code
- 1-4 human players
- Empty slots auto-filled with bots at match start to reach 4 total participants
- Host-selectable bot difficulty: easy, normal, hard
- Character profile before joining:
  - name
  - class: Earth, Fire, Wind, Water
  - cosmetic: stripe, spikes, halo
- Combat:
  - melee attack
  - class-themed elemental AoE special with 5 second cooldown
- Stats:
  - health
  - round score
  - total kills
  - rank 1-99
  - wins
  - win aura progression
- Arena systems:
  - central hazard zone with damage over time
  - speed power-up with timed respawn
- Round flow:
  - 90 second round
  - respawn after elimination
  - results screen
  - return to lobby

## Folder Structure

```text
arena-brawler-online-prototype/
├── client/
│   ├── index.html
│   └── src/
│       └── main.js
├── server/
│   ├── package.json
│   └── src/
│       └── index.js
└── README.md
```

## Setup

```bash
cd server
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Open multiple browser tabs or windows to test room multiplayer locally.

## Controls

### Menu
- `C` create room
- `J` join room

### Lobby
- `S` start match
- `D` set bot difficulty

### Arena
- `W A S D` move
- `SPACE` dash
- `Left Mouse Button` melee attack
- `Right Mouse Button` elemental special at cursor position

### Results
- `ENTER` return to lobby

## Server-Authoritative Networking

The client only sends **intent**:
- movement buttons
- dash press
- attack press
- special press
- aim angle and special target

The server owns:
- movement simulation
- dash state
- combat collision
- damage
- health
- kills
- cooldowns
- respawns
- scores
- ranks
- timers
- match start and end flow

The server emits authoritative room snapshots regularly, so all players see the same official state instead of trusting client-side guesses. Because apparently letting clients decide damage and position would be a great way to invite chaos and cheating.

## Notes

- Backend serves the frontend from `client/`.
- Default server port is `3000`, or `PORT` from environment.
- Uses CommonJS on the backend as requested.