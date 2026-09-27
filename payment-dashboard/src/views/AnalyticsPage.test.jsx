// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AnalyticsPage from './AnalyticsPage';

// The wallet kit is CommonJS and constructed at import time in shared.js;
// it is irrelevant to the analytics fetch flow under test.
vi.mock('@creit.tech/stellar-wallets-kit', () => {
  class Stub {}
  return {
    StellarWalletsKit: Stub,
    WalletNetwork: { TESTNET: 'TESTNET' },
    FreighterModule: Stub,
    xBullModule: Stub,
    AlbedoModule: Stub,
    LobstrModule: Stub,
  };
});

const noop = () => {};

const renderPage = () =>
  render(
    <AnalyticsPage
      userPublicKey={null}
      onConnectWallet={noop}
      onDisconnectWallet={noop}
      onDashboardClick={noop}
      onHistoryClick={noop}
      onHelpClick={noop}
      onRegisterClick={noop}
      canRegister={false}
    />,
  );

describe('AnalyticsPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows an error banner on fetch failure and clears it after a successful retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addListener: noop,
      removeListener: noop,
    }));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Horizon error (500).');
    expect(screen.queryByText('Flow volume')).toBeNull();

    const callsBeforeRetry = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ _embedded: { records: [] } }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect(screen.getByText('Flow volume')).toBeTruthy();
  });
});
