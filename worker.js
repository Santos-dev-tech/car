/**
 * MotoKE — the Cloudflare Worker that fronts the container.
 *
 * Its only job is to hand every request to the Node app running inside the
 * container and pass the answer back. The application itself is unchanged; this
 * is the adapter between Cloudflare's request model and a normal HTTP server.
 *
 * One instance, deliberately. The database is a SQLite file on the container's
 * own disk, so two instances would be two different databases — a customer
 * would see their application appear and vanish depending on which one answered.
 * `getContainer` with a fixed name pins every request to the same instance.
 */
import { Container, getContainer } from '@cloudflare/containers';

export class MotoKEContainer extends Container {
  /** Matches EXPOSE and PORT in the Dockerfile. */
  defaultPort = 8080;

  /**
   * Containers scale to zero. Fifteen minutes is long enough that a dealer
   * clicking around a demo never meets a cold start, and short enough that an
   * idle deployment costs nothing overnight.
   */
  sleepAfter = '15m';

  envVars = {
    MOTOKE_CONTAINER: '1',
    NODE_ENV: 'production',
  };

  onStart() {
    console.log('MotoKE container started');
  }

  onStop(reason) {
    /* Worth logging plainly: the SQLite file lives on the container disk, so a
       stop is also the end of anything written since the last start. Fine for a
       demo, not fine for real customer applications — see DEPLOY.md. */
    console.log('MotoKE container stopped:', reason);
  }

  onError(err) {
    console.error('MotoKE container error:', err);
    return new Response('The application is starting up. Try again in a moment.', {
      status: 503,
      headers: { 'Retry-After': '10', 'Content-Type': 'text/plain' },
    });
  }
}

export default {
  async fetch(request, env) {
    /* A fixed name, so every request reaches the same instance and therefore the
       same database. Naming it per-user or per-request would silently shard the
       data. */
    const container = getContainer(env.MOTOKE, 'motoke-main');
    return container.fetch(request);
  },
};
