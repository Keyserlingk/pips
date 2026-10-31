import { Capacitor } from '@capacitor/core';

/** The public site. Inside the Android app, links to share point here instead of the app's own address. */
const PUBLIC_SITE = 'https://keyserlingk.github.io/pips/';

/** The address of this page without its #/ route, for building links that others can open. */
export const pageUrl = () => (Capacitor.isNativePlatform() ? PUBLIC_SITE : `${location.origin}${location.pathname}`);
