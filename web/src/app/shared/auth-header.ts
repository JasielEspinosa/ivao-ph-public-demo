import { environment } from '../../environments/environment';

/**
 * The login of the site itself, sent with every API request. In a file of its own so what the app's first load uses (the
 * header) does not import the app component back.
 */
export function getAuthHeader(): string {
  const username = environment.apiAuth.username;
  const password = environment.apiAuth.password;
  return `Basic ${btoa(`${username}:${password}`)}`;
}
