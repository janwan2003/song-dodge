// Forwards every /api/* request to the single Durable Object that holds all games.
export async function onRequest({ request, env }) {
  const stub = env.GAMES.get(env.GAMES.idFromName('main'));
  return stub.fetch(request);
}
