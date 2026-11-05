/** Routes a scanned link may open. */
const ROUTES = ['s', 'p', 'g', 'play', 'duel'];

/** The app route (#/...) in a scanned Pips link, or null for anything else. */
export function pipsRoute(text: string): string | null {
  const i = text.indexOf('#/');
  if (i < 0 || !/^https?:\/\//.test(text)) return null;
  const route = text.slice(i);
  return ROUTES.includes(route.slice(2).split('/')[0]) ? route : null;
}
