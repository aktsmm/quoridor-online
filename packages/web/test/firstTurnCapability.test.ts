import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../src/net/protocol.js';
import {
  SessionStore,
  type ConnectionEventsLike,
  type ConnectionLike,
} from '../src/state/store.js';

/**
 * The static site and the game server deploy separately, so a new front end can
 * meet an older server. That server validates with `additionalProperties:
 * false`, which means an unknown field does not get ignored - the whole frame
 * is rejected and the player cannot even open a room. So the field only goes on
 * the wire once the server has said it understands it.
 */
function harness(): { store: SessionStore; sent: ClientMessage[]; greet: (features?: string[]) => void } {
  const sent: ClientMessage[] = [];
  let events: ConnectionEventsLike | null = null;
  let rid = 0;

  const connection: ConnectionLike = {
    connect: () => events!.onStatus('open', null),
    close: () => events!.onStatus('offline', null),
    retryNow: () => {},
    nextRid: () => (rid += 1),
    send: (message) => {
      sent.push(message);
      return true;
    },
  };

  const store = new SessionStore((e) => {
    events = e;
    return connection;
  });
  store.start();

  return {
    store,
    sent,
    greet: (features) => {
      const hello = { type: 'hello', protocolVersion: PROTOCOL_VERSION } as ServerMessage;
      if (features) (hello as { features?: string[] }).features = features;
      events!.onMessage(hello);
    },
  };
}

function created(sent: ClientMessage[]): Record<string, unknown> {
  const message = sent.find((m) => m.type === 'room.create');
  expect(message).toBeDefined();
  return message as unknown as Record<string, unknown>;
}

describe('turn-order capability negotiation', () => {
  it('sends the chosen position to a server that advertises the feature', () => {
    const { store, sent, greet } = harness();
    greet(['first-turn']);
    expect(store.getSnapshot().canChooseFirstTurn).toBe(true);

    store.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
      hostPosition: 2,
    });
    expect(created(sent).hostPosition).toBe(2);
  });

  it('leaves the field off entirely when the server never advertised it', () => {
    const { store, sent, greet } = harness();
    greet();
    expect(store.getSnapshot().canChooseFirstTurn).toBe(false);

    store.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
      hostPosition: 2,
    });
    // Not merely undefined: the key must not be serialised at all.
    expect('hostPosition' in created(sent)).toBe(false);
  });

  it('leaves the field off for a server that advertises other features only', () => {
    const { store, sent, greet } = harness();
    greet(['something-else']);
    expect(store.getSnapshot().canChooseFirstTurn).toBe(false);

    store.createRoom({
      playerCount: 4,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
      hostPosition: 3,
    });
    expect('hostPosition' in created(sent)).toBe(false);
  });

  it('omits the field for a random draw even when the feature is available', () => {
    const { sent, greet, store } = harness();
    greet(['first-turn']);

    store.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
      hostPosition: null,
    });
    // The server draws for itself; there is nothing useful to send.
    expect('hostPosition' in created(sent)).toBe(false);
  });

  it('forgets the capability when the socket drops', () => {
    const { store, greet } = harness();
    greet(['first-turn']);
    expect(store.getSnapshot().canChooseFirstTurn).toBe(true);

    // The next socket may land on a replica running the previous build.
    store.stop();
    expect(store.getSnapshot().canChooseFirstTurn).toBe(false);
  });
});
