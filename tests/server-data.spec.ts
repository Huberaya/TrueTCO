import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_OFFERS, SEED_PROJECTS } from '../src/data/seedData';
import { createOfferOnServer } from '../src/services/serverData';

describe('serverData — écriture d’offre suivie d’une relecture serveur', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepte la réponse réelle de création (id/référence/compte), sans traiter un objet partiel comme une offre complète', async () => {
    const offer = {
      ...SEED_OFFERS[0],
      id: 'client-only-test-id',
      projectId: SEED_PROJECTS[0].id,
      offerReference: 'OFF-POST-RELECTURE-TEST',
      costItems: SEED_OFFERS[0].costItems.map((item, index) =>
        index === 0 ? { ...item, occurrencesPerYear: 3 } : item,
      ),
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ id: 'server-offer-id', offerReference: offer.offerReference, costItemCount: offer.costItems.length }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createOfferOnServer(offer, SEED_PROJECTS[0].id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/offers');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.offerReference).toBe(offer.offerReference);
    expect(body.costItems).toHaveLength(offer.costItems.length);
    expect(body.costItems[0].label).toBe(offer.costItems[0].label);
    expect(body.costItems[0].occurrencesPerYear).toBe(3);
  });
});
