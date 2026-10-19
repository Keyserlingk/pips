import { type Room, joinRoom, selfId } from 'trystero';
import { type DuelMsg, parseMsg } from './protocol';

/*
 * Peer-to-peer connection for duels. Trystero introduces the two browsers
 * through public Nostr relays (only the short connection handshake goes
 * there, encrypted with the room code) and free public STUN servers; after
 * that, messages go directly between the players over WebRTC. No TURN relay
 * is used, so very strict networks may not connect.
 */

const APP_ID = 'keyserlingk-pips-duel-v1';
/** Leaving is delayed this long; reopening the same room meanwhile cancels it. */
const LEAVE_DELAY_MS = 300;

export interface DuelNet {
  readonly selfId: string;
  /** To one peer, or to everyone in the room. */
  send(msg: DuelMsg, to?: string): void;
  /** Round-trip time in ms. */
  ping(peer: string): Promise<number>;
  leave(): void;
}

export interface NetHandlers {
  onJoin(peer: string): void;
  onLeave(peer: string): void;
  onMessage(msg: DuelMsg, peer: string): void;
  onError(message: string): void;
}

interface OpenRoom {
  room: Room;
  send: (data: string, options?: { target: string }) => Promise<void>;
  handlers: NetHandlers;
  leaveTimer?: ReturnType<typeof setTimeout>;
}

// Trystero keeps one room per code. A screen that closes and immediately
// reopens the same room (React does this on purpose in development, and it
// happens on quick back-and-forth navigation) must not shut down the room the
// new screen is using, so a pending leave is cancelled and the room reused.
const rooms = new Map<string, OpenRoom>();

function create(code: string, handlers: NetHandlers): OpenRoom {
  // trickleIce: send connection routes as they are found instead of waiting for all of
  // them, so a slow or blocked STUN server doesn't hold up the connection.
  const room = joinRoom({ appId: APP_ID, password: code, trickleIce: true }, code, {
    onJoinError: (d) => entry.handlers.onError(d.error),
  });
  // Messages travel as JSON strings; parseMsg drops anything unexpected.
  const action = room.makeAction<string>('m', {
    onMessage: (data, ctx) => {
      const msg = parseMsg(data);
      if (msg) entry.handlers.onMessage(msg, ctx.peerId);
    },
  });
  room.onPeerJoin = (peer) => entry.handlers.onJoin(peer);
  room.onPeerLeave = (peer) => entry.handlers.onLeave(peer);
  const entry: OpenRoom = { room, send: (data, options) => action.send(data, options), handlers };
  return entry;
}

export function openRoom(code: string, handlers: NetHandlers): DuelNet {
  let entry = rooms.get(code);
  if (entry) {
    clearTimeout(entry.leaveTimer);
    entry.handlers = handlers;
  } else {
    entry = create(code, handlers);
    rooms.set(code, entry);
  }
  const current = entry;
  return {
    selfId,
    send: (msg, to) => {
      current.send(JSON.stringify(msg), to ? { target: to } : undefined).catch(() => {});
    },
    ping: (peer) => current.room.ping(peer),
    leave: () => {
      clearTimeout(current.leaveTimer);
      current.leaveTimer = setTimeout(() => {
        if (rooms.get(code) === current) rooms.delete(code);
        current.room.leave().catch(() => {});
      }, LEAVE_DELAY_MS);
    },
  };
}
