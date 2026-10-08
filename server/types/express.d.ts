/**
 * Augmentation du type `Request` d'Express : le contexte d'authentification et
 * les métadonnées de corrélation sont posés par les middlewares du serveur, et
 * uniquement par eux.
 */
import type { AuthContext } from '../auth/types';

declare global {
  namespace Express {
    interface Request {
      /** Contexte établi à partir de la session serveur (jamais du client). */
      auth?: AuthContext;
      /** Jeton de session présenté (utilisé uniquement pour révoquer la session). */
      sessionToken?: string;
      /** Identifiant de corrélation de la requête, journalisé avec chaque erreur. */
      correlationId?: string;
    }
  }
}

export {};
