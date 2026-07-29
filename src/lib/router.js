import { setState } from './store.js';

export function parseRoute(hash = location.hash) {
  const cleaned = (hash || '#/home').replace(/^#\/?/, '');
  const [page = 'home', id = ''] = cleaned.split('/');
  return { page, id };
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

export function initRouter(onChange) {
  const sync = () => {
    setState({ route: location.hash || '#/home' });
    onChange?.(parseRoute());
  };
  window.addEventListener('hashchange', sync);
  if (!location.hash) location.hash = '#/home';
  sync();
}
