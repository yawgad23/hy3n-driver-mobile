/**
 * Prevents an older asynchronous profile read from overwriting a newer result.
 *
 * Phone sign-in creates an authenticated Firebase session before the server has
 * finished linking its existing Driver application. The post-link refresh must
 * therefore win over the initial, pre-link profile read.
 */
export function isLatestDriverProfileLoad(requestGeneration: number, latestGeneration: number): boolean {
  return requestGeneration === latestGeneration;
}
